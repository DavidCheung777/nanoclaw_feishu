#!/usr/bin/node
// ============================================
// 每日抓取过去24小时国内外大模型事件
// 定时任务: 0 8 * * * cd /path/to/nanoclaw && node scripts/daily-ai-news.js >> logs/daily-ai-news.log 2>&1
// ============================================

const puppeteer = require('puppeteer');

// 搜索关键词 - 抓取大模型相关最新动态
const SEARCH_QUERIES = [
  '大模型 最新消息 过去24小时',
  'AI 大模型 今日新闻',
  '国内外 AI 动态 今天',
  '大模型 发布 最新 2026',
  'LLM latest news 24 hours',
];

// 最大结果数量
const MAX_RESULTS = 15;

async function searchBing(browser, query) {
  const page = await browser.newPage();
  await page.goto(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });
  await page.waitForSelector('#b_results', { timeout: 10000 });

  // 提取搜索结果: 标题 + 摘要 + URL
  const results = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.b_algo'))
      .slice(0, 5)
      .map(el => {
        const titleEl = el.querySelector('h2 a');
        const url = titleEl?.getAttribute('href') || '';
        const title = titleEl?.textContent?.trim() || '';
        const snippet = el.querySelector('.b_caption p')?.textContent?.trim() || '';
        return { title, url, snippet };
      })
      .filter(r => r.title && r.url); // 过滤空结果
  });

  await page.close();
  return results;
}

// 去重
function deduplicate(results) {
  const seen = new Map();
  for (const r of results) {
    // 使用标题作为key去重
    seen.set(r.title, r);
  }
  return Array.from(seen.values());
}

// 生成Markdown输出
function generateMarkdown(results, date) {
  let content = `# 🤖 每日AI大模型早报 ${date}

过去24小时国内外大模型领域动态：

`;

  results.forEach((r, i) => {
    content += `**${i + 1}. ${r.title}**\n`;
    content += `> ${r.snippet}\n`;
    content += `🔗 ${r.url}\n\n`;
  });

  content += `---\n*自动生成 by NanoClaw 定时任务*`;
  return content;
}

// 通过飞书机器人发送消息
async function sendToFeishu(content) {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('FEISHU_WEBHOOK_URL not set, printing to stdout instead:');
    console.log('\n' + content);
    return;
  }

  const fetch = (await import('node-fetch')).default;
  const body = {
    msg_type: 'markdown',
    content: content,
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  console.log('Feishu webhook response:', result);
  return result;
}

async function main() {
  console.log('============================================');
  console.log('开始抓取过去24小时大模型新闻...');
  console.log('============================================');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const allResults = [];
    for (const query of SEARCH_QUERIES) {
      console.log(`搜索: ${query}`);
      const results = await searchBing(browser, query);
      allResults.push(...results);
      // 延迟避免触发限流
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
    }

    // 去重并限制数量
    const uniqueResults = deduplicate(allResults);
    const finalResults = uniqueResults.slice(0, MAX_RESULTS);

    console.log(`抓取完成，共 ${finalResults.length} 条不重复结果`);

    // 生成日期
    const date = new Date().toISOString().split('T')[0];
    const markdown = generateMarkdown(finalResults, date);

    // 发送到飞书
    await sendToFeishu(markdown);

    console.log('============================================');
    console.log('完成！');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('抓取失败:', err);
  process.exit(1);
});

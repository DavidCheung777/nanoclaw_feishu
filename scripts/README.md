# 每日AI大模型新闻定时抓取

## 功能

每日自动抓取过去24小时国内外大模型领域最新事件，整理成Markdown格式，推送到飞书群组。

## 安装依赖

```bash
cd /path/to/nanoclaw
npm install puppeteer node-fetch
```

## 配置

### 1. 设置环境变量（可选）

如果你需要推送到飞书群组，设置webhook URL：

```bash
export FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
```

如果不设置，结果会直接输出到stdout方便调试。

### 2. 添加到crontab

编辑crontab：

```bash
crontab -e
```

添加一行（每天早上8点执行）：

```cron
# 每日抓取大模型新闻并推送到飞书
0 8 * * * cd /home/yourname/nanoclaw && node scripts/daily-ai-news.js >> logs/daily-ai-news.log 2>&1
```

保存退出即可。

## 格式

输出格式：

```markdown
# 🤖 每日AI大模型早报 YYYY-MM-DD

过去24小时国内外大模型领域动态：

**1. 标题**
> 摘要内容
🔗 https://example.com/article

...

---
*自动生成 by NanoClaw 定时任务*
```

每条包含：**标题 + 摘要 + 来源URL**，符合要求。

## 特点

- 完全本地运行，不需要额外API Key
- 使用Bing搜索，结果准确
- 自动去重，限制结果数量
- 随机延迟避免触发限流
- HEADLESS浏览器稳定抓取动态内容
- 日志输出到 `logs/daily-ai-news.log` 方便排查问题

## 查看日志

```bash
# 查看最新日志
tail -f logs/daily-ai-news.log

# 查看所有日志
cat logs/daily-ai-news.log
```

## 手动测试

```bash
# 直接运行测试
cd /path/to/nanoclaw
node scripts/daily-ai-news.js
```

结果会输出到终端，你可以检查是否正常工作。

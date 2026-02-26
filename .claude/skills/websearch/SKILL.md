# Web Search (Browser + Bing)

Local web search skill using Chrome/Chromium browser and Bing search engine. Works when Anthropic WebSearch is unavailable and local network has access to Bing.

## Installation

This skill requires:
1. Google Chrome / Chromium already installed
2. Playwright for browser automation

Run the installation:
```bash
npm install playwright
```

## Usage

**Search the web:**
```
/websearch your search query here
```

The skill will:
1. Launch headless Chrome
2. Open cn.bing.com
3. Search your query
4. Display top 10 results with titles, URLs, and descriptions

## Accessing Websites with Custom User-Agent

### Accessing WeChat MP Articles (微信公众号文章)

To access WeChat public platform articles (mp.weixin.qq.com):

**Best practice:**
1. Use **iPhone Safari Mobile User-Agent** to bypass anti-crawler verification:
```
Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1
```

2. Most articles can be accessed directly without manual verification when using this UA
3. After page loads, extract content from `#js_content` selector

Example:
```
agent-browser open --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" https://mp.weixin.qq.com/s/your-article-id
agent-browser eval "document.querySelector('#js_content').textContent"
```

### General Desktop (macOS Chrome)

For normal websites, use macOS Desktop Chrome User-Agent:
```
Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4 like Darwin) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36
```

## Files

- `.claude/skills/websearch/lib/search.ts` - Search implementation

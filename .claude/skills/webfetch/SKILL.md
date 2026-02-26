# Web Fetch (Extract Full Content from URL)

Fetch full content from any URL using headless Chromium browser, extract clean article content. Works when Anthropic WebFetch is unavailable.

## Installation

This skill requires:
1. Google Chrome / Chromium already installed
2. Already installed as part of websearch dependency

## Usage

**Fetch content from URL:**
```
/webfetch https://example.com/article
```

**Or with custom User-Agent (for WeChat MP articles):**
```
/webfetch --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" https://mp.weixin.qq.com/s/your-article-id
```

## What it does

The skill will:
1. Launch headless Chromium with specified User-Agent
2. Open the URL
3. Wait for page to fully load
4. Extract clean article content
   - For WeChat MP articles: automatically extracts from `#js_content`
   - For other sites: extracts all visible text content
5. Return the full content to you

## Recommended User-Agents

### WeChat MP Articles (微信公众号文章) - RECOMMENDED
```
Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1
```
Most articles can bypass anti-crawler verification with this UA.

### macOS Desktop Chrome (normal websites)
```
Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4 like Darwin) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36
```

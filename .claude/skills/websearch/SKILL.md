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

## Files

- `.claude/skills/websearch/lib/search.ts` - Search implementation

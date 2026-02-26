# Fetch URL (Playwright + Chromium)

Fetch web page content using local Chrome/Chromium browser.

## Usage

```bash
# Fetch entire page body content
/fetch-url https://example.com

# Fetch content from specific CSS selector
/fetch-url https://example.com .article-content
```

The skill will:
1. Launch headless Chromium
2. Open the URL
3. Extract the page content (HTML and plain text)
4. Return the result with page title

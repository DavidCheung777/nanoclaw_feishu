# Fetch URL (Playwright + Chromium)

Fetch web page content using local Chrome/Chromium browser.

## Usage

```bash
# Fetch entire page body content
tsx /app/container/skills/fetch-url/lib/fetch-url.ts "https://example.com"

# Fetch content from specific CSS selector
tsx /app/container/skills/fetch-url/lib/fetch-url.ts "https://example.com" "main"
```

Or import programmatically:

```typescript
import { fetchUrl } from '/app/container/skills/fetch-url/lib/fetch-url.ts';

const result = await fetchUrl('https://example.com');
// or with selector
const result = await fetchUrl('https://example.com', '.article-content');

if (result.success) {
  console.log('Title:', result.title);
  console.log('Text content:', result.textContent);
  console.log('HTML content:', result.content);
}
```

## Response Format

```typescript
interface FetchResult {
  success: boolean;
  url: string;
  title: string;
  content: string;       // HTML content
  textContent?: string;  // Plain text content
  error?: string;        // Error message if failed
}
```

## Features

- Automatically uses Chromium installed in the container
- Supports CSS selector for extracting specific content
- Truncates long content (max 100,000 characters) to avoid overwhelming the agent
- Adds https:// prefix automatically if missing

## Requirements

- Chrome/Chromium must be installed in the container (already included in nanoclaw-agent image)
- Playwright is already installed in the host project

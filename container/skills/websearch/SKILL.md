# Web Search (Playwright + Bing)

Web search tool using local Chrome/Chromium browser and Bing search engine.

## Usage

```bash
# Search the web
tsx /app/container/skills/websearch/lib/search.ts "your search query"
```

Or import programmatically:

```typescript
import { search } from '/app/container/skills/websearch/lib/search.ts';

const result = await search('your search query');
if (result.success) {
  console.log(result.results);
}
```

## Response Format

```typescript
interface SearchResult {
  title: string;
  url: string;
  description: string;
}

interface SearchResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  error?: string;
}
```

## Requirements

- Chrome/Chromium must be installed in the container (already included in nanoclaw-agent image)
- Playwright is already installed in the host project

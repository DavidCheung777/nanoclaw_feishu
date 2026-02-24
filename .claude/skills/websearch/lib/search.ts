/**
 * Web Search using Playwright + Bing
 *
 * Usage:
 *   echo "your search query" | tsx search.ts
 *   or:
 *   tsx search.ts "your search query"
 */

import { chromium } from 'playwright';

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export interface SearchResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  error?: string;
}

export async function search(query: string): Promise<SearchResponse> {
  let browser;
  try {
    // Find Chrome executable
    const chromePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];

    let executablePath: string | undefined;
    for (const path of chromePaths) {
      const fs = await import('fs');
      if (fs.existsSync(path)) {
        executablePath = path;
        break;
      }
    }

    if (!executablePath) {
      return {
        success: false,
        query,
        results: [],
        error: 'Chrome/Chromium not found in common locations',
      };
    }

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();

    // Set user agent
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // Go directly to search URL
    const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait a bit for results to fully load
    await page.waitForTimeout(1500);

    // Extract results - try multiple selector patterns for different Bing layouts
    const results = await page.evaluate(() => {
      // Try different selectors
      let items = Array.from(document.querySelectorAll('.b_algo'));
      if (items.length === 0) {
        items = Array.from(document.querySelectorAll('#b_results > li'));
      }

      return items.slice(0, 10).map((item: Element) => {
        const titleEl = item.querySelector('h2 a') || item.querySelector('a');
        let title = '';
        if (titleEl) {
          title = (titleEl.textContent || '').trim();
        }
        const url = titleEl?.getAttribute('href') || '';

        let description = '';
        const descEl = item.querySelector('.b_caption p') || item.querySelector('p');
        if (descEl) {
          description = (descEl.textContent || '').trim();
        }

        return { title, url, description };
      }).filter((r: any) => r.title && r.title.length > 0);
    });

    await browser.close();

    return {
      success: true,
      query,
      results,
    };

  } catch (err) {
    if (browser) {
      await browser.close();
    }
    return {
      success: false,
      query,
      results: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// CLI entry point
async function cli() {
  let query: string;

  if (process.argv.length >= 3) {
    query = process.argv.slice(2).join(' ');
  } else {
    // Read from stdin
    query = await new Promise<string>((resolve) => {
      let data = '';
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => resolve(data.trim()));
    });
  }

  if (!query) {
    console.log(JSON.stringify({ success: false, error: 'No search query provided' }));
    process.exit(1);
  }

  const result = await search(query);
  console.log(JSON.stringify(result, null, 2));
}

// Check if this is the entry point in ESM
if (import.meta.url === `file://${process.argv[1]}`) {
  cli();
}

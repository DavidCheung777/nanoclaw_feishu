/**
 * Fetch URL content using Playwright + Chromium
 *
 * Usage:
 *   echo "https://example.com" | tsx fetch-url.ts
 *   or:
 *   tsx fetch-url.ts "https://example.com"
 *   or with selector:
 *   tsx fetch-url.ts "https://example.com" "main"
 */

import { chromium } from 'playwright';

export interface FetchResult {
  success: boolean;
  url: string;
  title: string;
  content: string;
  textContent?: string;
  error?: string;
}

export async function fetchUrl(url: string, selector?: string): Promise<FetchResult> {
  let browser;
  try {
    // Get Chrome executable path from environment
    let executablePath: string | undefined = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.AGENT_BROWSER_EXECUTABLE_PATH;

    if (!executablePath) {
      const chromePaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ];

      const fs = await import('fs');
      for (const path of chromePaths) {
        if (fs.existsSync(path)) {
          executablePath = path;
          break;
        }
      }
    }

    if (!executablePath) {
      return {
        success: false,
        url,
        title: '',
        content: '',
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

    // Set reasonable viewport
    await page.setViewportSize({ width: 1280, height: 720 });

    // Navigate to URL
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for content to load
    await page.waitForTimeout(1000);

    // Get title
    const title = await page.title();

    let content: string;
    let textContent: string | undefined;

    if (selector) {
      // Extract content from specific selector
      content = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        return element ? element.innerHTML : '';
      }, selector);

      textContent = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        return element ? element.textContent?.trim() || '' : '';
      }, selector);
    } else {
      // Extract entire body HTML
      content = await page.evaluate(() => document.body.innerHTML);
      textContent = await page.evaluate(() => document.body.textContent?.trim() || '');
    }

    // Truncate very long content
    const MAX_LENGTH = 100000;
    if (content.length > MAX_LENGTH) {
      content = content.slice(0, MAX_LENGTH) + `\n\n... (truncated to ${MAX_LENGTH} characters)`;
    }
    if (textContent && textContent.length > MAX_LENGTH) {
      textContent = textContent.slice(0, MAX_LENGTH) + `\n\n... (truncated to ${MAX_LENGTH} characters)`;
    }

    await browser.close();

    return {
      success: true,
      url,
      title,
      content,
      textContent,
    };

  } catch (err) {
    if (browser) {
      await browser.close();
    }
    return {
      success: false,
      url,
      title: '',
      content: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// CLI entry point
async function cli() {
  let url: string;
  let selector: string | undefined;

  if (process.argv.length >= 3) {
    url = process.argv[2];
    if (process.argv.length >= 4) {
      selector = process.argv[3];
    }
  } else {
    // Read from stdin
    url = await new Promise<string>((resolve) => {
      let data = '';
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => resolve(data.trim()));
    });
  }

  if (!url) {
    console.log(JSON.stringify({ success: false, error: 'No URL provided' }));
    process.exit(1);
  }

  // Handle case where URL starts with http:// or https://
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  const result = await fetchUrl(url, selector);
  console.log(JSON.stringify(result, null, 2));
}

// Check if this is the entry point in ESM
if (import.meta.url === `file://${process.argv[1]}`) {
  cli();
}

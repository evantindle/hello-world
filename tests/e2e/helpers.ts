import type { Page } from '@playwright/test';

declare global {
  interface Window {
    // Loosely typed on purpose: this is the page's debug surface (src/debug/api.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __bendy: any;
  }
}

export const SHOTS = 'e2e-out';

/** Opens the game with a query string, collecting page errors, and waits until it is ready. */
export async function boot(page: Page, query: string, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__bendy?.ready === true);
  await page.evaluate(() => document.fonts.ready);
}

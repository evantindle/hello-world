/* global document */
// Renders the app icon and splash sources (assets/*.svg -> assets/*.png) with Playwright's
// Chromium, then `npx capacitor-assets generate` makes every size iOS and Android need.
// Run: npm run assets
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const dir = 'assets';
// [source, width, height, output] (output defaults to the source's own .png)
const jobs = [
  ['icon', 1024],
  ['icon-background', 1024],
  ['icon-foreground', 1024],
  ['splash', 2732],
  ['splash-dark', 2732],
  // Google Play's listing: the 512 px icon and the 1024 x 500 feature graphic.
  ['icon', 512, 512, 'store/icon-512.png'],
  ['feature-graphic', 1024, 500, 'store/feature-graphic.png'],
];
const font = readFileSync('src/ui/fonts/bangers-latin.woff2').toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, width, height = width, out = `${dir}/${name}.png`] of jobs) {
  const svg = readFileSync(`${dir}/${name}.svg`, 'utf8').replace(
    '<svg ',
    `<svg width="${width}" height="${height}" `,
  );
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<html><head><style>@font-face{font-family:Bangers;src:url(data:font/woff2;base64,${font}) format("woff2")}</style></head>` +
      `<body style="margin:0;background:transparent">${svg}</body></html>`,
  );
  await page.evaluate(async () => {
    await document.fonts.load('230px Bangers');
    await document.fonts.ready;
  });
  await page.screenshot({
    path: out,
    omitBackground: true,
    clip: { x: 0, y: 0, width, height },
  });
}
await browser.close();

/* global window, document, localStorage, console, process */
// Store screenshots at the sizes App Store Connect and Google Play ask for, from the production
// build (run `npm run build` first). Run: npm run store-shots
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';

const DEVICES = [
  // App Store: 6.9" iPhone (1320 x 2868) and 13" iPad (2064 x 2752).
  { dir: 'ios-iphone-6.9', viewport: { width: 440, height: 956 }, scale: 3 },
  { dir: 'ios-ipad-13', viewport: { width: 1032, height: 1376 }, scale: 2 },
  // Google Play: phone, 1080 x 1920 (no more than 2:1).
  { dir: 'android-phone', viewport: { width: 360, height: 640 }, scale: 3 },
];
const PROGRESS = {
  levels: {
    'rr-01': { stars: 3, best: 1 },
    'rr-02': { stars: 3, best: 1 },
    'rr-03': { stars: 2, best: 2 },
    'rr-04': { stars: 3, best: 1 },
    'rr-05': { stars: 1, best: 3 },
  },
};

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'warn' });
const base = 'http://127.0.0.1:4174/';
const browser = await chromium.launch();
const errors = [];

for (const d of DEVICES) {
  const out = `store/screenshots/${d.dir}`;
  mkdirSync(out, { recursive: true });
  let n = 0;
  const open = async (query) => {
    const page = await browser.newPage({
      viewport: d.viewport,
      deviceScaleFactor: d.scale,
      hasTouch: true,
      isMobile: true,
    });
    page.on('pageerror', (e) => errors.push(`${d.dir}: ${e}`));
    await page.addInitScript((p) => {
      localStorage.setItem('bendy-billiards.v2', JSON.stringify(p));
      // Not a first game (Free Play deals a remix), and no "DRAG ME!" tag.
      localStorage.setItem('bendy-billiards.best', '14');
    }, PROGRESS);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(base + query);
    await page.waitForFunction(() => window.__bendy?.ready);
    await page.evaluate(() => document.fonts.ready);
    return page;
  };
  const shot = async (page) => {
    n++;
    await page.screenshot({ path: `${out}/${n}.jpg`, type: 'jpeg', quality: 90 });
  };
  const settle = async (page) => {
    await page.waitForTimeout(2600);
    await page.evaluate(() => window.__bendy.tick(1 / 60, 1));
  };
  const play = (page) => page.getByRole('button', { name: 'Play', exact: true }).click({ force: true });
  const plan = () => {
    const b = window.__bendy;
    b.manual(true);
    b.skipSpin();
    b.untilPhase('plan', 10);
    const v0 = b.game.table.verts[0];
    b.dragVertex(0, v0.x, v0.y);
  };

  // Free Play: a remixed table with the shot preview.
  let page = await open('?seed=623');
  await page.evaluate(() => {
    const b = window.__bendy;
    b.manual(true);
    b.start();
    b.skipSpin();
    b.untilPhase('plan', 10);
    const v0 = b.game.table.verts[0];
    b.dragVertex(0, v0.x, v0.y);
    b.setDial(0.85);
    b.tick(1 / 60, 150);
  });
  await settle(page);
  await shot(page);
  await page.close();

  // A Classic level.
  page = await open('?dev=1&level=rr-06');
  await play(page);
  await page.evaluate(plan);
  await page.evaluate(() => window.__bendy.tick(1 / 60, 150));
  await settle(page);
  await shot(page);
  await page.close();

  // The Toy Box.
  page = await open('?seed=11');
  await page.getByRole('button', { name: 'Toy Box' }).click({ force: true });
  await page.evaluate(plan);
  await page.evaluate(() => {
    const b = window.__bendy;
    const g = b.game;
    const k = (kind, f = () => true) => g.tray.findIndex((t) => t.preset.kind === kind && f(t.preset));
    b.place(k('bumper'), 640, 130);
    b.place(k('booster'), 300, 400);
    b.place(
      k('felt', (p) => p.felt === 'ice'),
      480,
      250,
    );
    b.place(
      k('magnet', (p) => p.polarity === 1),
      860,
      400,
    );
    b.place(k('arc'), 160, 130);
    b.place(k('portal'), 820, 120);
    b.setDial(0.8);
    b.tick(1 / 60, 150);
  });
  await settle(page);
  await shot(page);
  await page.close();

  // The level select.
  page = await open('?seed=42&remix=0');
  await page.getByRole('button', { name: 'Classic' }).click({ force: true });
  await page.waitForTimeout(700);
  await shot(page);
  await page.close();
}

await browser.close();
await new Promise((r) => server.httpServer.close(r));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('store/screenshots written');

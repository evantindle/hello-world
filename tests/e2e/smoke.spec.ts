import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    // Loosely typed on purpose: this is the page's debug surface (src/debug/api.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __bendy: any;
  }
}

const SHOTS = 'e2e-out';

async function boot(page: Page, query: string, errors: string[]) {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__bendy?.ready === true);
  await page.evaluate(() => document.fonts.ready);
}

test('a full turn: spin, bend, smack, settle', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, '?seed=42&mute=1&remix=0', errors);
  await expect(page.getByRole('button', { name: 'PLAY!' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-title.png` });

  await page.evaluate(() => {
    window.__bendy.manual(true);
    window.__bendy.forceAngle(0.3);
    window.__bendy.start();
    window.__bendy.tick(1 / 60, 40);
  });
  expect(await page.evaluate(() => window.__bendy.phase())).toBe('spin');
  await page.screenshot({ path: `${SHOTS}/02-spin.png` });

  expect(await page.evaluate(() => window.__bendy.untilPhase('plan', 6))).toBe(true);
  const aim = await page.evaluate(() => window.__bendy.state().aim);
  expect(aim).toBeCloseTo(0.3, 5);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/03-plan.png` });

  const before = await page.evaluate(() => window.__bendy.state());
  const moved = await page.evaluate(() => window.__bendy.dragVertex(2, 1080, -60));
  expect(moved.applied).toBeGreaterThan(50);
  const bent = await page.evaluate(() => window.__bendy.state());
  expect(bent.budget).toBeLessThan(before.budget);
  expect(bent.verts[2].x).not.toBe(before.verts[2].x);
  await page.evaluate(() => window.__bendy.tick(1 / 60, 20));
  await page.screenshot({ path: `${SHOTS}/04-bent.png` });

  expect(await page.evaluate(() => window.__bendy.shoot(0.85))).toBe(true);
  await page.evaluate(() => window.__bendy.tick(1 / 60, 20));
  await page.screenshot({ path: `${SHOTS}/05-smack.png` });
  expect(
    await page.evaluate(() => window.__bendy.untilPhase('spin', 40) || window.__bendy.phase() === 'over'),
  ).toBe(true);

  const after = await page.evaluate(() => window.__bendy.state());
  expect(after.shots).toBe(1);
  const movedBalls = after.balls.filter(
    (b: { x: number; y: number; active: boolean }, i: number) =>
      !b.active || Math.hypot(b.x - bent.balls[i].x, b.y - bent.balls[i].y) > 1,
  );
  expect(movedBalls.length).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/06-next-turn.png` });
  expect(errors).toEqual([]);
});

test('real pointer input: drag a knob, turn the dial, put on English, press SMACK', async ({ page }) => {
  const errors: string[] = [];
  // Reduced motion stops the bouncing PLAY button (and exercises that CSS path).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, '?seed=9&mute=1&remix=0', errors);
  await page.getByRole('button', { name: 'PLAY!' }).click();
  await page.waitForFunction(() => window.__bendy.phase() === 'spin');
  // Tap the table to skip the spin.
  await page.mouse.click(640, 360);
  await page.waitForFunction(() => window.__bendy.phase() === 'plan', null, { timeout: 5000 });

  // Find the bottom-right corner knob on screen (once the camera stops easing) and drag it.
  await page.waitForFunction(() => window.__bendy.cameraSettled());
  const knob = await page.evaluate(() => {
    const v = window.__bendy.game.table.verts[3];
    return { x: v.x, y: v.y };
  });
  const canvas = page.locator('#world');
  const box = (await canvas.boundingBox())!;
  const toScreen = await page.evaluate(({ x, y }) => window.__bendy.toScreen(x, y), knob);
  await page.mouse.move(box.x + toScreen.x, box.y + toScreen.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + toScreen.x + i * 6, box.y + toScreen.y + i * 5);
  await page.mouse.up();
  const after = await page.evaluate(() => window.__bendy.state());
  expect(after.verts[3].x).toBeGreaterThan(knob.x + 20);
  expect(after.budget).toBeLessThan(600);

  // Turn the power dial with the keyboard, drag some draw onto the English widget, SMACK.
  const dial0 = await page.evaluate(() => window.__bendy.game.dial);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  expect(await page.evaluate(() => window.__bendy.game.dial)).toBeCloseTo(Math.min(1, dial0 + 0.12), 5);
  const spinBall = page.locator('.spinw-ball');
  const sb = (await spinBall.boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height * 0.85, { steps: 4 });
  await page.mouse.up();
  const eng = await page.evaluate(() => ({
    x: window.__bendy.game.englishX,
    y: window.__bendy.game.englishY,
  }));
  expect(eng.y).toBeGreaterThan(0.5);
  await page.screenshot({ path: `${SHOTS}/05b-dial.png` });
  await page.getByRole('button', { name: 'Shoot' }).click();
  await page.waitForFunction(() => ['strike', 'sim', 'resolve'].includes(window.__bendy.phase()));
  expect(await page.evaluate(() => window.__bendy.state().shots)).toBe(1);
  expect(errors).toEqual([]);
});

test('demo mode keeps playing without errors', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, '?demo=1&seed=5&mute=1', errors);
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(400);
    seen.add(await page.evaluate(() => window.__bendy.phase()));
    if (i === 20) await page.screenshot({ path: `${SHOTS}/07-demo.png` });
  }
  expect(seen.has('plan')).toBe(true);
  expect(seen.has('sim')).toBe(true);
  expect(errors).toEqual([]);
});

test('phone portrait rotates the table and still plays', async ({ browser }) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const errors: string[] = [];
  await boot(page, '?seed=11&mute=1&remix=0', errors);
  await page.evaluate(() => {
    window.__bendy.manual(true);
    window.__bendy.start();
    window.__bendy.untilPhase('plan', 8);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/08-phone.png` });
  expect(await page.evaluate(() => window.__bendy.shoot(0.6))).toBe(true);
  expect(errors).toEqual([]);
  await page.close();
});

test('toy tray: drag a wall onto the table with a real pointer, then undo it', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, '?seed=3&mute=1&toys=1&remix=0', errors);
  await page.evaluate(() => {
    window.__bendy.start();
    window.__bendy.skipSpin();
    window.__bendy.untilPhase('plan', 10);
  });
  await page.waitForFunction(() => window.__bendy.cameraSettled());
  const wall = page.getByRole('button', { name: 'WALL' });
  await expect(wall).toBeVisible();
  const from = (await wall.boundingBox())!;
  const canvas = (await page.locator('#world').boundingBox())!;
  const to = await page.evaluate(() => window.__bendy.toScreen(520, 150));
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + to.x, canvas.y + to.y, { steps: 8 });
  await page.mouse.up();
  const placed = await page.evaluate(() => window.__bendy.state());
  expect(placed.parts).toHaveLength(1);
  expect(placed.parts[0].kind).toBe('stub');
  expect(Math.abs(placed.parts[0].x - 520)).toBeLessThan(2);
  expect(placed.tray[0]).toBe(0);
  await page.screenshot({ path: `${SHOTS}/06-tray.png` });
  await page.getByRole('button', { name: 'UNDO' }).click();
  const undone = await page.evaluate(() => window.__bendy.state());
  expect(undone.parts).toHaveLength(0);
  expect(undone.tray[0]).toBe(1);
  expect(errors).toEqual([]);
});

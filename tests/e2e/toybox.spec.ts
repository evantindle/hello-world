import { expect, test } from '@playwright/test';
import { boot, SHOTS } from './helpers';

test('toy box: put a wall down by hand, shoot, rewind, then share the shot and open the link', async ({
  page,
}) => {
  const errors: string[] = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, '?mute=1&seed=7', errors);
  await page.getByRole('button', { name: 'Toy Box' }).click();
  await page.evaluate(() => {
    window.__bendy.skipSpin();
    window.__bendy.untilPhase('plan', 10);
  });
  await page.waitForFunction(() => window.__bendy.cameraSettled());

  // A wall, dragged out of the box with a real pointer.
  const wall = page.getByRole('button', { name: 'WALL' });
  const from = (await wall.boundingBox())!;
  const canvas = (await page.locator('#world').boundingBox())!;
  const to = await page.evaluate(() => window.__bendy.toScreen(520, 140));
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + to.x, canvas.y + to.y, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__bendy.state().parts.length)).toBe(1);

  // Shoot, then take it back.
  const before = await page.evaluate(() => window.__bendy.state());
  await page.evaluate(() => {
    window.__bendy.manual(true);
    window.__bendy.shoot(0.75);
    window.__bendy.stepSeconds(1.5);
    window.__bendy.untilPhase('plan', 60);
    window.__bendy.tick(1 / 60, 10);
  });
  expect(await page.evaluate(() => window.__bendy.state().shots)).toBe(1);
  await page.getByRole('button', { name: 'REWIND' }).click();
  const rewound = await page.evaluate(() => window.__bendy.state());
  expect(rewound.shots).toBe(0);
  expect(rewound.parts).toEqual(before.parts);
  expect(rewound.balls).toEqual(before.balls);
  expect(rewound.aim).toBe(before.aim);

  // Shoot for real, share it, and open the link.
  await page.evaluate(() => {
    window.__bendy.shoot(0.75);
    window.__bendy.stepSeconds(1.5);
    window.__bendy.untilPhase('plan', 60);
    window.__bendy.manual(false);
  });
  const url: string = await page.evaluate(() => window.__bendy.shareLink());
  expect(url).toMatch(/#s=z[A-Za-z0-9_-]+$/);
  await page.goto(url);
  await page.waitForFunction(() => window.__bendy?.ready && window.__bendy.game.rules.mode === 'viewer');
  await expect(page.locator('.viewer-panel')).toBeVisible();
  await page.waitForFunction(() => window.__bendy.game.replayOk !== null, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__bendy.game.replayOk)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/14-viewer.png` });

  // The shared table, in the Toy Box.
  await page.getByRole('button', { name: 'Play this table' }).click();
  await page.waitForFunction(() => window.__bendy.game.rules.mode === 'toybox');
  const played = await page.evaluate(() => window.__bendy.state());
  expect(played.parts.map((p: { kind: string }) => p.kind)).toEqual(['stub']);
  expect(await page.evaluate(() => location.hash)).toBe('');
  expect(errors).toEqual([]);
});

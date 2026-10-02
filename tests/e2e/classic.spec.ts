import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { boot, SHOTS } from './helpers';

const solution = (id: string) => JSON.parse(fs.readFileSync(`tests/levels/solutions/${id}.json`, 'utf8'));

test('classic: win level 1 with its recorded solution; the stars are kept and level 2 opens', async ({
  page,
}) => {
  const errors: string[] = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, '?mute=1', errors);
  await page.getByRole('button', { name: 'Classic' }).click();
  await expect(page.getByRole('button', { name: /Level 2/ })).toBeDisabled();
  await page.getByRole('button', { name: /Level 1/ }).click();
  await expect(page.locator('.intro-card')).toContainText('BEND HERE');
  await page.screenshot({ path: `${SHOTS}/10-intro.png` });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const stroke = solution('rr-01').strokes[0];
  await page.evaluate((s) => {
    window.__bendy.manual(true);
    window.__bendy.skipSpin();
    window.__bendy.untilPhase('plan', 10);
    window.__bendy.playStroke(s);
    window.__bendy.stepSeconds(0.1);
    window.__bendy.untilPhase('over', 40);
    window.__bendy.manual(false);
  }, stroke);
  await expect(page.locator('.win-card')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.win-star.on')).toHaveCount(3);
  await page.screenshot({ path: `${SHOTS}/11-win.png` });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bendy-billiards.v2') ?? '{}'));
  expect(saved.levels['rr-01']).toEqual({ stars: 3, best: 1 });
  await page.getByRole('button', { name: 'Levels' }).click();
  await expect(page.getByRole('button', { name: /Level 2: BOLTED DOWN/ })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('classic: running out of strokes flips the table; TRY AGAIN starts the level over', async ({ page }) => {
  const errors: string[] = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, '?mute=1&dev=1&level=rr-01', errors);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.evaluate(() => {
    window.__bendy.manual(true);
    window.__bendy.skipSpin();
    window.__bendy.untilPhase('plan', 10);
    // No bend: the ball misses, and level 1 has a single stroke.
    window.__bendy.shoot(0.5);
    window.__bendy.stepSeconds(0.1);
    window.__bendy.untilPhase('over', 40);
    window.__bendy.tick(1 / 60, 30);
  });
  expect(await page.evaluate(() => window.__bendy.game.lastOver.result)).toBe('fail');
  await page.screenshot({ path: `${SHOTS}/12-flip.png` });
  await page.evaluate(() => window.__bendy.manual(false));
  await expect(page.locator('.fail-card')).toContainText('OUT OF STROKES', { timeout: 5000 });
  await page.screenshot({ path: `${SHOTS}/13-fail.png` });
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForFunction(() => window.__bendy.phase() === 'spin' || window.__bendy.phase() === 'plan');
  const st = await page.evaluate(() => window.__bendy.state());
  expect(st.shots).toBe(0);
  expect(st.tokens).toBe(2);
  expect(errors).toEqual([]);
});

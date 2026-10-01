import { describe, expect, it } from 'vitest';
import { FF_SCALE } from '../../src/config';
import { Game } from '../../src/game/game';
import { FREE_RULES } from '../../src/game/ruleset';
import { beats, styleOf } from '../../src/game/scoring';
import { newLog, type Pot } from '../../src/physics/log';

const pot = (o: Partial<Pot>): Pot => ({
  ball: 1,
  pocket: 0,
  t: 1,
  gen: 1,
  banks: 0,
  via: 0,
  warps: 0,
  ...o,
});

function logWith(pots: Pot[], scratch = false) {
  const log = newLog();
  log.pots = pots;
  if (scratch) log.scratch = { pocket: 0 };
  return log;
}

describe('style points', () => {
  it('pay for depth, banks, toys and combos; a scratch costs', () => {
    expect(styleOf(logWith([]))).toBe(0);
    expect(styleOf(logWith([pot({})]))).toBe(200);
    expect(styleOf(logWith([pot({ gen: 2 })]))).toBe(300);
    expect(styleOf(logWith([pot({ banks: 1 })]))).toBe(300);
    expect(styleOf(logWith([pot({ banks: 2 })]))).toBe(450);
    // Banks top out at x3.
    expect(styleOf(logWith([pot({ banks: 9 })]))).toBe(600);
    expect(styleOf(logWith([pot({ via: 2, warps: 1 })]))).toBe(200 + 150 + 100);
    // A ball only a toy moved scores like a direct hit.
    expect(styleOf(logWith([pot({ gen: 255 })]))).toBe(200);
    // Two balls: (200 + 300) x 2.
    expect(styleOf(logWith([pot({}), pot({ ball: 2, gen: 2 })]))).toBe(1000);
    expect(styleOf(logWith([], true))).toBe(-200);
    // The cue ball dropping is a scratch, not points.
    expect(styleOf(logWith([pot({ ball: 0 })], true))).toBe(-200);
  });

  it('break ties between equal scores', () => {
    expect(beats(12, 0, null)).toBe(true);
    expect(beats(11, 0, { score: 12, style: 5000 })).toBe(true);
    expect(beats(12, 4000, { score: 12, style: 3000 })).toBe(true);
    expect(beats(12, 3000, { score: 12, style: 3000 })).toBe(false);
    expect(beats(13, 99999, { score: 12, style: 0 })).toBe(false);
  });

  it('add up over a game, never below zero', () => {
    const g = new Game({ seed: 6, rules: FREE_RULES });
    g.load({ rules: FREE_RULES, seed: 6 });
    const styles: number[] = [];
    g.events.on('turnResult', (r) => styles.push(r.style));
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 3000 && g.phase !== 'plan'; i++) g.update(1 / 60);
      g.shoot(0.9);
      for (let i = 0; i < 3000 && (g.phase === 'plan' || g.phase === 'strike' || g.phase === 'sim'); i++)
        g.update(1 / 60);
      for (let i = 0; i < 300 && g.phase === 'resolve'; i++) g.update(1 / 60);
    }
    expect(styles).toHaveLength(3);
    let total = 0;
    for (const s of styles) total = Math.max(0, total + s);
    expect(g.style).toBe(total);
    styles.forEach((s, i) => expect(s).toBe(styleOf(g.history[i]!.log)));
  });
});

describe('fast-forward', () => {
  it('speeds the shot up while held, and only during the shot', () => {
    const g = new Game({ seed: 3, rules: FREE_RULES });
    g.load({ rules: FREE_RULES, seed: 3 });
    for (let i = 0; i < 3000 && g.phase !== 'plan'; i++) g.update(1 / 60);
    g.ff = true;
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    expect(g.timeScale).toBe(1);
    g.shoot(1);
    for (let i = 0; i < 300 && g.phase !== 'sim'; i++) g.update(1 / 60);
    for (let i = 0; i < 40; i++) g.update(1 / 60);
    expect(g.phase).toBe('sim');
    expect(g.timeScale).toBeCloseTo(FF_SCALE, 2);
    g.ff = false;
    for (let i = 0; i < 40 && g.phase === 'sim'; i++) g.update(1 / 60);
    if (g.phase === 'sim') expect(g.timeScale).toBeLessThan(1.2);
  });
});

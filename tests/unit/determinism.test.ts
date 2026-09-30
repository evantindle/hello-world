import { describe, expect, it } from 'vitest';
import { createRng, rngFor } from '../../src/core/rng';
import { Game, type Phase } from '../../src/game/game';
import { simulateShot } from '../../src/game/record';
import { FREE_RULES } from '../../src/game/ruleset';
import { hashBoard, restoreState, snapState } from '../../src/game/serialize';
import { quantizeShot } from '../../src/game/shot';

const DT = 1 / 60;

function runUntil(g: Game, pred: () => boolean, maxSeconds = 120) {
  let t = 0;
  while (!pred() && t < maxSeconds) {
    g.update(DT);
    t += DT;
  }
  expect(pred()).toBe(true);
}

/** A scripted game: a bend or two and a random power every stroke, for `strokes` strokes. */
function playScripted(seed: number, strokes: number): Game {
  const g = new Game({ seed });
  const rng = createRng(seed ^ 0xabc);
  const phase = (): Phase => g.phase;
  g.start();
  for (let k = 0; k < strokes; k++) {
    runUntil(g, () => phase() === 'plan' || phase() === 'over');
    if (phase() === 'over') break;
    const vs = g.table.verts;
    const v = vs[rng.int(vs.length)]!;
    const h = g.hitHandle(v.x, v.y, 5);
    if (h && g.beginDrag(h, v.x, v.y)) {
      g.dragTo(v.x + rng.range(-100, 100), v.y + rng.range(-100, 100));
      g.endDrag();
    }
    g.shoot(rng.range(0.3, 1));
  }
  runUntil(g, () => phase() === 'plan' || phase() === 'over');
  return g;
}

describe('determinism', () => {
  it('every recorded stroke re-simulates to the identical resting position', () => {
    const g = playScripted(2024, 6);
    expect(g.history.length).toBeGreaterThanOrEqual(5);
    for (const rec of g.history) {
      const again = simulateShot(rec.pre, rec.shot);
      expect(again.hash).toBe(rec.postHash);
      expect(again.world.log.pots.map((p) => p.ball)).toEqual(rec.log.pots.map((p) => p.ball));
    }
  });

  it('the same seed and inputs give the same game, stroke for stroke', () => {
    const a = playScripted(77, 5);
    const b = playScripted(77, 5);
    expect(a.history.map((r) => r.postHash)).toEqual(b.history.map((r) => r.postHash));
    expect(hashBoard(a.table, a.balls)).toBe(hashBoard(b.table, b.balls));
  });

  it('a saved state restores exactly, through JSON', () => {
    const g = playScripted(5, 3);
    const saved = JSON.parse(JSON.stringify(snapState(g))) as ReturnType<typeof snapState>;
    const h = new Game({ seed: 1 });
    restoreState(h, saved);
    expect(hashBoard(h.table, h.balls)).toBe(hashBoard(g.table, g.balls));
    expect(h.shots).toBe(g.shots);
    expect(h.budget).toBe(g.budget);
  });

  it('spins are independent per stroke: forcing one angle leaves the rest alone', () => {
    const a = new Game({ seed: 31, rules: FREE_RULES });
    const b = new Game({ seed: 31, rules: FREE_RULES });
    const angles = (g: Game, force: boolean) => {
      const out: number[] = [];
      g.start();
      for (let k = 0; k < 4; k++) {
        runUntil(g, () => g.phase === 'plan');
        out.push(g.aim);
        g.shoot(0.1);
        // The next spin picks its angle as it starts, so force it before then.
        if (force && k === 0) g.forcedAngle = 1;
        runUntil(g, () => g.phase === 'spin' || g.phase === 'over');
      }
      return out;
    };
    const plain = angles(a, false);
    const forced = angles(b, true);
    expect(forced[1]).toBe(1);
    expect(forced[0]).toBe(plain[0]);
    expect(forced[2]).toBe(plain[2]);
    expect(forced[3]).toBe(plain[3]);
    expect(plain[2]).toBe(rngFor(31, 'spin', 2).range(0, 2 * Math.PI));
  });

  it('quantized shots are exact and symmetric', () => {
    const q = quantizeShot(0, 0.85);
    expect(q).toEqual({ dx: 32767, dy: 0, p: 850, ex: 0, ey: 0 });
    const r = quantizeShot(Math.PI / 2, 1, 1, -1);
    expect(r).toEqual({ dx: 0, dy: 32767, p: 1000, ex: 100, ey: -100 });
  });
});

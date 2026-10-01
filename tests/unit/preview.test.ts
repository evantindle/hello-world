import { describe, expect, it } from 'vitest';
import { Game } from '../../src/game/game';
import { PREVIEW_T, Previewer } from '../../src/game/preview';
import { FREE_RULES, V1_RULES } from '../../src/game/ruleset';
import { quantizeShot } from '../../src/game/shot';
import { buildGeom, createTable } from '../../src/geom/table';
import { makeBall } from '../../src/physics/world';

const DT = 1 / 60;

function runUntil(g: Game, pred: () => boolean, maxSeconds = 60) {
  let t = 0;
  while (!pred() && t < maxSeconds) {
    g.update(DT);
    t += DT;
  }
  expect(pred()).toBe(true);
}

function planning(seed: number): Game {
  const g = new Game({ seed, rules: FREE_RULES });
  g.load({ rules: FREE_RULES, seed });
  runUntil(g, () => g.phase === 'plan');
  return g;
}

describe('chain preview', () => {
  it('predicts the real shot exactly: same drops, same resting places', () => {
    for (const seed of [3, 11, 27, 40]) {
      const g = planning(seed);
      g.setDial(0.85);
      g.setEnglish(0.3, -0.4);
      const before = g.balls.map((b) => [b.x, b.y, b.vx, b.vy]);
      const p = g.previewNow(60);
      // Working it out did not touch the real balls.
      expect(g.balls.map((b) => [b.x, b.y, b.vx, b.vy])).toEqual(before);
      expect(p.done).toBe(true);
      g.shoot();
      runUntil(g, () => g.phase !== 'plan' && g.phase !== 'strike' && g.phase !== 'sim');
      const pots = g.history[0]!.log.pots.filter((q) => q.ball !== 0).map((q) => [q.ball, q.pocket]);
      expect(p.drops.map((d) => [d.num, d.pocket])).toEqual(pots);
      expect(p.scratch).toBe(g.history[0]!.log.scratch !== null);
      for (const tr of p.tracks) {
        const b = g.balls.find((q) => q.id === tr.id)!;
        if (tr.drop === null && b.active) expect([tr.end.x, tr.end.y]).toEqual([b.x, b.y]);
      }
    }
  });

  it('shows the first moments: the cue ball, the balls it hits, the contacts', () => {
    const g = planning(5);
    g.setDial(1);
    const p = g.previewNow();
    expect(p.horizon).toBe(PREVIEW_T);
    const cue = p.tracks.find((t) => t.num === 0)!;
    expect(cue.gen).toBe(0);
    expect(cue.segs[0]!.slice(0, 2)).toEqual([g.cue.x, g.cue.y]);
    // Points are kept a few units apart.
    const s = cue.segs[0]!;
    for (let i = 2; i + 3 < s.length; i += 2) {
      expect(Math.hypot(s[i + 2]! - s[i]!, s[i + 3]! - s[i + 1]!)).toBeGreaterThanOrEqual(4 - 1e-9);
    }
    if (p.contacts.length > 0) expect(p.tracks.some((t) => t.gen === 1)).toBe(true);
  });

  it('remembers recent results, and works in slices', () => {
    const g = planning(8);
    const seen: unknown[] = [];
    // Bit by bit: a zero budget still makes progress every call.
    for (
      let i = 0;
      i < 400 && !(g.previewer.current?.done && g.previewer.current.key.endsWith(`|${PREVIEW_T}`));
      i++
    ) {
      g.update(DT);
    }
    const a = g.previewer.current!;
    expect(a.done).toBe(true);
    seen.push(a);
    g.setDial(0.2);
    for (let i = 0; i < 400 && g.previewer.current === a; i++) g.update(DT);
    const b = g.previewer.current!;
    expect(b).not.toBe(a);
    g.setDial(0.6);
    g.update(DT);
    // Back to the first setting: straight from the cache.
    expect(g.previewer.current).toBe(a);
    const whole = new Previewer().compute({
      key: 'x',
      geom: g.geom,
      balls: g.balls,
      seed: g.seed,
      stroke: g.shots + 1,
      shot: quantizeShot(g.aim, 0.6, g.englishX, g.englishY),
      horizon: PREVIEW_T,
    });
    expect(whole.tracks.map((t) => t.segs)).toEqual(a.tracks.map((t) => t.segs));
  });

  it('breaks a path where a portal moves the ball', () => {
    const t = createTable();
    for (const v of t.verts) v.pocket = false;
    t.parts = [
      { id: 1, kind: 'portal', x: 400, y: 250, link: 2, r: 40 },
      { id: 2, kind: 'portal', x: 700, y: 120, link: 1, r: 40 },
    ];
    const geom = buildGeom(t);
    const cue = makeBall({ id: 0, x: 150, y: 250 });
    const p = new Previewer().compute({
      key: 'portal',
      geom,
      balls: [cue],
      seed: 1,
      stroke: 1,
      shot: quantizeShot(0, 0.5, 0, 0),
      horizon: 1,
    });
    const tr = p.tracks[0]!;
    expect(tr.segs.length).toBeGreaterThanOrEqual(2);
    // The second piece starts at the far portal.
    expect(Math.hypot(tr.segs[1]![0]! - 700, tr.segs[1]![1]! - 120)).toBeLessThan(40);
  });

  it('only runs for rules that show it', () => {
    const g = new Game({ seed: 2, rules: V1_RULES });
    g.start();
    runUntil(g, () => g.phase === 'plan');
    for (let i = 0; i < 30; i++) g.update(DT);
    expect(g.preview).toBeNull();
    expect(g.previewer.current).toBeNull();
  });
});

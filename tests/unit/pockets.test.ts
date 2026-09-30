import { describe, expect, it } from 'vitest';
import { R } from '../../src/config';
import { Game } from '../../src/game/game';
import { moveVertex, removeBend } from '../../src/game/reshape';
import { FREE_RULES } from '../../src/game/ruleset';
import { buildGeom, canSplitEdge, chomperOpen, createTable, insertVertex, type PocketTrait, type Table } from '../../src/geom/table';
import { accepts } from '../../src/physics/pockets';
import { makeBall, type PhysEvent } from '../../src/physics/world';
import { ball, run } from './helpers';

/** The standard table with a trait on the top-left corner pocket (vertex 0, hole near (-12,-12)). */
function withTrait(trait: PocketTrait): Table {
  const t = createTable();
  t.verts[0]!.trait = trait;
  return t;
}

/** A ball rolling straight into the top-left corner along the diagonal. */
function diagonal(id: number, speed: number) {
  const s = speed / Math.SQRT2;
  return ball(id, 160, 160, -s, -s);
}

describe('pocket traits', () => {
  it('accepts(): picky by suit, gentle by speed, chomper by the clock, the cue never picky', () => {
    const g = buildGeom(withTrait({ kind: 'picky', suit: 'warm' }));
    const p = g.pockets.find((q) => q.vid === 0)!;
    expect(accepts(p, makeBall({ id: 3, x: 0, y: 0 }), 0)).toBe(true); // 3 is warm
    expect(accepts(p, makeBall({ id: 4, x: 0, y: 0 }), 0)).toBe(false); // 4 is cool
    expect(accepts(p, makeBall({ id: 0, x: 0, y: 0 }), 0)).toBe(false); // the cue ball

    const gg = buildGeom(withTrait({ kind: 'gentle', vmax: 300 })).pockets.find((q) => q.vid === 0)!;
    expect(accepts(gg, makeBall({ id: 1, x: 0, y: 0, vx: 200 }), 0)).toBe(true);
    expect(accepts(gg, makeBall({ id: 1, x: 0, y: 0, vx: 400 }), 0)).toBe(false);

    const ch = { kind: 'chomper', period: 1, open: 0.4, phase: 0 } as const;
    const gc = buildGeom(withTrait(ch)).pockets.find((q) => q.vid === 0)!;
    expect(gc.plug).not.toBeNull();
    expect(chomperOpen(ch, 0.2)).toBe(true);
    expect(chomperOpen(ch, 0.6)).toBe(false);
    expect(chomperOpen(ch, 1.2)).toBe(true);
    expect(accepts(gc, makeBall({ id: 1, x: 0, y: 0 }), 0.6)).toBe(false);
  });

  it('a corked pocket is closed: no hole to fall in, rails straight across', () => {
    const g = buildGeom(withTrait({ kind: 'corked', strokes: 2 }));
    const p = g.pockets.find((q) => q.vid === 0)!;
    expect(p.open).toBe(false);
    expect(g.rails[0]!.t0).toBe(0); // the rail from vertex 0 is not cut back for a mouth
    const b = diagonal(1, 700);
    run([b], g, 3);
    expect(b.active).toBe(true);
  });

  it('a picky pocket spits out a ball of the wrong suit (and does not suck it in)', () => {
    const t = withTrait({ kind: 'picky', suit: 'warm' });
    const cool = diagonal(2, 700);
    const { events } = run([cool], t, 3);
    expect(cool.active).toBe(true);
    expect(events.some((e) => e.type === 'spat')).toBe(true);
    const warm = diagonal(1, 700);
    run([warm], withTrait({ kind: 'picky', suit: 'warm' }), 3);
    expect(warm.active).toBe(false);
  });

  it('a gentle pocket takes a slow ball and bounces a fast one', () => {
    // Fast: spat straight back out on arrival (it may trickle back in later, gently).
    const fast = diagonal(1, 1400);
    const f = run([fast], withTrait({ kind: 'gentle', vmax: 300 }), 0.35);
    expect(fast.active).toBe(true);
    expect(f.events.some((e) => e.type === 'spat')).toBe(true);
    // Slow: starts close and rolls in under its own steam.
    const slow = ball(1, 45, 45, -190, -190);
    run([slow], withTrait({ kind: 'gentle', vmax: 400 }), 3);
    expect(slow.active).toBe(false);
  });

  it('a chomper swallows a ball that arrives while it is open and bounces one while it is shut', () => {
    const open = { kind: 'chomper', period: 10, open: 0.99, phase: 0 } as const;
    const a = diagonal(1, 700);
    run([a], withTrait(open), 3);
    expect(a.active).toBe(false);
    const shut = { kind: 'chomper', period: 10, open: 0.001, phase: 0.5 } as const;
    const b = diagonal(1, 700);
    const { events } = run([b], withTrait(shut), 3);
    expect(b.active).toBe(true);
    expect(events.some((e: PhysEvent) => e.type === 'wallHit' && e.edge === -1)).toBe(true);
  });

  it('closing jaws shove a ball out of the mouth', () => {
    // Open for the first 0.05 s, then shut; the ball sits in the mouth, short of the hole.
    const tr = { kind: 'chomper', period: 10, open: 0.005, phase: 0 } as const;
    const t = withTrait(tr);
    const plug = buildGeom(t).pockets.find((q) => q.vid === 0)!.plug!;
    const b = ball(1, 30, 30, 0, 0);
    const front = (x: number, y: number) => (x - plug.ax) * plug.nx + (y - plug.ay) * plug.ny;
    expect(front(b.x, b.y)).toBeLessThan(R);
    const { events } = run([b], t, 0.5);
    expect(b.active).toBe(true);
    expect(front(b.x, b.y)).toBeGreaterThanOrEqual(R - 0.5);
    expect(events.some((e) => e.type === 'chomp')).toBe(true);
  });
});

describe('rail materials', () => {
  function bounce(mat: 'felt' | 'trampoline' | 'dead'): number {
    const t = createTable();
    for (const v of t.verts) {
      v.pocket = false;
      v.mat = mat;
    }
    const b = ball(1, 500, 250, 0, -900);
    const { events } = run([b], t, 0.4);
    expect(events.some((e) => e.type === 'wallHit')).toBe(true);
    return b.vy;
  }

  it('trampolines add bounce, dead rails soak it up', () => {
    const felt = bounce('felt');
    expect(bounce('trampoline')).toBeGreaterThan(felt * 1.25);
    expect(bounce('dead')).toBeLessThan(felt * 0.5);
  });

  it('steel edges take no new bends, and bends next to steel stay put', () => {
    const t = createTable();
    t.verts[0]!.mat = 'steel';
    expect(canSplitEdge(t, 0)).toBe(false);
    expect(canSplitEdge(t, 3)).toBe(true);
    // A bend on edge 3 next to... make edge 3 itself steel after inserting a bend: it inherits.
    const idx = insertVertex(t, 3);
    t.verts[3]!.mat = 'steel';
    t.verts[idx]!.mat = 'steel';
    t.verts[idx]!.y += 60;
    const host = { table: t, geom: buildGeom(t), balls: [], budget: 600, hunger: 0 };
    const r = removeBend(host, t.verts[idx]!.id);
    expect(r.removed).toBe(false);
    expect(r.blocked).toBe('steel');
  });

  it('a split edge keeps its material on both halves', () => {
    const t = createTable();
    t.verts[1]!.mat = 'trampoline';
    const idx = insertVertex(t, 1);
    expect(t.verts[idx]!.mat).toBe('trampoline');
    expect(buildGeom(t).rails.filter((r) => r.mat === 'trampoline')).toHaveLength(2);
  });
});

describe('bolts and corks in play', () => {
  it('a bolted knob will not move, and grabbing it says so', () => {
    const g = new Game({ seed: 4 });
    g.table.verts[3]!.bolted = true;
    const host = { table: g.table, geom: g.geom, balls: g.balls, budget: 600, hunger: 0 };
    expect(moveVertex(host, g.table.verts[3]!.id, 1100, 560).blocked).toBe('bolted');
    const blocked: string[] = [];
    g.events.on('blocked', (e) => blocked.push(e.reason));
    g.start();
    for (let i = 0; i < 400 && g.phase !== 'plan'; i++) g.update(1 / 60);
    const v = g.table.verts[3]!;
    const h = g.hitHandle(v.x, v.y, 5)!;
    expect(h.locked).toBe(true);
    expect(g.beginDrag(h, v.x, v.y)).toBe(false);
    expect(blocked).toContain('bolted');
  });

  it('scratching in Free Play bolts that pocket for the rest of the game', () => {
    const t = createTable();
    const g = new Game({ seed: 1 });
    // Cue ball a short roll from the top-left corner; one object ball far away.
    g.load({
      rules: FREE_RULES,
      seed: 1,
      table: t,
      balls: [makeBall({ id: 0, x: 120, y: 120 }), makeBall({ id: 5, x: 800, y: 400 })],
    });
    const bolted: number[] = [];
    g.events.on('pocketBolted', (e) => bolted.push(e.vid));
    g.forcedAngle = (-3 * Math.PI) / 4; // up-left, straight at the corner
    for (let i = 0; i < 600 && g.phase !== 'plan'; i++) g.update(1 / 60);
    g.forcedAngle = null;
    // The first spin already started; re-aim this stroke directly.
    g.aim = (-3 * Math.PI) / 4;
    g.shoot(0.35);
    for (let i = 0; i < 1200 && !(g.phase === 'spin' || g.phase === 'respawn'); i++) g.update(1 / 60);
    expect(g.penalties).toBe(1);
    expect(bolted).toEqual([0]);
    expect(g.table.verts.find((v) => v.id === 0)!.bolted).toBe(true);
  });

  it('corks count down each stroke and then pop open', () => {
    const t = createTable();
    t.verts[2]!.trait = { kind: 'corked', strokes: 2 };
    const g = new Game({ seed: 2 });
    g.load({
      rules: FREE_RULES,
      seed: 2,
      table: t,
      balls: [makeBall({ id: 0, x: 300, y: 250 }), makeBall({ id: 1, x: 700, y: 250 })],
    });
    const pops: number[] = [];
    g.events.on('uncorked', (e) => pops.push(e.vid));
    const stroke = () => {
      for (let i = 0; i < 600 && g.phase !== 'plan'; i++) g.update(1 / 60);
      g.shoot(0.05);
      for (let i = 0; i < 1200 && g.phase !== 'spin' && g.phase !== 'over'; i++) g.update(1 / 60);
    };
    stroke();
    expect(g.geom.pockets.find((p) => p.vid === 2)!.open).toBe(false);
    stroke();
    expect(pops).toEqual([2]);
    expect(g.geom.pockets.find((p) => p.vid === 2)!.open).toBe(true);
  });

  it('balls never escape a table full of trampolines at full speed', () => {
    const t = createTable();
    for (const v of t.verts) {
      v.pocket = false;
      v.mat = 'trampoline';
    }
    const balls = [ball(0, 300, 250, 2900, 700), ball(1, 600, 200), ball(2, 650, 300), ball(3, 450, 120)];
    const { w } = run(balls, t, 30);
    expect(w.stopped).toBe(true);
    for (const b of balls) {
      expect(b.x).toBeGreaterThan(R - 1);
      expect(b.x).toBeLessThan(1000 - R + 1);
      expect(b.y).toBeGreaterThan(R - 1);
      expect(b.y).toBeLessThan(500 - R + 1);
    }
  });
});

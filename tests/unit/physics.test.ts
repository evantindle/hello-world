import { describe, expect, it } from 'vitest';
import { E_BALL, E_WALL, H, R, SIM_TIMEOUT, T_DAMP, V_MAX } from '../../src/config';
import { createRng } from '../../src/core/rng';
import { pointInPolygon } from '../../src/geom/polygon';
import { buildGeom, createTable, type Table } from '../../src/geom/table';
import { rackBalls } from '../../src/game/rules';
import { collideBalls, createWorld, makeBall, stepWorld, type Ball, type PhysEvent } from '../../src/physics/world';

function ball(id: number, x: number, y: number, vx = 0, vy = 0): Ball {
  return makeBall({ id, x, y, vx, vy });
}

function run(balls: Ball[], table: Table, seconds: number) {
  const w = createWorld(balls, buildGeom(table));
  const events: PhysEvent[] = [];
  const steps = Math.round(seconds / H);
  for (let i = 0; i < steps; i++) stepWorld(w, H, events);
  return { w, events };
}

/** The starting rectangle with every pocket plugged (no holes). */
function sealedTable(): Table {
  const t = createTable();
  for (const v of t.verts) v.pocket = false;
  return t;
}

describe('ball-ball collisions', () => {
  it('head-on hit transfers momentum with the configured restitution', () => {
    const a = ball(1, 0, 0, 1000, 0);
    const b = ball(2, 2 * R - 1, 0);
    collideBalls(a, b, []);
    expect(a.vx + b.vx).toBeCloseTo(1000);
    expect(a.vx).toBeCloseTo((1000 * (1 - E_BALL)) / 2);
    expect(b.vx).toBeCloseTo((1000 * (1 + E_BALL)) / 2);
  });

  it('random oblique hits conserve momentum and never gain energy', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const d = rng.range(R, 2 * R - 0.1);
      const a = ball(1, 0, 0, rng.range(-2000, 2000), rng.range(-2000, 2000));
      const b = ball(2, Math.cos(ang) * d, Math.sin(ang) * d, rng.range(-2000, 2000), rng.range(-2000, 2000));
      const px = a.vx + b.vx;
      const py = a.vy + b.vy;
      const ke = a.vx ** 2 + a.vy ** 2 + b.vx ** 2 + b.vy ** 2;
      collideBalls(a, b, []);
      expect(a.vx + b.vx).toBeCloseTo(px, 6);
      expect(a.vy + b.vy).toBeCloseTo(py, 6);
      expect(a.vx ** 2 + a.vy ** 2 + b.vx ** 2 + b.vy ** 2).toBeLessThanOrEqual(ke + 1e-6);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(2 * R - 1e-6);
    }
  });
});

describe('rails', () => {
  it('reflects the normal component with restitution and damps the tangent', () => {
    const b = ball(0, 300, 30, 400, -400);
    const events: PhysEvent[] = [];
    const w = createWorld([b], buildGeom(sealedTable()));
    for (let i = 0; i < 4; i++) stepWorld(w, H, events);
    const hit = events.find((e) => e.type === 'wallHit');
    expect(hit).toBeDefined();
    // One wall hit, no friction worth mentioning over 4 steps: check the ratio of components.
    expect(b.vy).toBeGreaterThan(0);
    expect(b.vy / b.vx).toBeCloseTo((400 * E_WALL) / (400 * T_DAMP), 1);
  });

  it('balls at max speed never escape a sealed table, even a spiky one', () => {
    const rng = createRng(11);
    const spiky = sealedTable();
    // Push both side "pockets" deep into the felt to make reflex spikes.
    spiky.verts[1]!.y = 150;
    spiky.verts[4]!.y = 350;
    for (const table of [sealedTable(), spiky]) {
      const geom = buildGeom(table);
      for (let k = 0; k < 20; k++) {
        const a = rng.range(0, Math.PI * 2);
        const b = ball(0, 250, 250, Math.cos(a) * V_MAX, Math.sin(a) * V_MAX);
        const other = ball(1, 750, 250, -Math.cos(a) * V_MAX, Math.sin(a) * V_MAX);
        const w = createWorld([b, other], geom);
        const events: PhysEvent[] = [];
        for (let i = 0; i < 360; i++) {
          stepWorld(w, H, events);
          expect(pointInPolygon(b.x, b.y, geom.poly)).toBe(true);
          expect(pointInPolygon(other.x, other.y, geom.poly)).toBe(true);
        }
        expect(events.filter((e) => e.type === 'rescued')).toHaveLength(0);
      }
    }
  });
});

describe('pockets', () => {
  it('a ball rolling down the corner bisector drops in without touching a rail', () => {
    const s = 900 / Math.SQRT2;
    const { events } = run([ball(3, 850, 150, s, -s)], createTable(), 2);
    const firstPocket = events.findIndex((e) => e.type === 'pocketed');
    expect(firstPocket).toBeGreaterThanOrEqual(0);
    expect(events.slice(0, firstPocket).some((e) => e.type === 'wallHit')).toBe(false);
  });

  it('a slow rail-hugger gets slurped into the side pocket', () => {
    const b = ball(3, 380, R + 0.5, 360, 0);
    const { events } = run([b], createTable(), 3);
    const pot = events.find((e) => e.type === 'pocketed');
    expect(pot).toBeDefined();
    expect(pot && pot.type === 'pocketed' && pot.pocket.vx).toBe(500);
  });

  it('a fast rail-hugger skips past the side pocket', () => {
    const b = ball(3, 380, R + 0.5, 1400, 0);
    const w = createWorld([b], buildGeom(createTable()));
    const events: PhysEvent[] = [];
    while (b.x < 620 && w.t < 1) stepWorld(w, H, events);
    expect(b.active).toBe(true);
    expect(b.x).toBeGreaterThanOrEqual(620);
  });

  it('a resting ball inside the strong pull is eaten; one at the edge of the pull stays put', () => {
    const geom = buildGeom(createTable());
    const side = geom.pockets.find((p) => p.vx === 500 && p.vy === 0)!;
    const near = ball(1, side.x, side.y + 45);
    const far = ball(2, side.x + 200, side.y + 57);
    const w = createWorld([near, far], geom);
    const events: PhysEvent[] = [];
    for (let i = 0; i < 240; i++) stepWorld(w, H, events);
    expect(near.active).toBe(false);
    expect(far.active).toBe(true);
    expect(far.vx).toBe(0);
    expect(far.vy).toBe(0);
  });
});

describe('the cue ball is a character', () => {
  it('gets dizzy and skids to a stop soon after smacking an object ball', () => {
    const cue = ball(0, 200, 250, 1400, 0);
    const obj = ball(1, 400, 250 + 30); // glancing hit leaves the cue with plenty of speed
    const w = createWorld([cue, obj], buildGeom(sealedTable()));
    const events: PhysEvent[] = [];
    while (!events.some((e) => e.type === 'ballHit')) stepWorld(w, H, events);
    expect(cue.braking).toBe(true);
    const hitT = w.t;
    while (cue.vx !== 0 || cue.vy !== 0) stepWorld(w, H, events);
    expect(w.t - hitT).toBeLessThan(1.3);
  });

  it('gets tired after three cushions without hitting anything', () => {
    const cue = ball(0, 500, 250, 0, 1800); // bounces between the long rails
    const w = createWorld([cue], buildGeom(sealedTable()));
    const events: PhysEvent[] = [];
    let rails = 0;
    while (rails < 3) {
      stepWorld(w, H, events);
      rails = events.filter((e) => e.type === 'wallHit').length;
      if (rails < 3) expect(cue.braking).toBeFalsy();
    }
    expect(cue.braking).toBe(true);
  });

  it('pockets never suck in the cue ball, and it needs a more direct hit to drop', () => {
    const geom = buildGeom(createTable());
    const side = geom.pockets.find((p) => p.vx === 500 && p.vy === 0)!;
    expect(side.rc).toBeLessThan(side.r);
    const cue = ball(0, side.x, side.y + 45);
    const w = createWorld([cue], geom);
    const events: PhysEvent[] = [];
    for (let i = 0; i < 240; i++) stepWorld(w, H, events);
    expect(cue.active).toBe(true);
    expect(cue.vx).toBe(0);
  });
});

describe('settling', () => {
  it('friction stops a ball and the world reports stopped exactly once', () => {
    const { w, events } = run([ball(0, 300, 250, 500, 0)], sealedTable(), 5);
    expect(w.stopped).toBe(true);
    expect(events.filter((e) => e.type === 'stopped')).toEqual([{ type: 'stopped', timedOut: false }]);
    expect(w.balls[0]!.vx).toBe(0);
  });

  it('the ref calls time after the timeout', () => {
    const b = ball(0, 300, 250, 800, 0);
    const w = createWorld([b], buildGeom(sealedTable()));
    w.t = SIM_TIMEOUT - H / 2;
    const events: PhysEvent[] = [];
    stepWorld(w, H, events);
    expect(events).toContainEqual({ type: 'stopped', timedOut: true });
    expect(b.vx).toBe(0);
  });

  it('a full-power break settles well before the timeout with nobody escaping', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const balls = rackBalls(createRng(seed));
      const cue = balls[0]!;
      const dx = 700 - cue.x;
      const dy = 250 + (seed - 3) * 6 - cue.y;
      const l = Math.hypot(dx, dy);
      cue.vx = (dx / l) * 2300;
      cue.vy = (dy / l) * 2300;
      const geom = buildGeom(createTable());
      const w = createWorld(balls, geom);
      const events: PhysEvent[] = [];
      while (!w.stopped) stepWorld(w, H, events);
      const stop = events.find((e) => e.type === 'stopped');
      expect(stop).toEqual({ type: 'stopped', timedOut: false });
      expect(w.t).toBeLessThan(15);
      expect(events.filter((e) => e.type === 'rescued')).toHaveLength(0);
      expect(events.filter((e) => e.type === 'ballHit').length).toBeGreaterThan(5);
      for (const b of balls) {
        if (!b.active) continue;
        expect(pointInPolygon(b.x, b.y, geom.poly)).toBe(true);
        for (const o of balls) {
          if (o === b || !o.active) continue;
          expect(Math.hypot(o.x - b.x, o.y - b.y)).toBeGreaterThan(2 * R - 0.5);
        }
      }
    }
  });
});

describe('mass', () => {
  it('a heavy ball barely notices a light one, and momentum is conserved', () => {
    const cue = ball(0, 0, 0, 1000, 0);
    const heavy = makeBall({ id: 8, x: 2 * R - 1, y: 0, variant: 'bowling' });
    expect(heavy.invMass).toBeCloseTo(1 / 3);
    collideBalls(cue, heavy, []);
    // Momentum with masses 1 and 3.
    expect(cue.vx * 1 + heavy.vx * 3).toBeCloseTo(1000, 6);
    expect(heavy.vx).toBeLessThan(600);
    expect(cue.vx).toBeLessThan(0); // bounces back off the bowling ball
  });

  it('random oblique hits between unequal masses never gain energy', () => {
    const rng = createRng(11);
    for (let i = 0; i < 200; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const d = rng.range(R, 2 * R - 0.1);
      const a = ball(1, 0, 0, rng.range(-2000, 2000), rng.range(-2000, 2000));
      const b = makeBall({ id: 2, x: Math.cos(ang) * d, y: Math.sin(ang) * d, variant: 'bowling' });
      b.vx = rng.range(-2000, 2000);
      b.vy = rng.range(-2000, 2000);
      const ma = 1 / a.invMass;
      const mb = 1 / b.invMass;
      const px = ma * a.vx + mb * b.vx;
      const ke = ma * (a.vx ** 2 + a.vy ** 2) + mb * (b.vx ** 2 + b.vy ** 2);
      collideBalls(a, b, []);
      expect(ma * a.vx + mb * b.vx).toBeCloseTo(px, 6);
      expect(ma * (a.vx ** 2 + a.vy ** 2) + mb * (b.vx ** 2 + b.vy ** 2)).toBeLessThanOrEqual(ke + 1e-6);
    }
  });
});

describe('turn log', () => {
  it('records the first contact, cushions before it, and each pot with its generation', () => {
    // The cue banks off the bottom rail first, then runs into the 3.
    const t = createTable();
    const cue = ball(0, 300, 400, 400, 400);
    const three = ball(3, 600, 256);
    const { w, events } = run([cue, three], t, 6);
    const hits = events.filter((e) => e.type === 'ballHit');
    expect(hits.length).toBeGreaterThan(0);
    expect(w.log.firstContact).toBe(3);
    expect(w.log.cushionsBeforeContact).toBeGreaterThanOrEqual(1);
    expect(three.gen).toBe(1);
    const pot = w.log.pots.find((p) => p.ball === 3);
    if (pot) expect(pot.gen).toBe(1);
  });

  it('a scratch is logged with its pocket, and the cue has no resting place', () => {
    const t = createTable();
    const cue = ball(0, 100, 100, -400, -400);
    const { w } = run([cue], t, 3);
    expect(cue.active).toBe(false);
    expect(w.log.scratch?.pocket).toBe(0);
    expect(w.log.pots).toHaveLength(1);
  });
});

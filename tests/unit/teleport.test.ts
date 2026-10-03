import { describe, expect, it } from 'vitest';
import { BLACKHOLE_EXIT_V, H, LIMBO_TIME, R, V_MAX } from '../../src/config';
import { createRng } from '../../src/core/rng';
import { pointInPolygon } from '../../src/geom/polygon';
import type { Part } from '../../src/geom/parts';
import { buildGeom, type Table } from '../../src/geom/table';
import { flushLimbo } from '../../src/physics/floor';
import {
  createWorld,
  makeBall,
  stepWorld,
  worldRand,
  type Ball,
  type PhysEvent,
  type World,
} from '../../src/physics/world';
import { ball, run, runUntilStopped, sealedTable } from './helpers';

function tableWith(...parts: Part[]): Table {
  const t = sealedTable();
  t.parts = parts;
  return t;
}

const portals = (ax: number, ay: number, bx: number, by: number, r = 40): Part[] => [
  { id: 1, kind: 'portal', x: ax, y: ay, link: 2, r },
  { id: 2, kind: 'portal', x: bx, y: by, link: 1, r },
];

const hole = (exits: { x: number; y: number }[], r = 110): Part => ({
  id: 9,
  kind: 'blackhole',
  x: 500,
  y: 250,
  r,
  exits,
});

/** Steps until an event of the given type shows up; returns the step count (or -1). */
function stepUntil(w: World, type: PhysEvent['type'], events: PhysEvent[], max = 600): number {
  for (let i = 0; i < max; i++) {
    const mark = events.length;
    stepWorld(w, H, events);
    if (events.slice(mark).some((e) => e.type === type)) return i;
  }
  return -1;
}

describe('portals', () => {
  it('a ball rolling into one end comes out of the other, same offset, same velocity', () => {
    const b = ball(1, 150, 150, 700, 0);
    const w = createWorld([b], buildGeom(tableWith(...portals(300, 150, 700, 350))));
    const events: PhysEvent[] = [];
    expect(stepUntil(w, 'warp', events)).toBeGreaterThan(0);
    const e = events.find((q) => q.type === 'warp')!;
    if (e.type !== 'warp') throw new Error('no warp');
    expect(e.src).toBe(1);
    expect(e.link).toBe(2);
    // Offsets from each end's centre match.
    expect(e.x - 700).toBeCloseTo(e.fromX - 300, 9);
    expect(e.y - 350).toBeCloseTo(e.fromY - 150, 9);
    expect(b.x).toBe(e.x);
    expect(b.y).toBe(e.y);
    expect(b.vx).toBeGreaterThan(600);
    expect(b.vy).toBe(0);
    expect(b.via).toBe(1);
    // It carries on out of the far end instead of bouncing straight back.
    for (let i = 0; i < 20; i++) stepWorld(w, H, events);
    expect(events.filter((q) => q.type === 'warp')).toHaveLength(1);
    expect(b.x).toBeGreaterThan(700);
  });

  it('works both ways', () => {
    const b = ball(1, 850, 350, -700, 0);
    const { events } = run([b], tableWith(...portals(300, 150, 700, 350)), 0.3);
    const e = events.find((q) => q.type === 'warp');
    expect(e && e.type === 'warp' && e.src).toBe(2);
    expect(b.y).toBeCloseTo(150, 6);
    expect(b.x).toBeLessThan(300);
  });

  it('a ball sitting in the exit blocks it: the other ball rolls on over the entrance', () => {
    const b = ball(1, 150, 150, 700, 0);
    const sitter = ball(2, 700, 350);
    const { events } = run([b, sitter], tableWith(...portals(300, 150, 700, 350)), 0.5);
    expect(events.some((q) => q.type === 'warp')).toBe(false);
    expect(b.y).toBeCloseTo(150, 6);
    expect(b.x).toBeGreaterThan(400);
    expect(sitter.x).toBe(700);
  });

  it('a ball that starts in a portal has to leave it before it can warp', () => {
    const b = ball(1, 300, 150, 200, 0);
    const { events } = run([b], tableWith(...portals(300, 150, 700, 350)), 0.5);
    expect(events.some((q) => q.type === 'warp')).toBe(false);
  });

  it('never drops a ball into a rail', () => {
    // The exit hugs the bottom rail (y = 500): coming out 20 below its centre would put the ball in
    // the rail, so it does not warp; 5 below is fine.
    const t = tableWith(...portals(300, 150, 700, 470));
    const low = ball(1, 150, 170, 700, 0);
    const a = run([low], t, 0.4);
    expect(a.events.some((q) => q.type === 'warp')).toBe(false);
    expect(low.y).toBe(170);
    const high = ball(1, 150, 155, 700, 0);
    const w = createWorld([high], buildGeom(t));
    const events: PhysEvent[] = [];
    expect(stepUntil(w, 'warp', events)).toBeGreaterThan(0);
    expect(high.y).toBeCloseTo(475, 9);
    expect(high.y).toBeLessThanOrEqual(500 - R);
  });
});

describe('black holes', () => {
  const exits = [
    { x: 150, y: 100 },
    { x: 850, y: 400 },
  ];

  it('swallow a ball, hold it a moment, then spit it out at an exit', () => {
    const cue = ball(0, 200, 250, 700, 0);
    const w = createWorld([cue], buildGeom(tableWith(hole(exits))));
    const events: PhysEvent[] = [];
    const s1 = stepUntil(w, 'swallowed', events);
    expect(s1).toBeGreaterThan(0);
    expect(cue.active).toBe(false);
    expect(cue.via).toBe(1);
    const s2 = stepUntil(w, 'bloop', events);
    expect(s2).toBeGreaterThan(0);
    expect((s2 + 1) * H).toBeGreaterThanOrEqual(LIMBO_TIME - 1e-9);
    // The shot was still on the whole time.
    expect(w.stopped).toBe(false);
    expect(cue.active).toBe(true);
    const out = events.find((q) => q.type === 'bloop')!;
    if (out.type !== 'bloop') throw new Error('no bloop');
    expect(exits.some((e) => e.x === out.x && e.y === out.y)).toBe(true);
    // Heading away from the hole at the exit speed (give or take a substep of friction).
    expect(Math.hypot(cue.vx, cue.vy)).toBeGreaterThan(BLACKHOLE_EXIT_V - 10);
    expect((cue.x - 500) * cue.vx + (cue.y - 250) * cue.vy).toBeGreaterThan(0);
    runUntilStopped(w);
    // Not a scratch: the cue ball survived.
    expect(w.log.scratch).toBeNull();
    expect(w.log.pots).toHaveLength(0);
    expect(w.log.cueRest).not.toBeNull();
  });

  it('pick the exit with the world seed: the same seed, the same exit', () => {
    const exitFor = (seed: number) => {
      const b = ball(1, 200, 250, 700, 0);
      const w = createWorld([b], buildGeom(tableWith(hole(exits))), seed);
      const events: PhysEvent[] = [];
      stepUntil(w, 'bloop', events, 400);
      const e = events.find((q) => q.type === 'bloop');
      return e && e.type === 'bloop' ? `${e.x},${e.y}` : 'none';
    };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      expect(exitFor(seed)).toBe(exitFor(seed));
      seen.add(exitFor(seed));
    }
    expect(seen.has('none')).toBe(false);
    expect(seen.size).toBe(2);
  });

  it('skip exits inside the pull, and blocked ones', () => {
    const inside = { x: 560, y: 250 };
    const b = ball(1, 200, 250, 700, 0);
    const blocker = ball(2, 850, 400);
    const w = createWorld([b, blocker], buildGeom(tableWith(hole([inside, ...exits]))), 3);
    const events: PhysEvent[] = [];
    stepUntil(w, 'bloop', events);
    const e = events.find((q) => q.type === 'bloop');
    expect(e && e.type === 'bloop' && [e.x, e.y]).toEqual([150, 100]);
  });

  it('with no exit clear, spit the ball out anywhere clear, outside the pull', () => {
    const b = ball(1, 200, 250, 700, 0);
    const w = createWorld([b], buildGeom(tableWith(hole([]))), 5);
    const events: PhysEvent[] = [];
    expect(stepUntil(w, 'bloop', events)).toBeGreaterThan(0);
    expect(Math.hypot(b.x - 500, b.y - 250)).toBeGreaterThan(110 + R - 1e-9);
    expect(b.x).toBeGreaterThan(R);
    expect(b.x).toBeLessThan(1000 - R);
  });

  it('pull balls that pass close, but not ones going by at a distance', () => {
    const near = ball(1, 100, 190, 900, 0);
    run([near], tableWith(hole(exits)), 0.5);
    const far = ball(1, 100, 60, 900, 0);
    run([far], tableWith(hole(exits)), 0.5);
    expect(near.vy).toBeGreaterThan(20);
    expect(far.vy).toBe(0);
  });

  it('when the ref calls time, a lost ball comes back at rest', () => {
    const b: Ball = ball(1, 200, 250, 700, 0);
    const w = createWorld([b], buildGeom(tableWith(hole(exits))));
    stepUntil(w, 'swallowed', []);
    expect(w.floor.limbo).toBe(1);
    const back = flushLimbo(w.floor, w.geom, w.solid, w.balls, () => worldRand(w));
    expect(back).toEqual([b]);
    expect(b.active).toBe(true);
    expect([b.vx, b.vy]).toEqual([0, 0]);
    expect(w.floor.limbo).toBe(0);
  });
});

describe('fuzz: floor toys at full speed', () => {
  it('nothing escapes, nothing goes NaN, nothing stays lost, and every shot settles', () => {
    const rng = createRng(77);
    const scenes = Number(process.env['FUZZ'] ?? 10);
    const kinds = ['ice', 'mud', 'sand', 'conveyor', 'fan'] as const;
    for (let s = 0; s < scenes; s++) {
      const t = sealedTable();
      for (const v of t.verts) v.pocket = rng.next() < 0.5;
      const parts: Part[] = [];
      let id = 1;
      for (let k = 0; k < 5; k++) {
        const x = rng.range(200, 800);
        const y = rng.range(120, 380);
        const dir = { x: rng.range(-1, 1), y: rng.range(-1, 1) };
        switch (rng.int(5)) {
          case 0:
            parts.push({
              id: id++,
              kind: 'booster',
              x,
              y,
              dir,
              len: 120,
              wid: 70,
              kick: rng.range(400, 900),
            });
            break;
          case 1:
            parts.push({
              id: id++,
              kind: 'felt',
              felt: kinds[rng.int(5)]!,
              x,
              y,
              dir,
              w: rng.range(120, 300),
              h: rng.range(70, 160),
            });
            break;
          case 2:
            parts.push({
              id: id++,
              kind: 'magnet',
              x,
              y,
              polarity: rng.next() < 0.5 ? 1 : -1,
              r: rng.range(90, 160),
              strength: rng.range(600, 1500),
            });
            break;
          case 3:
            parts.push({
              id: id++,
              kind: 'blackhole',
              x,
              y,
              r: 100,
              exits: [{ x: rng.range(60, 940), y: rng.range(60, 440) }],
            });
            break;
          default:
            parts.push({ id: id, kind: 'portal', x, y, link: id + 1, r: 38 });
            parts.push({ id: id + 1, kind: 'portal', x: 1000 - x, y: 500 - y, link: id, r: 38 });
            id += 2;
        }
      }
      t.parts = parts;
      const geom = buildGeom(t);
      const balls: Ball[] = [];
      for (let i = 0; i < 7; i++) {
        let x = 0;
        let y = 0;
        for (let tries = 0; tries < 200; tries++) {
          x = rng.range(60, 940);
          y = rng.range(60, 440);
          if (
            balls.every((o) => Math.hypot(o.x - x, o.y - y) > 2 * R + 2) &&
            geom.fields.every((f) => Math.hypot(f.x - x, f.y - y) > 40)
          )
            break;
        }
        const variant = (['normal', 'bowling', 'normal', 'chicken'] as const)[rng.int(4)];
        balls.push(makeBall({ id: i, x, y, variant: i === 0 ? 'normal' : variant }));
      }
      const a = rng.range(0, Math.PI * 2);
      balls[0]!.vx = Math.cos(a) * V_MAX;
      balls[0]!.vy = Math.sin(a) * V_MAX;
      const w = createWorld(balls, geom, s);
      runUntilStopped(w, 4000);
      expect(w.stopped).toBe(true);
      expect(w.log.timedOut).toBe(false);
      expect(w.floor.limbo).toBe(0);
      for (const b of balls) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
        if (b.active) expect(pointInPolygon(b.x, b.y, geom.poly)).toBe(true);
        else expect(b.gone).not.toBeNull();
      }
    }
  });
});

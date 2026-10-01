import { describe, expect, it } from 'vitest';
import { A_ROLL, BOOST_KICKS, CONVEYOR_SPEED, H, R, SIM_TIMEOUT } from '../../src/config';
import type { FeltKind, Part } from '../../src/geom/parts';
import { buildGeom, type Table } from '../../src/geom/table';
import { createWorld, makeBall, stepWorld, type Ball, type PhysEvent } from '../../src/physics/world';
import { ball, run, runUntilStopped, sealedTable } from './helpers';

function tableWith(...parts: Part[]): Table {
  const t = sealedTable();
  t.parts = parts;
  return t;
}

const pad = (id: number, x: number, y: number, dx: number, dy: number, kick = 600): Part => ({
  id,
  kind: 'booster',
  x,
  y,
  dir: { x: dx, y: dy },
  len: 120,
  wid: 80,
  kick,
});

type FeltPart = Extract<Part, { kind: 'felt' }>;

const felt = (
  id: number,
  kind: FeltKind,
  x: number,
  y: number,
  w: number,
  h: number,
  power?: number,
): FeltPart => ({
  id,
  kind: 'felt',
  felt: kind,
  x,
  y,
  dir: { x: 1, y: 0 },
  w,
  h,
  ...(power === undefined ? {} : { power }),
});

/** How far a ball rolls from (x, y) at speed v along +x before it stops. */
function rollout(t: Table, v: number, x = 60): number {
  const b = ball(1, x, 250, v, 0);
  const w = createWorld([b], buildGeom(t));
  runUntilStopped(w);
  return b.x - x;
}

describe('speed pads', () => {
  it('kick a ball along the arrow once, as it rolls on', () => {
    const b = ball(1, 300, 250, 400, 0);
    const { events } = run([b], tableWith(pad(1, 500, 250, 1, 0)), 0.8);
    const boosts = events.filter((e) => e.type === 'boost');
    expect(boosts).toHaveLength(1);
    expect(b.via).toBe(1);
    // It would have crawled; with the kick it is well past the pad.
    expect(b.x).toBeGreaterThan(640);
  });

  it('push against a ball rolling the wrong way', () => {
    const b = ball(1, 620, 250, -300, 0);
    run([b], tableWith(pad(1, 500, 250, 1, 0)), 0.4);
    expect(b.vx).toBeGreaterThan(0);
  });

  it('leave a ball that starts on them alone until it rolls off and back on', () => {
    const b = ball(1, 500, 250, 150, 0);
    const { events } = run([b], tableWith(pad(1, 500, 250, 1, 0)), 0.6);
    expect(events.some((e) => e.type === 'boost')).toBe(false);
  });

  it(`give at most ${BOOST_KICKS} kicks a shot`, () => {
    // A pad firing at the right rail from close range: bounce, back over the pad, kick, bounce...
    const b = ball(1, 760, 250, 300, 0);
    const w = createWorld([b], buildGeom(tableWith(pad(1, 850, 250, -1, 0, 900))));
    const events = runUntilStopped(w);
    expect(events.filter((e) => e.type === 'boost').length).toBeLessThanOrEqual(BOOST_KICKS);
    expect(w.stopped).toBe(true);
  });
});

describe('special felt', () => {
  it('ice lets a ball glide further, mud and sand stop it sooner', () => {
    const plain = rollout(sealedTable(), 300);
    const ice = rollout(tableWith(felt(1, 'ice', 500, 250, 1000, 500)), 300);
    const mud = rollout(tableWith(felt(1, 'mud', 500, 250, 1000, 500)), 300);
    const sand = rollout(tableWith(felt(1, 'sand', 500, 250, 1000, 500)), 300);
    expect(ice).toBeGreaterThan(plain * 1.5);
    expect(mud).toBeLessThan(plain * 0.5);
    expect(sand).toBeLessThan(plain * 0.6);
  });

  it('sand eats fast balls, mud eats slow ones', () => {
    const t = (k: FeltKind) => tableWith(felt(1, k, 500, 250, 1000, 500));
    // Fast: sand's drag bites harder than mud's grip.
    expect(rollout(t('sand'), 900)).toBeLessThan(rollout(t('mud'), 900));
    // Slow: the other way round.
    expect(rollout(t('mud'), 150)).toBeLessThan(rollout(t('sand'), 150));
  });

  it('report a ball rolling onto a patch', () => {
    const b = ball(1, 200, 250, 500, 0);
    const { events } = run([b], tableWith(felt(1, 'mud', 500, 250, 200, 200)), 1);
    const e = events.find((q) => q.type === 'felt');
    expect(e && e.type === 'felt' && e.felt).toBe('mud');
  });

  it('a spinning cue ball skids further on ice', () => {
    const skid = (t: Table) => {
      const cue = ball(0, 100, 250, 800, 0);
      cue.sy = 400; // sideways slip, as side English leaves it
      cue.eng = 0.5;
      const w = createWorld([cue], buildGeom(t));
      let steps = 0;
      while (Math.hypot(cue.sx, cue.sy) > 1 && steps < 600) {
        stepWorld(w, H, []);
        steps++;
      }
      return steps;
    };
    expect(skid(tableWith(felt(1, 'ice', 500, 250, 1000, 500)))).toBeGreaterThan(skid(sealedTable()) * 2);
  });
});

describe('conveyors and fans', () => {
  it('a conveyor carries a resting ball along at belt speed', () => {
    // A belt running down the middle, 440 long.
    const belt: Part = { ...felt(1, 'conveyor', 500, 250, 440, 90), dir: { x: 0, y: 1 } };
    const b = ball(1, 500, 100);
    run([b], tableWith(belt), 0.8);
    expect(b.vy).toBeCloseTo(CONVEYOR_SPEED, 0);
    expect(Math.abs(b.vx)).toBeLessThan(1e-9);
    expect(Math.abs(b.x - 500)).toBeLessThan(1e-9);
  });

  it('a belt that pins a ball against a rail cannot keep the shot going', () => {
    // The belt runs right into the bottom rail.
    const belt: Part = { ...felt(1, 'conveyor', 500, 300, 400, 90), dir: { x: 0, y: 1 } };
    const b = ball(1, 500, 200);
    const w = createWorld([b], buildGeom(tableWith(belt)));
    runUntilStopped(w);
    expect(w.stopped).toBe(true);
    expect(w.log.timedOut).toBe(false);
    expect(w.t).toBeLessThan(6);
    expect(b.y).toBeGreaterThan(470);
  });

  it('a belt that bounces a ball off a rail cannot keep the shot going either', () => {
    // The belt stops 30 short of the bottom rail: off the end, off the rail, back on, again...
    const belt: Part = { ...felt(1, 'conveyor', 500, 250, 440, 90), dir: { x: 0, y: 1 } };
    const b = ball(1, 500, 100);
    const w = createWorld([b], buildGeom(tableWith(belt)));
    runUntilStopped(w);
    expect(w.stopped).toBe(true);
    expect(w.log.timedOut).toBe(false);
    expect(w.t).toBeLessThan(8);
  });

  it('a fan blows a resting ball along, and a bowling ball less', () => {
    const t = tableWith(felt(1, 'fan', 500, 250, 600, 200, 600));
    const light = ball(1, 300, 250);
    run([light], t, 0.5);
    const heavy = makeBall({ id: 1, x: 300, y: 250, variant: 'bowling' });
    run([heavy], t, 0.5);
    expect(light.x - 300).toBeGreaterThan(20);
    // 600 / 3 = 200 < A_ROLL: not enough to shift it from rest.
    expect(600 / 3).toBeLessThan(A_ROLL);
    expect(heavy.x).toBe(300);
  });
});

describe('magnets', () => {
  const magnet = (polarity: 1 | -1, strength = 1200): Part => ({
    id: 1,
    kind: 'magnet',
    x: 500,
    y: 250,
    polarity,
    r: 160,
    strength,
  });

  it('pull a ball in and hold it on the magnet', () => {
    const b = ball(1, 380, 250, 0, 120);
    const w = createWorld([b], buildGeom(tableWith(magnet(1))));
    runUntilStopped(w);
    expect(w.stopped).toBe(true);
    expect(w.log.timedOut).toBe(false);
    expect(Math.hypot(b.x - 500, b.y - 250)).toBeLessThan(R);
  });

  it('bend a cue ball rolling past', () => {
    const cue = ball(0, 100, 150, 900, 0);
    run([cue], tableWith(magnet(1)), 0.5);
    expect(cue.vy).toBeGreaterThan(30);
  });

  it('repulsors push balls out of their reach', () => {
    const b = ball(1, 460, 250);
    const w = createWorld([b], buildGeom(tableWith(magnet(-1))));
    runUntilStopped(w);
    expect(500 - b.x).toBeGreaterThan(90);
  });

  it('leave balls outside their reach alone', () => {
    const b = ball(1, 200, 250);
    const w = createWorld([b], buildGeom(tableWith(magnet(1))));
    stepWorld(w, H, []);
    expect(b.vx).toBe(0);
    expect(w.stopped).toBe(false);
    runUntilStopped(w);
    expect(b.x).toBe(200);
  });
});

describe('floor toys and determinism', () => {
  it('a busy floor replays to the last bit', () => {
    const t = tableWith(
      pad(1, 300, 150, 1, 1),
      felt(2, 'ice', 700, 380, 240, 160),
      felt(3, 'mud', 820, 120, 160, 120),
      { ...felt(4, 'conveyor', 520, 300, 300, 80), dir: { x: -1, y: 0 } },
      { id: 5, kind: 'magnet', x: 600, y: 180, polarity: 1, r: 140, strength: 1100 },
      { id: 6, kind: 'magnet', x: 250, y: 380, polarity: -1, r: 120, strength: 900 },
    );
    const shot = (): { balls: Ball[]; events: PhysEvent[] } => {
      const balls = [ball(0, 120, 250, 1500, 280), ball(1, 450, 220), ball(2, 640, 300), ball(3, 760, 200)];
      const w = createWorld(balls, buildGeom(t), 7);
      const events = runUntilStopped(w, Math.round(SIM_TIMEOUT / H) + 10);
      return { balls, events };
    };
    const a = shot();
    const b = shot();
    expect(a.balls.map((q) => [q.x, q.y, q.active])).toEqual(b.balls.map((q) => [q.x, q.y, q.active]));
    expect(a.events.length).toBe(b.events.length);
  });
});

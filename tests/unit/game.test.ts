import { describe, expect, it } from 'vitest';
import { BUDGET, CHARGE_TIME, PAR } from '../../src/config';
import { createRng } from '../../src/core/rng';
import { pointInPolygon } from '../../src/geom/polygon';
import { Game, type Phase } from '../../src/game/game';
import { findRespawnSpot, rackBalls, rankFor } from '../../src/game/rules';
import { Spin } from '../../src/game/spin';
import { buildGeom, createTable } from '../../src/geom/table';

const DT = 1 / 60;

function runUntil(g: Game, pred: () => boolean, maxSeconds = 60) {
  let t = 0;
  while (!pred() && t < maxSeconds) {
    g.update(DT);
    t += DT;
  }
  expect(pred()).toBe(true);
}

describe('rules', () => {
  it('racks eleven non-overlapping balls inside the table', () => {
    const balls = rackBalls(createRng(1));
    const geom = buildGeom(createTable());
    expect(balls).toHaveLength(11);
    expect(balls[0]!.kind).toBe('cue');
    expect(new Set(balls.map((b) => b.num)).size).toBe(11);
    for (const b of balls) {
      expect(pointInPolygon(b.x, b.y, geom.poly)).toBe(true);
      for (const o of balls) if (o !== b) expect(Math.hypot(o.x - b.x, o.y - b.y)).toBeGreaterThanOrEqual(48);
    }
  });

  it('respawn spots are inside and clear of balls', () => {
    const rng = createRng(9);
    const balls = rackBalls(rng);
    const geom = buildGeom(createTable());
    for (let i = 0; i < 20; i++) {
      const s = findRespawnSpot(rng, geom, balls, 0);
      expect(pointInPolygon(s.x, s.y, geom.poly)).toBe(true);
      for (const b of balls.slice(1)) expect(Math.hypot(b.x - s.x, b.y - s.y)).toBeGreaterThan(48);
    }
  });

  it('ranks get grander as the score drops', () => {
    expect(rankFor(PAR - 7).title).toBe('UNBENDLIEVABLE');
    expect(rankFor(PAR).title).toBe('FELT WHISPERER');
    expect(rankFor(PAR + 30).title).toBe('MENACE TO BILLIARDS');
  });
});

describe('spin', () => {
  it('lands exactly on the target after several turns, with pegs ticking', () => {
    const s = new Spin();
    s.start(0.3, 2.0, 3, 2.4);
    let ticks = 0;
    while (!s.done) ticks += s.update(DT);
    expect(((s.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toBeCloseTo(2.0, 6);
    expect(ticks).toBeGreaterThan(40);
  });

  it('fast-forward skips to the landing wobble', () => {
    const s = new Spin();
    s.start(0, 1, 4, 2.4);
    s.update(0.1);
    s.fastForward();
    let t = 0;
    while (!s.done) {
      s.update(DT);
      t += DT;
    }
    expect(t).toBeLessThan(0.55);
  });
});

describe('game flow', () => {
  it('title -> spin -> plan with a fresh budget; the spin lands on a forced angle', () => {
    const g = new Game({ seed: 42 });
    expect(g.phase).toBe('title');
    g.forcedAngle = 1.25;
    g.start();
    expect(g.phase).toBe('spin');
    runUntil(g, () => g.phase === 'plan');
    expect(g.aim).toBeCloseTo(1.25, 6);
    expect(g.budget).toBe(BUDGET);
  });

  it('SHOOT winds the stick up to the dial, then strikes, sims, resolves and counts the shot', () => {
    const g = new Game({ seed: 5 });
    g.forcedAngle = 0; // straight at the rack
    g.start();
    runUntil(g, () => g.phase === 'plan');
    g.setDial(1);
    const phases: Phase[] = [];
    g.events.on('phase', (e) => phases.push(e.to));
    expect(g.shoot()).toBe(true);
    expect(g.shoot()).toBe(false); // already winding up
    expect(g.phase).toBe('plan');
    expect(g.charging).toBe(true);
    for (let i = 0; i < Math.ceil(CHARGE_TIME / DT) - 2; i++) g.update(DT);
    expect(g.phase).toBe('plan');
    expect(g.power).toBeGreaterThan(0.8);
    for (let i = 0; i < 4; i++) g.update(DT);
    expect(g.phase).toBe('strike');
    expect(g.strikePower).toBe(1);
    expect(g.shots).toBe(1);
    runUntil(g, () => g.phase === 'spin' || g.phase === 'over');
    expect(phases.slice(0, 3)).toEqual(['strike', 'sim', 'resolve']);
    const moved = g.balls.slice(1).some((b) => !b.active || b.x !== rackBalls(createRng(5))[b.id]?.x);
    expect(moved).toBe(true);
  });

  it('undo restores the table, the balls and the budget', () => {
    const g = new Game({ seed: 8 });
    g.start();
    runUntil(g, () => g.phase === 'plan');
    const before = JSON.stringify({ t: g.table.verts, b: g.balls.map((b) => [b.x, b.y]) });
    const h = g.hitHandle(1000, 500, 30)!;
    expect(g.beginDrag(h, 1000, 500)).toBe(true);
    g.dragTo(1080, 580);
    g.endDrag();
    expect(g.budget).toBeLessThan(BUDGET);
    expect(g.canUndo).toBe(true);
    expect(g.undo()).toBe(true);
    expect(g.budget).toBe(BUDGET);
    expect(JSON.stringify({ t: g.table.verts, b: g.balls.map((b) => [b.x, b.y]) })).toBe(before);
  });

  it('reshaping is locked while winding up and outside the plan phase', () => {
    const g = new Game({ seed: 8 });
    expect(g.hitHandle(1000, 500, 30)).toBeNull(); // title
    g.start();
    runUntil(g, () => g.phase === 'plan');
    g.shoot();
    expect(g.hitHandle(1000, 500, 30)).toBeNull();
  });

  it('Escape cancels a windup; nothing is shot', () => {
    const g = new Game({ seed: 8 });
    g.start();
    runUntil(g, () => g.phase === 'plan');
    g.shoot(0.9);
    g.update(DT);
    g.cancelShot();
    expect(g.charging).toBe(false);
    expect(g.phase).toBe('plan');
    for (let i = 0; i < 120; i++) g.update(DT);
    expect(g.phase).toBe('plan');
    expect(g.shots).toBe(0);
  });

  it('the dial is exact in thousandths, and the shot records it', () => {
    const g = new Game({ seed: 3 });
    g.start();
    runUntil(g, () => g.phase === 'plan');
    g.setDial(0.85671);
    expect(g.dial).toBe(0.857);
    g.nudgeDial(0.02);
    expect(g.dial).toBe(0.877);
    g.setDial(5);
    expect(g.dial).toBe(1);
    g.setDial(0.42);
    g.shoot();
    runUntil(g, () => g.phase === 'sim');
    expect(g.shot?.p).toBe(420);
  });

  it('plays a whole seeded game to the end with random bends and random power', () => {
    const g = new Game({ seed: 1234 });
    const rng = createRng(99);
    let overs = 0;
    g.events.on('gameOver', () => overs++);
    g.start();
    const phase = (): Phase => g.phase;
    let turns = 0;
    while (phase() !== 'over' && turns < 400) {
      runUntil(g, () => phase() === 'plan' || phase() === 'over', 120);
      if (phase() === 'over') break;
      turns++;
      // A random bend or two, like a curious human would.
      for (let k = 0; k < 2; k++) {
        const hs = g.table.verts;
        const v = hs[rng.int(hs.length)]!;
        const h = g.hitHandle(v.x, v.y, 5);
        if (h && g.beginDrag(h, v.x, v.y)) {
          g.dragTo(v.x + rng.range(-120, 120), v.y + rng.range(-120, 120));
          g.endDrag();
        }
      }
      g.shoot(rng.range(0.3, 1));
      runUntil(g, () => phase() !== 'plan'); // the windup
    }
    expect(g.phase).toBe('over');
    expect(overs).toBe(1);
    expect(g.objectsLeft).toBe(0);
    expect(g.score).toBe(g.shots + g.penalties);
    expect(g.lastOver?.score).toBe(g.score);
  });
});

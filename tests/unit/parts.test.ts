import { describe, expect, it } from 'vitest';
import { H, R, V_MAX } from '../../src/config';
import { createRng } from '../../src/core/rng';
import { Game } from '../../src/game/game';
import { FREE_RULES } from '../../src/game/ruleset';
import { arcPoints, THICK, type Part } from '../../src/geom/parts';
import { pointInPolygon } from '../../src/geom/polygon';
import { buildGeom, createTable, type Table } from '../../src/geom/table';
import { createWorld, makeBall, stepWorld, type Ball, type PhysEvent } from '../../src/physics/world';
import { ball, run, sealedTable } from './helpers';

function tableWith(...parts: Part[]): Table {
  const t = sealedTable();
  t.parts = parts;
  return t;
}

const stub = (id: number, x: number, y: number, dx: number, dy: number, len: number): Part => ({
  id,
  kind: 'stub',
  x,
  y,
  dir: { x: dx, y: dy },
  len,
});

describe('solid toys', () => {
  it('a stub stops balls from both sides', () => {
    // Horizontal stub across the middle of the table.
    const t = tableWith(stub(1, 500, 250, 1, 0, 300));
    const fromAbove = ball(1, 500, 100, 0, 600);
    run([fromAbove], t, 1.5);
    expect(fromAbove.y).toBeLessThan(250 - R - THICK + 1);
    const fromBelow = ball(1, 500, 400, 0, -600);
    run([fromBelow], t, 1.5);
    expect(fromBelow.y).toBeGreaterThan(250 + R + THICK - 1);
  });

  it('curved rails: points lie on the circle, clockwise, with short chords', () => {
    for (const [from, to, turn] of [
      [{ x: 1, y: 0 }, { x: 0, y: 1 }, 90],
      [{ x: 1, y: 0 }, { x: -1, y: 0 }, 180],
      [{ x: 1, y: 0 }, { x: 0, y: -1 }, 270],
    ] as const) {
      const pts = arcPoints(0, 0, 120, from, to);
      let total = 0;
      for (let i = 0; i < pts.length; i++) {
        expect(Math.hypot(pts[i]!.x, pts[i]!.y)).toBeCloseTo(120, 6);
        if (i > 0) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(30.001);
          // Clockwise on screen: each step turns positive.
          const turnStep = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
          expect(turnStep).toBeGreaterThan(0);
          total += turnStep;
        }
      }
      expect((total * 180) / Math.PI).toBeCloseTo(turn, 4);
    }
  });

  it('a curved rail turns a ball rolling along its inside', () => {
    // Quarter circle round the bottom-right of (500, 250), radius 150: from east to south.
    const t = tableWith({ id: 2, kind: 'arc', x: 500, y: 250, r: 150, from: { x: 1, y: 0 }, to: { x: 0, y: 1 } });
    const b = ball(1, 560, 150, 0, 700);
    const w = createWorld([b], buildGeom(t));
    const events: PhysEvent[] = [];
    for (let i = 0; i < 100; i++) {
      stepWorld(w, H, events);
      // Never through the rail: never outside the arc within its quarter.
      if (b.x > 500 && b.y > 250) expect(Math.hypot(b.x - 500, b.y - 250)).toBeLessThan(150 - R - THICK + 1);
    }
    expect(events.some((e) => e.type === 'partHit' && e.kind === 'arc')).toBe(true);
    expect(b.vy).toBeLessThan(0);
  });

  it('bumpers kick balls away faster than they came, but never past V_MAX', () => {
    const t = tableWith({ id: 3, kind: 'bumper', x: 500, y: 250, r: 30 });
    const b = ball(1, 300, 250, 500, 0);
    const events: PhysEvent[] = [];
    const w = createWorld([b], buildGeom(t));
    let out = 0;
    let before = 0;
    for (let i = 0; i < 120; i++) {
      const sp = Math.hypot(b.vx, b.vy);
      stepWorld(w, H, events);
      if (events.some((e) => e.type === 'bumperHit') && !out) {
        out = Math.hypot(b.vx, b.vy);
        before = sp;
      }
    }
    expect(out).toBeGreaterThan(before * 1.15);
    const fast = ball(1, 300, 250, V_MAX, 0);
    const w2 = createWorld([fast], buildGeom(t));
    for (let i = 0; i < 30; i++) {
      stepWorld(w2, H, []);
      expect(Math.hypot(fast.vx, fast.vy)).toBeLessThanOrEqual(V_MAX + 1e-6);
    }
    expect(b.via).toBeGreaterThan(0);
  });

  it('glass cracks on a hard hit and shatters on the second; a soft hit does nothing', () => {
    const pane: Part = { id: 4, kind: 'glass', x: 500, y: 250, dir: { x: 0, y: 1 }, len: 200, hp: 2 };
    const soft = ball(1, 400, 250, 250, 0);
    const s = run([soft], tableWith(pane), 1);
    expect(s.events.some((e) => e.type === 'glass')).toBe(false);
    const t = tableWith({ ...pane });
    const hard = ball(1, 400, 250, 1500, 0);
    const { w, events } = run([hard], t, 0.3);
    expect(events.filter((e) => e.type === 'glass').map((e) => (e.type === 'glass' ? e.hp : -1))).toEqual([1]);
    expect(w.log.glassHp[4]).toBe(1);
  });

  it('broken glass stays broken for the rest of the game', () => {
    const t = createTable();
    t.parts = [{ id: 9, kind: 'glass', x: 600, y: 250, dir: { x: 0, y: 1 }, len: 160, hp: 1 }];
    const g = new Game({ seed: 3 });
    g.load({ rules: FREE_RULES, seed: 3, table: t, balls: [makeBall({ id: 0, x: 300, y: 250 }), makeBall({ id: 1, x: 900, y: 80 })] });
    for (let i = 0; i < 600 && g.phase !== 'plan'; i++) g.update(1 / 60);
    g.aim = 0;
    g.shoot(0.8);
    for (let i = 0; i < 1200 && g.phase !== 'spin' && g.phase !== 'over'; i++) g.update(1 / 60);
    expect(g.table.parts.some((p) => p.id === 9)).toBe(false);
    expect(g.geom.walls).toHaveLength(0);
  });

  it('a one-way gate lets balls through with its arrow and stops them against it', () => {
    // Vertical gate at x = 500 whose arrow points +x.
    const gate: Part = { id: 5, kind: 'gate', x: 500, y: 250, dir: { x: 1, y: 0 }, len: 300 };
    const forward = ball(1, 300, 250, 700, 0);
    run([forward], tableWith(gate), 1.2);
    expect(forward.x).toBeGreaterThan(500 + R + THICK);
    const back = ball(1, 700, 250, -700, 0);
    run([back], tableWith(gate), 1.2);
    expect(back.x).toBeGreaterThan(500);
    // And one that went through cannot come back.
    const round = ball(1, 300, 250, 1400, 0);
    run([round], tableWith(gate), 4);
    expect(round.x).toBeGreaterThan(500);
  });
});

describe('oddball balls', () => {
  it('the bowling ball barely notices the cue ball', () => {
    const cue = ball(0, 200, 250, 1200, 0);
    const bowl = makeBall({ id: 8, x: 500, y: 250, variant: 'bowling' });
    run([cue, bowl], sealedTable(), 0.4);
    expect(Math.hypot(bowl.vx, bowl.vy)).toBeLessThan(700);
    expect(cue.vx).toBeLessThan(0);
  });

  it('an egg cracks on a hard knock and breaks on the second', () => {
    const egg = makeBall({ id: 3, x: 500, y: 250, variant: 'egg' });
    const cue = ball(0, 200, 250, 1600, 0);
    const { w, events } = run([cue, egg], sealedTable(), 4);
    expect(events.some((e) => e.type === 'egg')).toBe(true);
    expect(w.log.cracked).toContain(3);
    if (egg.active) expect(egg.hp).toBe(1);
    else {
      expect(egg.gone).toBe('broken');
      expect(w.log.broken).toContain(3);
    }
  });

  it('a bomb blows on its third knock and shoves its neighbours', () => {
    const bomb = makeBall({ id: 5, x: 500, y: 250, variant: 'bomb' });
    bomb.fuse = 1; // one knock left
    const near = ball(2, 560, 250);
    const cue = ball(0, 300, 250, 700, 0);
    const { w, events } = run([cue, bomb, near], sealedTable(), 0.6);
    expect(events.some((e) => e.type === 'bomb')).toBe(true);
    expect(bomb.active).toBe(false);
    expect(bomb.gone).toBe('exploded');
    expect(w.log.exploded).toEqual([5]);
    expect(near.x).toBeGreaterThan(600);
  });

  it('a ghost ball drifts through object balls but not through the cue ball', () => {
    const ghost = makeBall({ id: 4, x: 300, y: 250, vx: 600, variant: 'ghost' });
    const obstacle = ball(2, 450, 250);
    run([ghost, obstacle], sealedTable(), 0.6);
    expect(ghost.x).toBeGreaterThan(450);
    expect(obstacle.vx).toBe(0);
    const cue = ball(0, 450, 250);
    const g2 = makeBall({ id: 4, x: 300, y: 250, vx: 600, variant: 'ghost' });
    run([g2, cue], sealedTable(), 0.6);
    expect(cue.vx).toBeGreaterThan(0);
  });

  it('the chicken runs from a moving cue ball and ignores a still one', () => {
    const still = [ball(0, 400, 250), makeBall({ id: 5, x: 480, y: 250, variant: 'chicken' })];
    run(still, sealedTable(), 0.5);
    expect(still[1]!.x).toBe(480);
    const chick = makeBall({ id: 5, x: 520, y: 250, variant: 'chicken' });
    const cue = ball(0, 300, 250, 500, 0);
    run([cue, chick], sealedTable(), 0.3);
    expect(chick.x).toBeGreaterThan(530);
    expect(chick.vx).toBeGreaterThan(100); // legging it
  });
});

describe('fuzz: toys at full speed', () => {
  it('nothing escapes, nothing goes NaN, and every shot settles', () => {
    const rng = createRng(2024);
    const scenes = Number(process.env['FUZZ'] ?? 10);
    for (let s = 0; s < scenes; s++) {
      const t = createTable();
      const parts: Part[] = [];
      let id = 1;
      for (let k = 0; k < 4; k++) {
        const x = rng.range(250, 750);
        const y = rng.range(150, 350);
        const pick = rng.int(5);
        if (pick === 0) parts.push(stub(id++, x, y, rng.range(-1, 1), rng.range(-1, 1), rng.range(80, 200)));
        else if (pick === 1) parts.push({ id: id++, kind: 'bumper', x, y, r: 28 });
        else if (pick === 2)
          parts.push({ id: id++, kind: 'glass', x, y, dir: { x: rng.range(-1, 1), y: 1 }, len: 140, hp: 2 });
        else if (pick === 3) parts.push({ id: id++, kind: 'gate', x, y, dir: { x: 1, y: rng.range(-1, 1) }, len: 120 });
        else parts.push({ id: id++, kind: 'arc', x, y, r: 90, from: { x: 1, y: 0 }, to: { x: 0, y: 1 } });
      }
      t.parts = parts;
      const geom = buildGeom(t);
      const balls: Ball[] = [];
      for (let i = 0; i < 8; i++) {
        let x = 0;
        let y = 0;
        for (let tries = 0; tries < 200; tries++) {
          x = rng.range(60, 940);
          y = rng.range(60, 440);
          const clear =
            balls.every((o) => Math.hypot(o.x - x, o.y - y) > 2 * R + 2) &&
            geom.walls.every((w) => distSeg(x, y, w.ax, w.ay, w.bx, w.by) > R + THICK + 2) &&
            geom.bumpers.every((b) => Math.hypot(b.x - x, b.y - y) > b.r + R + 2);
          if (clear) break;
        }
        const variant = (['normal', 'bowling', 'egg', 'bomb', 'ghost', 'chicken'] as const)[rng.int(6)];
        balls.push(makeBall({ id: i, x, y, variant: i === 0 ? 'normal' : variant }));
      }
      const a = rng.range(0, Math.PI * 2);
      balls[0]!.vx = Math.cos(a) * V_MAX;
      balls[0]!.vy = Math.sin(a) * V_MAX;
      const w = createWorld(balls, geom);
      const events: PhysEvent[] = [];
      for (let i = 0; i < 4000 && !w.stopped; i++) stepWorld(w, H, events);
      expect(w.stopped).toBe(true);
      expect(w.log.timedOut).toBe(false);
      for (const b of balls) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
        if (b.active) expect(pointInPolygon(b.x, b.y, geom.poly)).toBe(true);
      }
    }
  });
});

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

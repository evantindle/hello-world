import { describe, expect, it } from 'vitest';
import { A_ROLL, CUE_BRAKE, H, R } from '../../src/config';
import { buildGeom, type Table } from '../../src/geom/table';
import { launchFrom, type ShotQ } from '../../src/physics/launch';
import { cushionSpin, spinFriction } from '../../src/physics/spin';
import { collideRail, createWorld, stepWorld, type Ball, type PhysEvent } from '../../src/physics/world';
import { ball, sealedTable } from './helpers';

/** A much bigger sealed box, so curves can play out without hitting anything. */
function bigBox(): Table {
  return {
    verts: [
      { id: 0, x: -3000, y: -3000, pocket: false },
      { id: 1, x: 4000, y: -3000, pocket: false },
      { id: 2, x: 4000, y: 3500, pocket: false },
      { id: 3, x: -3000, y: 3500, pocket: false },
    ],
    nextId: 4,
  };
}

function shoot(balls: Ball[], table: Table, q: ShotQ, seconds = 8) {
  const cue = balls[0]!;
  launchFrom(cue, q);
  const w = createWorld(balls, buildGeom(table));
  const events: PhysEvent[] = [];
  const steps = Math.round(seconds / H);
  const track: { x: number; y: number; vx: number; vy: number; slip: number }[] = [];
  for (let i = 0; i < steps && !w.stopped; i++) {
    stepWorld(w, H, events);
    track.push({ x: cue.x, y: cue.y, vx: cue.vx, vy: cue.vy, slip: Math.hypot(cue.sx, cue.sy) });
  }
  return { w, events, track };
}

/** Heading (degrees) the moment the skid is over and the ball rolls. */
function rollHeading(track: { vx: number; vy: number; slip: number }[]): number {
  const s = track.find((t) => t.slip === 0)!;
  return (Math.atan2(s.vy, s.vx) * 180) / Math.PI;
}

const east = (p: number, ex = 0, ey = 0): ShotQ => ({ dx: 32767, dy: 0, p, ex, ey });

describe('English', () => {
  it('a shot with no English carries no spin at all', () => {
    const cue = ball(0, 100, 100);
    launchFrom(cue, east(600));
    expect([cue.sx, cue.sy, cue.bank, cue.wz, cue.eng]).toEqual([0, 0, 0, 0, 0]);
  });

  it('without English a full hit stuns the cue ball (as in the original game)', () => {
    const balls = [ball(0, 200, 250), ball(1, 500, 250)];
    shoot(balls, bigBox(), east(600));
    // Contact happens with the cue centre at x = 452; the stunned, braked cue barely moves on.
    expect(Math.abs(balls[0]!.x - 452)).toBeLessThan(40);
  });

  it('draw pulls the cue ball back after a full hit', () => {
    const balls = [ball(0, 200, 250), ball(1, 500, 250)];
    shoot(balls, bigBox(), east(600, 0, 100));
    expect(balls[0]!.x).toBeLessThan(452 - 100);
    expect(balls[1]!.x).toBeGreaterThan(600); // the object ball still takes the hit
  });

  it('follow drives the cue ball on through the object ball', () => {
    const balls = [ball(0, 200, 250), ball(1, 500, 250)];
    shoot(balls, bigBox(), east(600, 0, -100));
    expect(balls[0]!.x).toBeGreaterThan(452 + 150);
  });

  it('side English curves the path, by at most 25 degrees, toward the side struck', () => {
    for (const p of [200, 500, 800, 1000]) {
      for (const ex of [100, -100]) {
        const balls = [ball(0, 0, 0)];
        const { track } = shoot(balls, bigBox(), east(p, ex), 4);
        const deg = rollHeading(track);
        expect(Math.abs(deg)).toBeLessThanOrEqual(25.2);
        expect(Math.abs(deg)).toBeGreaterThan(20);
        // + side (right of the aim line) bends toward +y on a y-down screen.
        expect(Math.sign(deg)).toBe(Math.sign(ex));
      }
    }
  });

  it('half the side English bends it about half as much', () => {
    const balls = [ball(0, 0, 0)];
    const { track } = shoot(balls, bigBox(), east(800, 50), 4);
    const deg = rollHeading(track);
    expect(deg).toBeGreaterThan(10);
    expect(deg).toBeLessThan(15);
  });

  it('sidespin throws the ball along the cushion: right English kicks right', () => {
    for (const [wz, sign] of [
      [-1000, 1],
      [1000, -1],
    ] as const) {
      // Heading north (up the screen) straight into the top rail, shooter facing north.
      const b = ball(0, 500, R - 2, 0, -1000);
      b.wz = wz;
      const t = buildGeom(sealedTable());
      const top = t.rails.find((r) => r.ny > 0.99)!;
      collideRail(b, top, []);
      expect(b.vy).toBeGreaterThan(0);
      expect(Math.sign(b.vx)).toBe(sign);
      expect(Math.abs(b.vx)).toBeGreaterThan(100);
      expect(Math.abs(b.wz)).toBeLessThan(1000); // some spin used up
    }
  });

  it('cushion throw is capped by the cushion friction', () => {
    const b = ball(0, 0, 0, 0, 0);
    b.wz = -100000;
    cushionSpin(b, 0, 1, -200, 0.9);
    expect(b.vx).toBeCloseTo(0.25 * 1.9 * 200);
  });

  it('English softens the dizzy brake', () => {
    const plain = ball(0, 0, 0, 500, 0);
    plain.braking = true;
    const spun = ball(0, 0, 0, 500, 0);
    spun.braking = true;
    spun.eng = 1;
    spinFriction(plain, 0.1, 1);
    spinFriction(spun, 0.1, 1);
    expect(500 - plain.vx).toBeGreaterThan((500 - spun.vx) * (CUE_BRAKE - 0.5));
    expect(500 - spun.vx).toBeCloseTo(A_ROLL * 0.1 + (500 - A_ROLL * 0.1) * 0.02, 3);
  });

  it('banked draw wears off over a long approach', () => {
    const near = [ball(0, 200, 250), ball(1, 420, 250)];
    shoot(near, bigBox(), east(600, 0, 100));
    const far = [ball(0, 60, 250), ball(1, 900, 250)];
    shoot(far, bigBox(), east(600, 0, 100));
    const backNear = 372 - near[0]!.x;
    const backFar = 852 - far[0]!.x;
    expect(backNear).toBeGreaterThan(backFar);
  });
});

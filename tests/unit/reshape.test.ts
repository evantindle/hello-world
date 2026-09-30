import { describe, expect, it } from 'vitest';
import { BUDGET, R } from '../../src/config';
import { createRng } from '../../src/core/rng';
import { distToSegment, pointInPolygon } from '../../src/geom/polygon';
import { buildGeom, createTable, validateTable, type Table } from '../../src/geom/table';
import {
  DragSession,
  hitHandle,
  listHandles,
  moveVertex,
  removeBend,
  type ReshapeHost,
} from '../../src/game/reshape';
import type { Ball } from '../../src/physics/world';

function ball(id: number, x: number, y: number): Ball {
  return {
    id,
    kind: id === 0 ? 'cue' : 'object',
    num: id,
    color: '#fff',
    stripe: false,
    x,
    y,
    vx: 0,
    vy: 0,
    active: true,
  };
}

function host(balls: Ball[], table: Table = createTable(), budget = BUDGET): ReshapeHost {
  return { table, geom: buildGeom(table), balls, budget, hunger: 0 };
}

function assertSane(h: ReshapeHost) {
  expect(validateTable(h.table, h.geom).ok).toBe(true);
  for (const b of h.balls) {
    if (!b.active) continue;
    expect(pointInPolygon(b.x, b.y, h.geom.poly)).toBe(true);
    for (const r of h.geom.rails)
      expect(distToSegment(b.x, b.y, r.ax, r.ay, r.bx, r.by)).toBeGreaterThan(R - 0.51);
    for (const o of h.balls) {
      if (o === b || !o.active) continue;
      expect(Math.hypot(o.x - b.x, o.y - b.y)).toBeGreaterThan(2 * R - 0.51);
    }
    for (const p of h.geom.pockets) {
      if (p.open) expect(Math.hypot(p.x - b.x, p.y - b.y)).toBeGreaterThanOrEqual(p.sr - 0.02);
    }
  }
}

describe('handles', () => {
  it('lists six vertex knobs and six midpoint handles on the fresh table', () => {
    const t = createTable();
    const hs = listHandles(t);
    expect(hs.filter((h) => h.kind === 'vertex')).toHaveLength(6);
    expect(hs.filter((h) => h.kind === 'edge')).toHaveLength(6);
    expect(hitHandle(t, 1003, 4, 30)).toMatchObject({ kind: 'vertex', index: 2 });
    expect(hitHandle(t, 250, 3, 30)).toMatchObject({ kind: 'edge', index: 0 });
    expect(hitHandle(t, 400, 250, 30)).toBeNull();
  });
});

describe('moveVertex', () => {
  it('moves a corner, charges path length, and never refunds', () => {
    const h = host([ball(0, 250, 250)]);
    const r1 = moveVertex(h, 2, 1080, -60);
    expect(r1.blocked).toBeNull();
    expect(r1.applied).toBeCloseTo(Math.hypot(80, 60));
    expect(h.budget).toBeCloseTo(BUDGET - 100);
    const r2 = moveVertex(h, 2, 1000, 0);
    expect(r2.applied).toBeCloseTo(100);
    expect(h.budget).toBeCloseTo(BUDGET - 200);
    assertSane(h);
  });

  it('clips a move to the remaining budget', () => {
    const h = host([ball(0, 250, 250)], createTable(), 50);
    const r = moveVertex(h, 3, 1100, 600);
    expect(r.applied).toBeCloseTo(50);
    expect(r.blocked).toBe('budget');
    expect(h.budget).toBe(0);
    expect(moveVertex(h, 3, 900, 400)).toMatchObject({ applied: 0, blocked: 'budget' });
  });

  it('stops at the last valid position instead of making a self-crossing table', () => {
    const h = host([ball(0, 250, 250)], createTable(), 5000);
    const r = moveVertex(h, 3, -80, -80); // drag the bottom-right corner across the table
    expect(r.blocked).not.toBeNull();
    expect(r.applied).toBeGreaterThan(0);
    assertSane(h);
  });

  it('shoves balls out of the way of a moving wall, and they shove each other', () => {
    const balls = [ball(0, 150, 250), ball(1, 150 + 2 * R + 1, 250), ball(2, 150, 250 + 2 * R + 1)];
    const h = host(balls);
    // Push the whole left side of the table inward by sliding both left corners right.
    moveVertex(h, 0, 140, 0);
    const r = moveVertex(h, 5, 140, 500);
    expect(r.applied).toBeGreaterThan(0);
    assertSane(h);
    expect(balls[0]!.x).toBeCloseTo(140 + R, 0);
    expect(balls[1]!.x).toBeGreaterThan(150 + 2 * R + 1);
  });

  it('a rail sweeping through a cluster never leaves a ball outside, crushed, or overlapping', () => {
    const rng = createRng(3);
    const balls: Ball[] = [ball(0, 250, 250)];
    for (let i = 1; i <= 10; i++) balls.push(ball(i, 600 + (i % 4) * 50, 170 + Math.floor(i / 4) * 55));
    const h = host(balls, createTable(), 100000);
    for (let k = 0; k < 150; k++) {
      const v = h.table.verts[rng.int(h.table.verts.length)]!;
      moveVertex(h, v.id, v.x + rng.range(-60, 60), v.y + rng.range(-60, 60));
      assertSane(h);
    }
  });

  it('refuses to slide a hole over a ball (no free pots), but a ball already close can stay', () => {
    const b = ball(1, 900, 100);
    const h = host([ball(0, 250, 250), b]);
    const r = moveVertex(h, 2, 910, 60); // drag the top-right pocket toward the ball
    expect(r.blocked).toBe('keep-out');
    const g = h.geom.pockets.find((p) => p.vid === 2)!;
    expect(Math.hypot(g.x - b.x, g.y - b.y)).toBeGreaterThanOrEqual(g.sr - 0.02);
    // Moving a different vertex is still fine.
    expect(moveVertex(h, 5, -40, 520).blocked).toBeNull();
  });
});

describe('bends', () => {
  it('grabbing a midpoint inserts a bend that can be dragged into a funnel', () => {
    const h = host([ball(0, 250, 250)]);
    const handle = hitHandle(h.table, 750, 0, 30)!;
    expect(handle.kind).toBe('edge');
    const s = DragSession.begin(h, handle, 750, 0)!;
    expect(s.inserted).toBe(true);
    expect(h.table.verts).toHaveLength(7);
    const r = s.move(h, 760, 90);
    expect(r.applied).toBeGreaterThan(80);
    expect(s.end(h)).toBe(false); // it moved, so it stays
    expect(h.table.verts).toHaveLength(7);
    assertSane(h);
  });

  it('an inserted bend that barely moved is dropped on release', () => {
    const h = host([ball(0, 250, 250)]);
    const s = DragSession.begin(h, hitHandle(h.table, 250, 0, 30)!, 250, 0)!;
    s.move(h, 250.5, 0.5);
    expect(s.end(h)).toBe(true);
    expect(h.table.verts).toHaveLength(6);
  });

  it('removing a bend costs its distance from the neighbours line and shoves balls back in', () => {
    const b = ball(1, 750, 250);
    const h = host([ball(0, 250, 250), b], createTable(), 100000);
    const s = DragSession.begin(h, hitHandle(h.table, 750, 0, 30)!, 750, 0)!;
    s.move(h, 750, -90); // pull the rail outward to make a bulge
    s.end(h);
    b.x = 750;
    b.y = -40; // park a ball inside the bulge
    const before = h.budget;
    const bend = h.table.verts.find((v) => !v.pocket)!;
    const r = removeBend(h, bend.id);
    expect(r.removed).toBe(true);
    expect(before - h.budget).toBeCloseTo(90, 0);
    expect(h.table.verts).toHaveLength(6);
    assertSane(h);
    expect(b.y).toBeGreaterThanOrEqual(R - 0.5);
  });

  it('pocket vertices cannot be removed', () => {
    const h = host([ball(0, 250, 250)]);
    expect(removeBend(h, 0)).toMatchObject({ removed: false, blocked: 'pocket' });
  });
});

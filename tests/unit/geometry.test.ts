import { describe, expect, it } from 'vitest';
import {
  HOLE_OFFSET,
  MAX_ANGLE_DEG,
  MAX_ANGLE_TURN,
  MIN_ANGLE_DEG,
  MIN_ANGLE_TURN,
  MOUTH,
  POCKET_OPEN_MIN_DEG,
  POCKET_OPEN_TURN,
  TABLE_H,
  TABLE_W,
} from '../../src/config';
import { subSeed } from '../../src/core/rng';
import {
  angleAbove,
  angleBelow,
  centroid,
  closestOnSegment,
  interiorAngle,
  nearestBoundary,
  pointInPolygon,
  segmentsIntersect,
  signedArea,
} from '../../src/geom/polygon';
import {
  AREA0,
  buildGeom,
  canSplitEdge,
  cloneTable,
  createTable,
  insertVertex,
  validateTable,
  withoutVertex,
} from '../../src/geom/table';
import { castGuide, rayCircle, raySegment } from '../../src/geom/raycast';
import { makeBall, type Ball } from '../../src/physics/world';

const P = (x: number, y: number) => ({ x, y });
const DEG = Math.PI / 180;

describe('polygon primitives', () => {
  it('signed area of the starting table is positive and equals w*h', () => {
    const t = createTable();
    expect(signedArea(t.verts)).toBeCloseTo(TABLE_W * TABLE_H);
    expect(AREA0).toBe(TABLE_W * TABLE_H);
  });

  it('point in polygon handles inside, outside and reflex shapes', () => {
    const sq = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
    expect(pointInPolygon(5, 5, sq)).toBe(true);
    expect(pointInPolygon(15, 5, sq)).toBe(false);
    // L shape (positive area): the notch at the top right is outside
    const L = [P(0, 0), P(10, 0), P(10, 4), P(4, 4), P(4, 10), P(0, 10)];
    expect(signedArea(L)).toBeGreaterThan(0);
    expect(pointInPolygon(2, 8, L)).toBe(true);
    expect(pointInPolygon(8, 8, L)).toBe(false);
  });

  it('closest point on a segment clamps to the endpoints', () => {
    expect(closestOnSegment(5, 5, 0, 0, 10, 0)).toMatchObject({ x: 5, y: 0, t: 0.5 });
    expect(closestOnSegment(-5, 3, 0, 0, 10, 0)).toMatchObject({ x: 0, y: 0, t: 0 });
    expect(closestOnSegment(50, -3, 0, 0, 10, 0)).toMatchObject({ x: 10, y: 0, t: 1 });
  });

  it('segment intersection covers crossing, touching, collinear and disjoint cases', () => {
    expect(segmentsIntersect(P(0, 0), P(10, 10), P(0, 10), P(10, 0))).toBe(true);
    expect(segmentsIntersect(P(0, 0), P(10, 0), P(10, 0), P(20, 5))).toBe(true);
    expect(segmentsIntersect(P(0, 0), P(10, 0), P(5, 0), P(20, 0))).toBe(true);
    expect(segmentsIntersect(P(0, 0), P(10, 0), P(11, 0), P(20, 0))).toBe(false);
    expect(segmentsIntersect(P(0, 0), P(10, 0), P(0, 1), P(10, 1))).toBe(false);
  });

  it('interior angles: convex 90, collinear 180, reflex 270', () => {
    expect(interiorAngle(P(0, 0), P(10, 0), P(10, 10)) / DEG).toBeCloseTo(90);
    expect(interiorAngle(P(0, 0), P(10, 0), P(20, 0)) / DEG).toBeCloseTo(180);
    expect(interiorAngle(P(0, 0), P(10, 0), P(10, -10)) / DEG).toBeCloseTo(270);
  });

  it('the trig-free angle tests agree with interiorAngle and the degree constants', () => {
    for (const [turn, deg] of [
      [POCKET_OPEN_TURN, 180 - POCKET_OPEN_MIN_DEG],
      [MIN_ANGLE_TURN, 180 - MIN_ANGLE_DEG],
      [MAX_ANGLE_TURN, 180 - MAX_ANGLE_DEG],
    ] as const) {
      expect(turn.c).toBeCloseTo(Math.cos(deg * DEG), 14);
      expect(turn.s).toBeCloseTo(Math.sin(deg * DEG), 14);
    }
    // Sweep the corner p = origin through every direction of the outgoing edge.
    const prev = P(-100, 0);
    const p = P(0, 0);
    for (let k = 1; k < 720; k++) {
      const a = (k / 720) * 2 * Math.PI;
      const next = P(Math.cos(a) * 80, Math.sin(a) * 80);
      const ang = interiorAngle(prev, p, next) / DEG;
      if (Math.abs(ang - POCKET_OPEN_MIN_DEG) > 1e-6)
        expect(angleBelow(prev, p, next, POCKET_OPEN_TURN)).toBe(ang < POCKET_OPEN_MIN_DEG);
      if (Math.abs(ang - MIN_ANGLE_DEG) > 1e-6)
        expect(angleBelow(prev, p, next, MIN_ANGLE_TURN)).toBe(ang < MIN_ANGLE_DEG);
      if (Math.abs(ang - MAX_ANGLE_DEG) > 1e-6)
        expect(angleAbove(prev, p, next, MAX_ANGLE_TURN)).toBe(ang > MAX_ANGLE_DEG);
    }
    // A hairpin is sharper than anything; straight on is 180.
    expect(angleBelow(prev, p, P(-50, 0), MIN_ANGLE_TURN)).toBe(true);
    expect(angleBelow(prev, p, P(50, 0), POCKET_OPEN_TURN)).toBe(false);
    expect(angleAbove(prev, p, P(50, 0), MAX_ANGLE_TURN)).toBe(false);
  });

  it('sub-seeds are stable and independent per salt and index', () => {
    expect(subSeed(42, 'angles', 3)).toBe(subSeed(42, 'angles', 3));
    const seen = new Set([
      subSeed(42, 'angles', 0),
      subSeed(42, 'angles', 1),
      subSeed(42, 'respawn', 0),
      subSeed(43, 'angles', 0),
    ]);
    expect(seen.size).toBe(4);
  });

  it('nearest boundary reports the inward normal', () => {
    const sq = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
    const q = nearestBoundary(5, -2, sq);
    expect(q).toMatchObject({ x: 5, y: 0, edge: 0 });
    expect(q.nx).toBeCloseTo(0);
    expect(q.ny).toBeCloseTo(1);
    expect(centroid(sq)).toEqual({ x: 5, y: 5 });
  });
});

describe('table geometry', () => {
  it('builds six open pockets with holes pushed outside the vertices', () => {
    const g = buildGeom(createTable());
    expect(g.pockets).toHaveLength(6);
    expect(g.pockets.every((p) => p.open)).toBe(true);
    const corner = g.pockets.find((p) => p.vx === TABLE_W && p.vy === 0)!;
    expect(corner.angle / DEG).toBeCloseTo(90);
    const off = HOLE_OFFSET / Math.SQRT2;
    expect(corner.x).toBeCloseTo(TABLE_W + off);
    expect(corner.y).toBeCloseTo(-off);
    const side = g.pockets.find((p) => p.vx === TABLE_W / 2 && p.vy === 0)!;
    expect(side.angle / DEG).toBeCloseTo(180);
    expect(side.y).toBeCloseTo(-HOLE_OFFSET);
    expect(pointInPolygon(corner.x, corner.y, g.poly)).toBe(false);
  });

  it('rails are shortened by the mouth at open pockets and face inward', () => {
    const g = buildGeom(createTable());
    expect(g.rails).toHaveLength(6);
    const top = g.rails[0]!; // (0,0) -> (500,0)
    expect(top.ax).toBeCloseTo(MOUTH);
    expect(top.bx).toBeCloseTo(TABLE_W / 2 - MOUTH);
    expect(top.nx).toBeCloseTo(0);
    expect(top.ny).toBeCloseTo(1);
    for (const r of g.rails) {
      const mx = (r.ax + r.bx) / 2 + r.nx * 5;
      const my = (r.ay + r.by) / 2 + r.ny * 5;
      expect(pointInPolygon(mx, my, g.poly)).toBe(true);
    }
  });

  it('a pocket squeezed below the minimum angle closes and its rails run full length', () => {
    const t = createTable();
    // Slide the bottom-left corner right so the top-left corner becomes a narrow wedge.
    t.verts[5]!.x = 370;
    const g = buildGeom(t);
    const p0 = g.pockets.find((p) => p.vid === 0)!;
    expect(p0.angle / DEG).toBeLessThan(POCKET_OPEN_MIN_DEG);
    expect(p0.open).toBe(false);
    expect(g.rails[0]!.ax).toBeCloseTo(0); // no mouth cut at the closed corner
    expect(g.rails[5]!.bx).toBeCloseTo(0);
    expect(g.rails[5]!.by).toBeCloseTo(0);
  });

  it('validates the starting table and rejects broken shapes', () => {
    const ok = createTable();
    expect(validateTable(ok)).toEqual({ ok: true });

    const crossed = cloneTable(ok);
    crossed.verts[3]!.x = -50; // bottom-right corner dragged across the table
    crossed.verts[3]!.y = -50;
    expect(validateTable(crossed).ok).toBe(false);

    const outside = cloneTable(ok);
    outside.verts[2]!.x = 5000;
    expect(validateTable(outside)).toEqual({ ok: false, reason: 'out-of-bounds' });

    const short = cloneTable(ok);
    short.verts[1]!.x = 60;
    expect(validateTable(short)).toEqual({ ok: false, reason: 'short-edge' });

    const tiny = cloneTable(ok);
    tiny.verts[1]!.y = 440;
    tiny.verts[4]!.y = 60;
    expect(validateTable(tiny).ok).toBe(false);

    const pinch = cloneTable(ok);
    pinch.verts[1]!.y = 470; // top side pocket pushed down to within a ball of the bottom rail
    expect(validateTable(pinch).ok).toBe(false);
  });

  it('inserts a bend at an edge midpoint and removes it again', () => {
    const t = createTable();
    expect(canSplitEdge(t, 0)).toBe(true);
    const i = insertVertex(t, 0);
    expect(i).toBe(1);
    expect(t.verts[1]).toMatchObject({ x: 250, y: 0, pocket: false });
    expect(validateTable(t).ok).toBe(true);
    expect(buildGeom(t).pockets).toHaveLength(6);
    expect(withoutVertex(t, 0)).toBeNull(); // pocket vertices stay
    const back = withoutVertex(t, 1)!;
    expect(back.verts).toHaveLength(6);
  });
});

describe('ray casting', () => {
  it('ray vs circle and segment', () => {
    expect(rayCircle(0, 0, 1, 0, 10, 0, 2)).toBeCloseTo(8);
    expect(rayCircle(0, 0, -1, 0, 10, 0, 2)).toBe(Infinity);
    expect(raySegment(0, 0, 1, 0, 5, -1, 5, 1)).toBeCloseTo(5);
    expect(raySegment(0, 0, 1, 0, 5, 1, 5, 2)).toBe(Infinity);
  });

  const cueAt = (x: number, y: number): Ball => makeBall({ id: 0, x, y });

  it('guide reflects off a rail with equal angles', () => {
    const g = buildGeom(createTable());
    const cue = cueAt(100, 300);
    const d = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }; // up and to the right, into the top-left rail
    const guide = castGuide(g, [cue], cue, d.x, d.y);
    expect(guide.kind).toBe('rail');
    expect(guide.path.y1).toBeCloseTo(24); // ball centre stops one radius from the rail
    expect(guide.bounce).toBeDefined();
    const bx = guide.bounce!.x1 - guide.bounce!.x0;
    const by = guide.bounce!.y1 - guide.bounce!.y0;
    expect(bx).toBeGreaterThan(0);
    expect(by).toBeGreaterThan(0);
    expect(Math.abs(bx)).toBeCloseTo(Math.abs(by));
  });

  it('guide reports a ball hit with the object ball leaving along the line of centres', () => {
    const g = buildGeom(createTable());
    const cue = cueAt(250, 250);
    const obj = makeBall({ id: 5, x: 500, y: 250 });
    const guide = castGuide(g, [cue, obj], cue, 1, 0);
    expect(guide.kind).toBe('ball');
    expect(guide.path.x1).toBeCloseTo(452);
    expect(guide.target?.dx).toBeCloseTo(1);
    expect(guide.target?.dy).toBeCloseTo(0);
  });

  it('guide warns when the cue is headed into a hole', () => {
    const g = buildGeom(createTable());
    const side = g.pockets.find((p) => p.vx === 500 && p.vy === 0)!;
    const cue = cueAt(500, 250);
    const guide = castGuide(g, [cue], cue, 0, -1);
    expect(guide.kind).toBe('hole');
    expect(guide.pocket?.vid).toBe(side.vid);
    expect(guide.path.y1).toBeCloseTo(side.y + side.rc);
  });
});

import {
  CAPTURE_R,
  CUE_CAPTURE_R,
  HOLE_OFFSET,
  HUNGER_CAPTURE,
  HUNGER_SUCTION,
  MAX_ANGLE_TURN,
  MAX_VERTS,
  MIN_ANGLE_TURN,
  MIN_AREA_FRAC,
  MIN_CLEARANCE,
  MIN_EDGE,
  MOUTH,
  PLAY,
  POCKET_OPEN_TURN,
  SUCTION_R,
  TABLE_H,
  TABLE_W,
} from '../config';
import { hyp, type Vec } from '../core/vec';
import { angleAbove, angleBelow, distToSegment, segmentsIntersect, signedArea } from './polygon';

export interface TableVertex {
  /** Stable identity across insertions and removals. */
  id: number;
  x: number;
  y: number;
  pocket: boolean;
}

export interface Table {
  verts: TableVertex[];
  nextId: number;
}

/** A cushion segment: one per polygon edge, shortened at open pocket mouths. */
export interface Rail {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Inward unit normal. */
  nx: number;
  ny: number;
  /** Index of the polygon edge (edge i runs from vertex i to vertex i+1). */
  edge: number;
  /** Parameter range of this rail along its full edge. */
  t0: number;
  t1: number;
}

export interface Pocket {
  /** Vertex index at build time. */
  index: number;
  /** Vertex id (stable). */
  vid: number;
  /** Vertex position. */
  vx: number;
  vy: number;
  /** Hole centre (displaced outward from the vertex). */
  x: number;
  y: number;
  /** Interior angle at the vertex, radians. */
  angle: number;
  open: boolean;
  /** Inward bisector (unit). */
  inx: number;
  iny: number;
  /** Capture radius: an object ball centre inside it drops in. */
  r: number;
  /** Capture radius for the cue ball. */
  rc: number;
  /** Suction radius: object balls inside it get pulled toward the hole. */
  sr: number;
}

export interface TableGeom {
  poly: Vec[];
  rails: Rail[];
  pockets: Pocket[];
  area: number;
}

export const AREA0 = TABLE_W * TABLE_H;

export function createTable(): Table {
  const pts: [number, number][] = [
    [0, 0],
    [TABLE_W / 2, 0],
    [TABLE_W, 0],
    [TABLE_W, TABLE_H],
    [TABLE_W / 2, TABLE_H],
    [0, TABLE_H],
  ];
  return {
    verts: pts.map(([x, y], i) => ({ id: i, x, y, pocket: true })),
    nextId: pts.length,
  };
}

export function cloneTable(t: Table): Table {
  return { verts: t.verts.map((v) => ({ ...v })), nextId: t.nextId };
}

export function vertexIndex(t: Table, id: number): number {
  return t.verts.findIndex((v) => v.id === id);
}

export function buildGeom(t: Table, hunger = 0): TableGeom {
  const level = Math.max(0, Math.min(HUNGER_CAPTURE.length - 1, Math.round(hunger)));
  const captureR = CAPTURE_R * HUNGER_CAPTURE[level]!;
  const suctionR = SUCTION_R * HUNGER_SUCTION[level]!;
  const vs = t.verts;
  const n = vs.length;
  const poly = vs.map((v) => ({ x: v.x, y: v.y }));
  const pockets: Pocket[] = [];
  const openAt: boolean[] = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i++) {
    const v = vs[i]!;
    if (!v.pocket) continue;
    const a = vs[(i + n - 1) % n]!;
    const b = vs[(i + 1) % n]!;
    let d1x = v.x - a.x;
    let d1y = v.y - a.y;
    const l1 = hyp(d1x, d1y) || 1;
    d1x /= l1;
    d1y /= l1;
    let d2x = b.x - v.x;
    let d2y = b.y - v.y;
    const l2 = hyp(d2x, d2y) || 1;
    d2x /= l2;
    d2y /= l2;
    // Sum of the two inward (left) normals bisects the interior angle for convex, collinear
    // and reflex vertices alike.
    let inx = -d1y - d2y;
    let iny = d1x + d2x;
    const il = hyp(inx, iny) || 1;
    inx /= il;
    iny /= il;
    // Display only: the open test below avoids atan2 so every browser agrees at the threshold.
    // eslint-disable-next-line no-restricted-properties
    const angle = Math.PI - Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y);
    const open = !angleBelow(a, v, b, POCKET_OPEN_TURN);
    openAt[i] = open;
    pockets.push({
      index: i,
      vid: v.id,
      vx: v.x,
      vy: v.y,
      x: v.x - inx * HOLE_OFFSET,
      y: v.y - iny * HOLE_OFFSET,
      angle,
      open,
      inx,
      iny,
      r: captureR,
      rc: CUE_CAPTURE_R,
      sr: suctionR,
    });
  }

  const rails: Rail[] = [];
  for (let i = 0; i < n; i++) {
    const a = vs[i]!;
    const b = vs[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.max(hyp(dx, dy), 1e-9);
    let t0 = openAt[i] ? MOUTH / L : 0;
    let t1 = openAt[(i + 1) % n] ? 1 - MOUTH / L : 1;
    if (t0 > t1) t0 = t1 = (t0 + t1) / 2;
    rails.push({
      ax: a.x + dx * t0,
      ay: a.y + dy * t0,
      bx: a.x + dx * t1,
      by: a.y + dy * t1,
      nx: -dy / L,
      ny: dx / L,
      edge: i,
      t0,
      t1,
    });
  }

  return { poly, rails, pockets, area: signedArea(poly) };
}

export type InvalidReason =
  | 'too-many'
  | 'too-few'
  | 'out-of-bounds'
  | 'short-edge'
  | 'sharp'
  | 'crossing'
  | 'pinch'
  | 'tiny'
  | 'inside-out';

export interface Validity {
  ok: boolean;
  reason?: InvalidReason;
}

/** Checks that a table is a sane, playable, simple polygon. O(n^2) with n <= 12. */
export function validateTable(t: Table, geom?: TableGeom): Validity {
  const vs = t.verts;
  const n = vs.length;
  if (n > MAX_VERTS) return { ok: false, reason: 'too-many' };
  if (n < 3) return { ok: false, reason: 'too-few' };
  for (const v of vs) {
    if (v.x < PLAY.minX || v.x > PLAY.maxX || v.y < PLAY.minY || v.y > PLAY.maxY)
      return { ok: false, reason: 'out-of-bounds' };
  }
  const area = geom ? geom.area : signedArea(vs);
  if (area <= 0) return { ok: false, reason: 'inside-out' };
  if (area < MIN_AREA_FRAC * AREA0) return { ok: false, reason: 'tiny' };
  for (let i = 0; i < n; i++) {
    const a = vs[i]!;
    const b = vs[(i + 1) % n]!;
    if (hyp(b.x - a.x, b.y - a.y) < MIN_EDGE) return { ok: false, reason: 'short-edge' };
  }
  for (let i = 0; i < n; i++) {
    const prev = vs[(i + n - 1) % n]!;
    const next = vs[(i + 1) % n]!;
    if (angleBelow(prev, vs[i]!, next, MIN_ANGLE_TURN) || angleAbove(prev, vs[i]!, next, MAX_ANGLE_TURN))
      return { ok: false, reason: 'sharp' };
  }
  // Non-adjacent edges must not touch.
  for (let i = 0; i < n; i++) {
    const a = vs[i]!;
    const b = vs[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the wrap
      const c = vs[j]!;
      const d = vs[(j + 1) % n]!;
      if (segmentsIntersect(a, b, c, d)) return { ok: false, reason: 'crossing' };
    }
  }
  // Every vertex keeps a ball-sized clearance from every edge it does not belong to.
  // (For non-crossing segments the closest approach always involves an endpoint.)
  for (let i = 0; i < n; i++) {
    const p = vs[i]!;
    for (let j = 0; j < n; j++) {
      if (j === i || (j + 1) % n === i) continue;
      const a = vs[j]!;
      const b = vs[(j + 1) % n]!;
      if (distToSegment(p.x, p.y, a.x, a.y, b.x, b.y) < MIN_CLEARANCE) return { ok: false, reason: 'pinch' };
    }
  }
  return { ok: true };
}

/** Inserts a bend vertex at the midpoint of edge `edge`. Returns the new vertex index. */
export function insertVertex(t: Table, edge: number): number {
  const n = t.verts.length;
  const a = t.verts[edge]!;
  const b = t.verts[(edge + 1) % n]!;
  const v: TableVertex = { id: t.nextId++, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, pocket: false };
  t.verts.splice(edge + 1, 0, v);
  return edge + 1;
}

/** Returns a copy of the table without vertex `index` (pocket vertices cannot be removed). */
export function withoutVertex(t: Table, index: number): Table | null {
  const v = t.verts[index];
  if (!v || v.pocket) return null;
  const c = cloneTable(t);
  c.verts.splice(index, 1);
  return c;
}

/** Edge midpoint handles exist on edges long enough to split into two legal edges. */
export function canSplitEdge(t: Table, edge: number): boolean {
  if (t.verts.length >= MAX_VERTS) return false;
  const n = t.verts.length;
  const a = t.verts[edge]!;
  const b = t.verts[(edge + 1) % n]!;
  return hyp(b.x - a.x, b.y - a.y) >= 2 * MIN_EDGE + 1;
}

/** Convenience used by rendering and the guide ray. */
export function openPockets(g: TableGeom): Pocket[] {
  return g.pockets.filter((p) => p.open);
}

import type { Vec } from '../core/vec';

/** Shoelace signed area. Positive means interior on the left of each edge (see config.ts). */
export function signedArea(pts: readonly Vec[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % n]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Even-odd rule point-in-polygon test. */
export function pointInPolygon(x: number, y: number, pts: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface SegPoint {
  x: number;
  y: number;
  /** Parameter along the segment, clamped to [0, 1]. */
  t: number;
}

export function closestOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): SegPoint {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: ax + dx * t, y: ay + dy * t, t };
}

export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const q = closestOnSegment(px, py, ax, ay, bx, by);
  return Math.hypot(px - q.x, py - q.y);
}

function orient(a: Vec, b: Vec, c: Vec): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function withinBox(a: Vec, b: Vec, p: Vec, eps: number): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - eps &&
    p.x <= Math.max(a.x, b.x) + eps &&
    p.y >= Math.min(a.y, b.y) - eps &&
    p.y <= Math.max(a.y, b.y) + eps
  );
}

/** True if segments ab and cd intersect or touch (collinear overlap included). */
export function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec, eps = 1e-9): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  const s1 = o1 > eps ? 1 : o1 < -eps ? -1 : 0;
  const s2 = o2 > eps ? 1 : o2 < -eps ? -1 : 0;
  const s3 = o3 > eps ? 1 : o3 < -eps ? -1 : 0;
  const s4 = o4 > eps ? 1 : o4 < -eps ? -1 : 0;
  if (s1 * s2 < 0 && s3 * s4 < 0) return true;
  if (s1 === 0 && withinBox(a, b, c, eps)) return true;
  if (s2 === 0 && withinBox(a, b, d, eps)) return true;
  if (s3 === 0 && withinBox(c, d, a, eps)) return true;
  if (s4 === 0 && withinBox(c, d, b, eps)) return true;
  return false;
}

/**
 * Interior angle at p (radians, in (0, 2PI)) for a positive-area polygon visiting prev -> p -> next.
 * 90deg for a rectangle corner, 180deg for a collinear vertex, > 180deg for a reflex vertex.
 */
export function interiorAngle(prev: Vec, p: Vec, next: Vec): number {
  const d1x = p.x - prev.x;
  const d1y = p.y - prev.y;
  const d2x = next.x - p.x;
  const d2y = next.y - p.y;
  const turn = Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y);
  return Math.PI - turn;
}

export interface BoundaryPoint {
  x: number;
  y: number;
  /** Inward unit normal of the edge the point lies on. */
  nx: number;
  ny: number;
  dist: number;
  edge: number;
}

/** Nearest point on the polygon boundary. */
export function nearestBoundary(px: number, py: number, pts: readonly Vec[]): BoundaryPoint {
  let best: BoundaryPoint = { x: px, y: py, nx: 0, ny: 0, dist: Infinity, edge: -1 };
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const q = closestOnSegment(px, py, a.x, a.y, b.x, b.y);
    const d = Math.hypot(px - q.x, py - q.y);
    if (d < best.dist) {
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      best = { x: q.x, y: q.y, nx: -(b.y - a.y) / l, ny: (b.x - a.x) / l, dist: d, edge: i };
    }
  }
  return best;
}

/** Area centroid (falls back to the vertex average for degenerate input). */
export function centroid(pts: readonly Vec[]): Vec {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % n]!;
    const c = p.x * q.y - q.x * p.y;
    a += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  if (Math.abs(a) < 1e-9) {
    const s = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: s.x / pts.length, y: s.y / pts.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

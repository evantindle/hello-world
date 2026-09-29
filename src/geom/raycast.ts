import { R } from '../config';
import type { Ball } from '../physics/world';
import { closestOnSegment } from './polygon';
import type { Pocket, Rail, TableGeom } from './table';

/**
 * Smallest t >= 0 where the ray o + t*d (d unit length) enters the circle, or Infinity.
 * A ray that starts inside counts as an immediate hit only if it is heading inward.
 */
export function rayCircle(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
): number {
  const fx = ox - cx;
  const fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c < 0) return b < 0 ? 0 : Infinity;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

/** Ray vs segment ab. Returns the ray parameter t, or Infinity. */
export function raySegment(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const ex = bx - ax;
  const ey = by - ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const wx = ax - ox;
  const wy = ay - oy;
  const t = (wx * ey - wy * ex) / den;
  const u = (wx * dy - wy * dx) / den;
  if (t < 0 || u < 0 || u > 1) return Infinity;
  return t;
}

/** A ball of radius R swept along the ray vs a rail (i.e. the ray vs the rail's capsule). */
export function sweepRail(ox: number, oy: number, dx: number, dy: number, r: Rail): number {
  let t = Infinity;
  if (dx * r.nx + dy * r.ny < 0) {
    t = raySegment(ox, oy, dx, dy, r.ax + r.nx * R, r.ay + r.ny * R, r.bx + r.nx * R, r.by + r.ny * R);
  }
  t = Math.min(t, rayCircle(ox, oy, dx, dy, r.ax, r.ay, R), rayCircle(ox, oy, dx, dy, r.bx, r.by, R));
  return t;
}

export interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type HitKind = 'rail' | 'ball' | 'hole' | 'none';

interface Hit {
  t: number;
  kind: HitKind;
  rail?: Rail;
  ball?: Ball;
  pocket?: Pocket;
}

export interface Guide {
  path: Seg;
  kind: HitKind;
  /** Unit normal at contact: away from the rail, or from the object ball toward the cue. */
  nx: number;
  ny: number;
  bounce?: Seg;
  bounceKind?: HitKind;
  /** The object ball that would be struck, and the direction it would leave in. */
  target?: { ball: Ball; dx: number; dy: number };
  /** Where the cue would roll after clipping a ball. */
  deflect?: Seg;
  /** The hole the cue is heading for (scratch warning). */
  pocket?: Pocket;
}

function firstHit(
  geom: TableGeom,
  balls: readonly Ball[],
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  skipId: number,
  maxT: number,
): Hit {
  let best: Hit = { t: maxT, kind: 'none' };
  for (const r of geom.rails) {
    const t = sweepRail(ox, oy, dx, dy, r);
    if (t < best.t) best = { t, kind: 'rail', rail: r };
  }
  for (const b of balls) {
    if (!b.active || b.id === skipId) continue;
    const t = rayCircle(ox, oy, dx, dy, b.x, b.y, 2 * R);
    if (t < best.t) best = { t, kind: 'ball', ball: b };
  }
  for (const p of geom.pockets) {
    if (!p.open) continue;
    const t = rayCircle(ox, oy, dx, dy, p.x, p.y, skipId === 0 ? p.rc : p.r);
    if (t < best.t) best = { t, kind: 'hole', pocket: p };
  }
  return best;
}

/**
 * Where the cue ball would go if struck along (dx, dy): first contact plus one faint
 * follow-up segment. Ignores suction and friction, so it is honest but not a prophet.
 */
export function castGuide(
  geom: TableGeom,
  balls: readonly Ball[],
  cue: Ball,
  dx: number,
  dy: number,
  followLen = 360,
): Guide {
  const first = firstHit(geom, balls, cue.x, cue.y, dx, dy, cue.id, 5000);
  const hx = cue.x + dx * first.t;
  const hy = cue.y + dy * first.t;
  const guide: Guide = { path: { x0: cue.x, y0: cue.y, x1: hx, y1: hy }, kind: first.kind, nx: 0, ny: 0 };

  if (first.kind === 'rail' && first.rail) {
    const r = first.rail;
    const q = closestOnSegment(hx, hy, r.ax, r.ay, r.bx, r.by);
    let nx = hx - q.x;
    let ny = hy - q.y;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    guide.nx = nx;
    guide.ny = ny;
    const dn = dx * nx + dy * ny;
    const rx = dx - 2 * dn * nx;
    const ry = dy - 2 * dn * ny;
    const second = firstHit(geom, balls, hx + nx * 0.01, hy + ny * 0.01, rx, ry, cue.id, followLen);
    guide.bounce = { x0: hx, y0: hy, x1: hx + rx * second.t, y1: hy + ry * second.t };
    guide.bounceKind = second.kind;
    if (second.kind === 'hole') guide.pocket = second.pocket;
  } else if (first.kind === 'ball' && first.ball) {
    const b = first.ball;
    let nx = hx - b.x;
    let ny = hy - b.y;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    guide.nx = nx;
    guide.ny = ny;
    guide.target = { ball: b, dx: -nx, dy: -ny };
    // Equal masses: the cue keeps the tangential part of its velocity.
    const dn = dx * nx + dy * ny;
    let tx = dx - dn * nx;
    let ty = dy - dn * ny;
    const tl = Math.hypot(tx, ty);
    if (tl > 1e-3) {
      tx /= tl;
      ty /= tl;
      const len = followLen * 0.5 * tl;
      guide.deflect = { x0: hx, y0: hy, x1: hx + tx * len, y1: hy + ty * len };
    }
  } else if (first.kind === 'hole') {
    guide.pocket = first.pocket;
  }
  return guide;
}

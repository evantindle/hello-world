import { A_SLIDE, BLACKHOLE_CORE, R, SPIN_RANGE } from '../config';
import { hyp } from '../core/vec';
import type { Ball } from '../physics/world';
import { THICK, type Bumper, type Field, type Wall, type Zone } from './parts';
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

/** A ball swept along the ray vs a two-sided segment of half-thickness rad - R (a capsule). */
export function sweepCapsule(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rad: number,
): number {
  const ex = bx - ax;
  const ey = by - ay;
  const l = hyp(ex, ey) || 1;
  const nx = (-ey / l) * rad;
  const ny = (ex / l) * rad;
  return Math.min(
    raySegment(ox, oy, dx, dy, ax + nx, ay + ny, bx + nx, by + ny),
    raySegment(ox, oy, dx, dy, ax - nx, ay - ny, bx - nx, by - ny),
    rayCircle(ox, oy, dx, dy, ax, ay, rad),
    rayCircle(ox, oy, dx, dy, bx, by, rad),
  );
}

/**
 * Where the ray first enters zone z's rectangle, or Infinity. A ray that starts on the zone does
 * not count (a ball resting on a pad does not fire it).
 */
export function rayZone(ox: number, oy: number, dx: number, dy: number, z: Zone): number {
  const px = ox - z.cx;
  const py = oy - z.cy;
  const la = px * z.ux + py * z.uy;
  const lb = -px * z.uy + py * z.ux;
  if (la >= -z.hl && la <= z.hl && lb >= -z.hw && lb <= z.hw) return Infinity;
  const da = dx * z.ux + dy * z.uy;
  const db = -dx * z.uy + dy * z.ux;
  let t0 = 0;
  let t1 = Infinity;
  for (const [l, d, h] of [
    [la, da, z.hl],
    [lb, db, z.hw],
  ] as const) {
    if (Math.abs(d) < 1e-12) {
      if (l < -h || l > h) return Infinity;
      continue;
    }
    let ta = (-h - l) / d;
    let tb = (h - l) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
  }
  return t0 <= t1 ? t0 : Infinity;
}

export interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What the guide line runs into. 'boost', 'portal' (a second one) and 'vortex' (a black hole's
 * pull) end the line with a question: past them the guide would only be guessing. */
export type HitKind = 'rail' | 'ball' | 'hole' | 'part' | 'bumper' | 'boost' | 'portal' | 'vortex' | 'none';

interface Hit {
  t: number;
  kind: HitKind;
  rail?: Rail;
  wall?: Wall;
  bumper?: Bumper;
  ball?: Ball;
  pocket?: Pocket;
  zone?: Zone;
  field?: Field;
  /** Index into geom.portals. */
  portal?: number;
}

/** The launch spin, for a guide that bends with English. */
export interface GuideSpin {
  speed: number;
  /** Launch slip (sideways English). */
  sx: number;
  sy: number;
  /** Banked draw (+) / follow (-). */
  bank: number;
}

export interface Guide {
  /** The skid while side English bends the path (absent without it). Ends where `path` starts. */
  curve?: { x: number; y: number }[];
  /** A portal on the way: the leg into its entrance; `path` then starts where the ball comes out. */
  hop?: { path: Seg; x: number; y: number };
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
  skipPortal = -1,
): Hit {
  let best: Hit = { t: maxT, kind: 'none' };
  for (const r of geom.rails) {
    const t = sweepRail(ox, oy, dx, dy, r);
    if (t < best.t) best = { t, kind: 'rail', rail: r };
  }
  for (const w of geom.walls) {
    // A gate only stops balls coming from ahead of its arrow.
    if (w.kind === 'gate' && (ox - w.ax) * w.nx + (oy - w.ay) * w.ny < 0) continue;
    const t = sweepCapsule(ox, oy, dx, dy, w.ax, w.ay, w.bx, w.by, R + THICK);
    if (t < best.t) best = { t, kind: 'part', wall: w };
  }
  for (const bp of geom.bumpers) {
    const t = rayCircle(ox, oy, dx, dy, bp.x, bp.y, bp.r + R);
    if (t < best.t) best = { t, kind: 'bumper', bumper: bp };
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
  for (const z of geom.zones) {
    if (z.kind !== 'booster') continue;
    const t = rayZone(ox, oy, dx, dy, z);
    if (t < best.t) best = { t, kind: 'boost', zone: z };
  }
  const ends = geom.portals;
  for (let k = 0; k < ends.length; k++) {
    const e = ends[k]!;
    // A ball sitting in a portal has to leave it before it can warp.
    if (k === skipPortal || hyp(ox - e.x, oy - e.y) < e.r) continue;
    const t = rayCircle(ox, oy, dx, dy, e.x, e.y, e.r);
    if (t < best.t) best = { t, kind: 'portal', portal: k };
  }
  for (const f of geom.fields) {
    if (f.kind !== 'blackhole') continue;
    // Already in the pull: show the way to the core.
    const r = hyp(ox - f.x, oy - f.y) < f.r ? BLACKHOLE_CORE : f.r;
    const t = rayCircle(ox, oy, dx, dy, f.x, f.y, r);
    if (t < best.t) best = { t, kind: 'vortex', field: f };
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
  spin?: GuideSpin,
): Guide {
  let ox = cue.x;
  let oy = cue.y;
  let curve: { x: number; y: number }[] | undefined;
  let travelled = 0;
  // Slip left over at the moment of contact (sideways English that has not finished bending).
  let slipX = 0;
  let slipY = 0;
  let hit: Hit | null = null;
  const s0 = spin ? hyp(spin.sx, spin.sy) : 0;
  if (spin && s0 > 1) {
    // The skid: p(t) = p0 + v0 t - A/2 s^ t^2 until the slip is gone (t = T), as in spinFriction.
    const ux = spin.sx / s0;
    const uy = spin.sy / s0;
    const T = s0 / (3.5 * A_SLIDE);
    const vx = dx * spin.speed;
    const vy = dy * spin.speed;
    curve = [{ x: ox, y: oy }];
    const N = 14;
    for (let k = 1; k <= N && !hit; k++) {
      const t = (T * k) / N;
      const px = cue.x + vx * t - 0.5 * A_SLIDE * ux * t * t;
      const py = cue.y + vy * t - 0.5 * A_SLIDE * uy * t * t;
      const sl = hyp(px - ox, py - oy);
      if (sl > 1e-9) {
        const h = firstHit(geom, balls, ox, oy, (px - ox) / sl, (py - oy) / sl, cue.id, sl);
        if (h.kind !== 'none') {
          hit = h;
          dx = (px - ox) / sl;
          dy = (py - oy) / sl;
          const rem = 1 - k / N;
          slipX = spin.sx * rem;
          slipY = spin.sy * rem;
          break;
        }
      }
      travelled += sl;
      ox = px;
      oy = py;
      curve.push({ x: px, y: py });
    }
    if (!hit) {
      const fx = vx - A_SLIDE * ux * T;
      const fy = vy - A_SLIDE * uy * T;
      const fl = hyp(fx, fy) || 1;
      dx = fx / fl;
      dy = fy / fl;
    }
  }
  let first = hit ?? firstHit(geom, balls, ox, oy, dx, dy, cue.id, 5000);
  let hop: Guide['hop'];
  if (first.kind === 'portal' && first.portal !== undefined) {
    // One hop: out of the other end at the same offset, same heading. (A second portal just ends
    // the line.)
    const e = geom.portals[first.portal]!;
    const to = geom.portals[e.to]!;
    const px = ox + dx * first.t;
    const py = oy + dy * first.t;
    hop = { path: { x0: ox, y0: oy, x1: px, y1: py }, x: to.x + (px - e.x), y: to.y + (py - e.y) };
    travelled += first.t;
    ox = hop.x;
    oy = hop.y;
    first = firstHit(geom, balls, ox, oy, dx, dy, cue.id, 5000, e.to);
  }
  const hx = ox + dx * first.t;
  const hy = oy + dy * first.t;
  travelled += first.t;
  const guide: Guide = { path: { x0: ox, y0: oy, x1: hx, y1: hy }, kind: first.kind, nx: 0, ny: 0 };
  if (curve && curve.length > 1) guide.curve = curve;
  if (hop) guide.hop = hop;

  const bouncy = (first.kind === 'rail' && first.rail) || (first.kind === 'part' && first.wall) || first.bumper;
  if (bouncy) {
    let q = { x: hx, y: hy };
    if (first.rail) q = closestOnSegment(hx, hy, first.rail.ax, first.rail.ay, first.rail.bx, first.rail.by);
    else if (first.wall) q = closestOnSegment(hx, hy, first.wall.ax, first.wall.ay, first.wall.bx, first.wall.by);
    else if (first.bumper) q = { x: first.bumper.x, y: first.bumper.y };
    let nx = hx - q.x;
    let ny = hy - q.y;
    const l = hyp(nx, ny) || 1;
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
    const l = hyp(nx, ny) || 1;
    nx /= l;
    ny /= l;
    guide.nx = nx;
    guide.ny = ny;
    guide.target = { ball: b, dx: -nx, dy: -ny };
    // Equal masses: the cue keeps the tangential part of its velocity...
    const dn = dx * nx + dy * ny;
    let tx = dx - dn * nx;
    let ty = dy - dn * ny;
    if (spin) {
      // ...and English then works on it: draw/follow (faded with distance) joins the slip, and
      // the ball ends up heading along v - (2/7) s.
      const bank = spin.bank * Math.max(0, 1 - travelled / SPIN_RANGE);
      const sx = (slipX + bank * dx) / spin.speed;
      const sy = (slipY + bank * dy) / spin.speed;
      tx -= (2 / 7) * sx;
      ty -= (2 / 7) * sy;
    }
    const tl = hyp(tx, ty);
    if (tl > 1e-3) {
      tx /= tl;
      ty /= tl;
      const len = followLen * 0.5 * Math.min(1.4, tl);
      guide.deflect = { x0: hx, y0: hy, x1: hx + tx * len, y1: hy + ty * len };
    }
  } else if (first.kind === 'hole') {
    guide.pocket = first.pocket;
  }
  return guide;
}

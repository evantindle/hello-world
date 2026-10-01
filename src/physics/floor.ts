import {
  A_ROLL,
  BELT_GRIP,
  BLACKHOLE_CORE,
  BOOST_KICKS,
  BLACKHOLE_EXIT_V,
  CORE_DAMP,
  ICE_DRAG,
  ICE_ROLL,
  LIMBO_TIME,
  MAGNET_CORE,
  MUD_DRAG,
  MUD_ROLL,
  PORTAL_SLACK,
  R,
  SAND_DRAG,
  SAND_ROLL,
  V_MAX,
} from '../config';
import { hyp, type Vec } from '../core/vec';
import { inZone, THICK, type FeltKind } from '../geom/parts';
import { distToSegment, pointInPolygon } from '../geom/polygon';
import type { TableGeom } from '../geom/table';
import type { Ball } from './ball';
import type { SolidState } from './solids';
import { clearSpinState } from './spin';

/**
 * Floor toys: speed pads, special felt, magnets, repulsors, portals and black holes. Everything
 * here is a no-op on a table without them, so plain tables replay exactly as before.
 */

export type FloorEvent =
  /** A speed pad kicked a ball along its arrow. */
  | { type: 'boost'; ball: Ball; src: number; x: number; y: number; ux: number; uy: number }
  /** A ball rolled onto a patch of ice, mud or sand. */
  | { type: 'felt'; ball: Ball; src: number; felt: FeltKind; x: number; y: number; speed: number }
  /** A ball went into portal end `src` at (fromX, fromY) and came out of end `link` at (x, y). */
  | {
      type: 'warp';
      ball: Ball;
      src: number;
      link: number;
      fromX: number;
      fromY: number;
      x: number;
      y: number;
    }
  /** A black hole at (x, y) swallowed a ball that was at (fromX, fromY) going (vx, vy)... */
  | {
      type: 'swallowed';
      ball: Ball;
      src: number;
      x: number;
      y: number;
      fromX: number;
      fromY: number;
      vx: number;
      vy: number;
    }
  /** ...and later spat it out at (x, y). */
  | { type: 'bloop'; ball: Ball; src: number; x: number; y: number };

/** Anywhere floor events can be pushed (the world's event list). */
export interface FloorSink {
  push(e: FloorEvent): unknown;
}

/** Per-shot floor state (on the World, so a cloned world agrees). */
export interface FloorState {
  /** Ball count the arrays were sized for. */
  n: number;
  /** [ball * zones + zone]: 1 while the ball's centre is on the zone (a pad kicks on entry only). */
  on: Uint8Array;
  /** Per zone: kicks given this shot (pads only). */
  kicks: Uint8Array;
  /** Per ball, this substep: felt multipliers on rolling friction and drag, and belt velocity. */
  roll: Float64Array;
  drag: Float64Array;
  beltX: Float64Array;
  beltY: Float64Array;
  /** Per ball: portal end index + 1 it has to leave before it can warp again (0 = free). */
  warpLock: Int16Array;
  /** Per ball: index (in geom.fields) of the black hole it is lost in, or -1; and time left. */
  hole: Int16Array;
  limboT: Float64Array;
  /** Balls currently lost in black holes (the shot is not over while any are). */
  limbo: number;
}

export function floorState(geom: TableGeom, balls: readonly Ball[]): FloorState {
  const n = balls.length;
  const nz = geom.zones.length;
  const s: FloorState = {
    n,
    on: new Uint8Array(n * nz),
    kicks: new Uint8Array(nz),
    roll: new Float64Array(n).fill(1),
    drag: new Float64Array(n).fill(1),
    beltX: new Float64Array(n),
    beltY: new Float64Array(n),
    warpLock: new Int16Array(n),
    hole: new Int16Array(n).fill(-1),
    limboT: new Float64Array(n),
    limbo: 0,
  };
  // Balls that start the shot on a pad or in a portal do not fire it until they leave.
  balls.forEach((b, i) => {
    if (!b.active) return;
    geom.zones.forEach((z, k) => {
      if (inZone(z, b.x, b.y)) s.on[i * nz + k] = 1;
    });
    geom.portals.forEach((e, k) => {
      if (s.warpLock[i] === 0 && hyp(b.x - e.x, b.y - e.y) < e.r) s.warpLock[i] = k + 1;
    });
  });
  return s;
}

export function cloneFloor(s: FloorState): FloorState {
  return {
    n: s.n,
    on: s.on.slice(),
    kicks: s.kicks.slice(),
    roll: s.roll.slice(),
    drag: s.drag.slice(),
    beltX: s.beltX.slice(),
    beltY: s.beltY.slice(),
    warpLock: s.warpLock.slice(),
    hole: s.hole.slice(),
    limboT: s.limboT.slice(),
    limbo: s.limbo,
  };
}

function clampSpeed(b: Ball): void {
  const s = hyp(b.vx, b.vy);
  if (s > V_MAX) {
    b.vx *= V_MAX / s;
    b.vy *= V_MAX / s;
  }
}

/**
 * Pads and felt under ball i: kicks it if it just rolled onto a speed pad, pushes it along a fan,
 * and records this substep's friction multipliers and belt velocity for the friction pass.
 * Returns true if something keeps it moving (exempt from the rest snap).
 */
export function zoneForces(
  s: FloorState,
  geom: TableGeom,
  b: Ball,
  i: number,
  h: number,
  out: FloorSink,
): boolean {
  const zones = geom.zones;
  const nz = zones.length;
  let roll = 1;
  let drag = 1;
  let bx = 0;
  let by = 0;
  let driven = false;
  for (let k = 0; k < nz; k++) {
    const z = zones[k]!;
    const at = i * nz + k;
    const inside = inZone(z, b.x, b.y);
    const was = s.on[at] === 1;
    s.on[at] = inside ? 1 : 0;
    if (!inside) continue;
    switch (z.kind) {
      case 'booster':
        if (!was && s.kicks[k]! < BOOST_KICKS) {
          s.kicks[k]!++;
          b.vx += z.ux * z.power;
          b.vy += z.uy * z.power;
          clampSpeed(b);
          b.via++;
          out.push({ type: 'boost', ball: b, src: z.src, x: b.x, y: b.y, ux: z.ux, uy: z.uy });
        }
        break;
      case 'conveyor':
        // Friction works relative to the belt, so a ball on it is carried along.
        roll *= BELT_GRIP;
        drag *= BELT_GRIP;
        bx += z.ux * z.power;
        by += z.uy * z.power;
        driven = true;
        break;
      case 'fan': {
        const a = z.power * b.invMass;
        b.vx += z.ux * a * h;
        b.vy += z.uy * a * h;
        if (a > A_ROLL) driven = true;
        break;
      }
      case 'ice':
        roll *= ICE_ROLL;
        drag *= ICE_DRAG;
        break;
      case 'mud':
        roll *= MUD_ROLL;
        drag *= MUD_DRAG;
        break;
      case 'sand':
        roll *= SAND_ROLL;
        drag *= SAND_DRAG;
        break;
    }
    if (!was && (z.kind === 'ice' || z.kind === 'mud' || z.kind === 'sand')) {
      const speed = hyp(b.vx, b.vy);
      if (speed > 60) out.push({ type: 'felt', ball: b, src: z.src, felt: z.kind, x: b.x, y: b.y, speed });
    }
  }
  s.roll[i] = roll;
  s.drag[i] = drag;
  s.beltX[i] = bx;
  s.beltY[i] = by;
  return driven;
}

/**
 * Magnets pull, repulsors push, black holes pull (and swallow, in teleports()). The pull follows
 * the pockets' curve, strength * (1 - q^4) at q = distance / radius, scaled by 1 / mass. A magnet's
 * pull fades out in its core and damps the ball there, so a caught ball settles on it.
 */
export function pullForces(geom: TableGeom, b: Ball, h: number): boolean {
  let driven = false;
  for (const f of geom.fields) {
    const dx = f.x - b.x;
    const dy = f.y - b.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= f.r * f.r) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-9) {
      // Dead centre: a magnet has nothing left to do, a repulsor shoves along +x.
      if (f.polarity < 0) {
        b.vx += f.strength * b.invMass * h;
        driven = true;
      }
      continue;
    }
    const q = d / f.r;
    let a: number;
    if (f.kind === 'magnet' && f.polarity > 0 && q < MAGNET_CORE) {
      const c = MAGNET_CORE;
      a = f.strength * (1 - c * c * c * c) * (q / c);
      const k = 1 - CORE_DAMP * h;
      b.vx *= k;
      b.vy *= k;
    } else {
      a = f.strength * (1 - q * q * q * q);
    }
    a *= b.invMass * f.polarity;
    b.vx += (dx / d) * a * h;
    b.vy += (dy / d) * a * h;
    if (a > A_ROLL || a < -A_ROLL) driven = true;
  }
  return driven;
}

/** Whether a ball could appear at (x, y) without overlapping a rail, a toy or another ball. */
export function clearSpot(
  geom: TableGeom,
  solid: SolidState,
  balls: readonly Ball[],
  x: number,
  y: number,
  self: number,
): boolean {
  if (!pointInPolygon(x, y, geom.poly)) return false;
  for (const r of geom.rails) if (distToSegment(x, y, r.ax, r.ay, r.bx, r.by) < R) return false;
  for (const w of geom.walls) {
    if (w.kind === 'glass' && (solid.glassHp.get(w.src) ?? 0) <= 0) continue;
    if (distToSegment(x, y, w.ax, w.ay, w.bx, w.by) < R + THICK) return false;
  }
  for (const bp of geom.bumpers) if (hyp(x - bp.x, y - bp.y) < bp.r + R) return false;
  for (let j = 0; j < balls.length; j++) {
    const o = balls[j]!;
    if (j === self || !o.active) continue;
    if (hyp(x - o.x, y - o.y) < 2 * R) return false;
  }
  return true;
}

/**
 * Teleports, after the solver: black holes release balls whose time is up and swallow balls that
 * reach their core; portals move balls that roll into one end out of the other.
 */
export function teleports(
  s: FloorState,
  geom: TableGeom,
  solid: SolidState,
  balls: readonly Ball[],
  h: number,
  out: FloorSink,
  rand: () => number,
): void {
  if (s.limbo > 0) {
    for (let i = 0; i < balls.length; i++) {
      if (s.hole[i]! < 0) continue;
      s.limboT[i] = s.limboT[i]! - h;
      if (s.limboT[i]! > 0) continue;
      const f = geom.fields[s.hole[i]!]!;
      const spot = exitSpot(geom, solid, balls, i, f, rand);
      // Nowhere clear to come out: try again next substep.
      if (spot) release(s, geom, balls[i]!, i, f, spot, rand, out);
    }
  }
  const fields = geom.fields;
  for (let k = 0; k < fields.length; k++) {
    const f = fields[k]!;
    if (f.kind !== 'blackhole') continue;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]!;
      if (!b.active || hyp(b.x - f.x, b.y - f.y) >= BLACKHOLE_CORE) continue;
      const seen = { fromX: b.x, fromY: b.y, vx: b.vx, vy: b.vy };
      b.active = false;
      b.x = f.x;
      b.y = f.y;
      b.vx = 0;
      b.vy = 0;
      clearSpinState(b);
      b.via++;
      b.warps++;
      s.hole[i] = k;
      s.limboT[i] = LIMBO_TIME;
      s.limbo++;
      out.push({ type: 'swallowed', ball: b, src: f.src, x: f.x, y: f.y, ...seen });
    }
  }
  const ends = geom.portals;
  if (!ends.length) return;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]!;
    if (!b.active) continue;
    const lock = s.warpLock[i]!;
    if (lock) {
      const e = ends[lock - 1]!;
      if (hyp(b.x - e.x, b.y - e.y) >= e.r + PORTAL_SLACK) s.warpLock[i] = 0;
    }
    for (let k = 0; k < ends.length; k++) {
      if (s.warpLock[i] === k + 1) continue;
      const e = ends[k]!;
      const ox = b.x - e.x;
      const oy = b.y - e.y;
      if (ox * ox + oy * oy >= e.r * e.r) continue;
      const to = ends[e.to]!;
      const x = to.x + ox;
      const y = to.y + oy;
      // Exit blocked: the ball rolls on over this end for now.
      if (!clearSpot(geom, solid, balls, x, y, i)) break;
      b.x = x;
      b.y = y;
      b.via++;
      b.warps++;
      s.warpLock[i] = e.to + 1;
      out.push({ type: 'warp', ball: b, src: e.src, link: to.src, fromX: e.x + ox, fromY: e.y + oy, x, y });
      break;
    }
  }
}

type HoleField = TableGeom['fields'][number];

/** A clear exit for a swallowed ball: one of the hole's exits at random, else anywhere clear. */
function exitSpot(
  geom: TableGeom,
  solid: SolidState,
  balls: readonly Ball[],
  i: number,
  f: HoleField,
  rand: () => number,
): Vec | null {
  // Exits inside the pull would only swallow the ball again.
  const clear = f.exits.filter(
    (e) => hyp(e.x - f.x, e.y - f.y) >= f.r + R && clearSpot(geom, solid, balls, e.x, e.y, i),
  );
  if (clear.length) return clear[Math.min(clear.length - 1, Math.floor(rand() * clear.length))]!;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of geom.poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  for (let k = 0; k < 24; k++) {
    const x = minX + rand() * (maxX - minX);
    const y = minY + rand() * (maxY - minY);
    if (hyp(x - f.x, y - f.y) < f.r + R) continue;
    if (clearSpot(geom, solid, balls, x, y, i)) return { x, y };
  }
  return null;
}

function release(
  s: FloorState,
  geom: TableGeom,
  b: Ball,
  i: number,
  f: HoleField,
  at: Vec,
  rand: () => number,
  out: FloorSink,
): void {
  // A random direction (rejection-sampled, so no trig), turned to point away from the hole.
  let ux = 1;
  let uy = 0;
  for (let k = 0; k < 16; k++) {
    const x = rand() * 2 - 1;
    const y = rand() * 2 - 1;
    const l2 = x * x + y * y;
    if (l2 > 1e-4 && l2 <= 1) {
      const l = Math.sqrt(l2);
      ux = x / l;
      uy = y / l;
      break;
    }
  }
  if ((at.x - f.x) * ux + (at.y - f.y) * uy < 0) {
    ux = -ux;
    uy = -uy;
  }
  place(s, geom, b, i, at);
  b.vx = ux * BLACKHOLE_EXIT_V;
  b.vy = uy * BLACKHOLE_EXIT_V;
  out.push({ type: 'bloop', ball: b, src: f.src, x: at.x, y: at.y });
}

function place(s: FloorState, geom: TableGeom, b: Ball, i: number, at: Vec): void {
  b.x = at.x;
  b.y = at.y;
  b.vx = 0;
  b.vy = 0;
  b.active = true;
  s.hole[i] = -1;
  s.limboT[i] = 0;
  s.limbo--;
  geom.portals.forEach((e, k) => {
    if (s.warpLock[i] === 0 && hyp(b.x - e.x, b.y - e.y) < e.r) s.warpLock[i] = k + 1;
  });
}

/**
 * The shot is over (the ref called time): anything still lost in a black hole comes back out at
 * rest. Returns the balls put back, which the caller makes sure are inside the table.
 */
export function flushLimbo(
  s: FloorState,
  geom: TableGeom,
  solid: SolidState,
  balls: readonly Ball[],
  rand: () => number,
): Ball[] {
  const back: Ball[] = [];
  if (s.limbo <= 0) return back;
  for (let i = 0; i < balls.length; i++) {
    if (s.hole[i]! < 0) continue;
    const f = geom.fields[s.hole[i]!]!;
    const spot = exitSpot(geom, solid, balls, i, f, rand) ?? f.exits[0] ?? { x: f.x + f.r + R, y: f.y };
    place(s, geom, balls[i]!, i, spot);
    back.push(balls[i]!);
  }
  return back;
}

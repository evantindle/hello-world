import {
  A_ROLL,
  BELT_BOUNCE,
  CUE_BRAKE,
  CUE_TIRED_RAILS,
  E_BALL,
  HIT_EVENT_MIN,
  K_DRAG,
  MAX_MOVE,
  MAX_SUBSTEPS,
  R,
  REST_SPEED,
  SETTLE_GRACE,
  SIM_TIMEOUT,
  SOLVER_ITERS,
  STUCK_BOX,
  STUCK_WINDOW,
  SUCTION_A,
  V_MAX,
  V_STOP,
} from '../config';
import { hyp } from '../core/vec';
import { centroid, nearestBoundary, pointInPolygon } from '../geom/polygon';
import { chomperOpen, type Pocket, type Rail, type TableGeom } from '../geom/table';
import { clearTally, type Ball } from './ball';
import { floorState, flushLimbo, pullForces, teleports, zoneForces, type FloorEvent, type FloorState } from './floor';
import { logBallHit, logCushion, logPot, newLog, type TurnLog } from './log';
import { accepts, spits, spitOut, sucks } from './pockets';
import {
  burnFuse,
  collideBumper,
  collideWall,
  crackEgg,
  flee,
  ghostPass,
  solidState,
  updateGateSides,
  type SolidEvent,
  type SolidState,
} from './solids';
import { clearSpinState, cushionSpin, hasSpin, releaseBank, spinFriction } from './spin';

export { makeBall, type Ball, type BallVariant, type Suit } from './ball';
export type { TurnLog } from './log';

export type PhysEvent =
  | { type: 'ballHit'; a: Ball; b: Ball; x: number; y: number; nx: number; ny: number; speed: number }
  | {
      type: 'wallHit';
      ball: Ball;
      edge: number;
      /** Where along the full edge the hit landed, 0..1. */
      u: number;
      x: number;
      y: number;
      nx: number;
      ny: number;
      speed: number;
    }
  | { type: 'pocketed'; ball: Ball; pocket: Pocket; vx: number; vy: number }
  /** A picky or gentle pocket refused a ball and spat it back out. */
  | { type: 'spat'; ball: Ball; pocket: Pocket }
  /** A chomper's jaws snapped shut (on a ball, if `ball` is set). */
  | { type: 'chomp'; pocket: Pocket; ball: Ball | null }
  | { type: 'rescued'; ball: Ball }
  /** Sidespin threw the cue ball along a cushion. */
  | { type: 'kick'; ball: Ball; x: number; y: number; dv: number }
  | SolidEvent
  | FloorEvent
  | { type: 'stopped'; timedOut: boolean };

export interface World {
  balls: Ball[];
  geom: TableGeom;
  /** Sim time in seconds since the shot. */
  t: number;
  quietFor: number;
  stopped: boolean;
  /** Per ball index: inside a pocket's strong pull (keeps the sim alive). */
  pulled: boolean[];
  /** Per ball index: pushed by a field or belt this substep (exempt from the rest snap). */
  driven: boolean[];
  /** Per ball index: a chicken running on its own legs this substep (no rolling friction). */
  running: boolean[];
  lastSubsteps: number;
  /** State of the world's own random stream (black-hole exits), so a cloned world agrees. */
  rngState: number;
  /** Where every ball was at the start of the current stillness window, and when it began. */
  stillAt: number;
  stillX: number[];
  stillY: number[];
  log: TurnLog;
  /** Pockets with chomper jaws, and whether each was open at the last substep. */
  chompers: Pocket[];
  chompOpen: boolean[];
  /** Per ball index: vid + 1 of the pocket that just spat it out (0 = none), until it gets clear. */
  spitLock: number[];
  /** Glass hit points, gate memory and bumper kicks for this shot. */
  solid: SolidState;
  /** Pad memory, felt under each ball, portal locks and black-hole limbo. */
  floor: FloorState;
  /** Stuck detector (tables with floor toys): when the window began, each ball's extent since
   * ([minX, minY, maxX, maxY] per ball), and whether a toy pushed it. */
  stuckAt: number;
  box: Float64Array;
  pushed: Uint8Array;
}

/** Seconds per stillness check: if nothing moved more than STILL_DIST in one, the shot is over. */
const STILL_WINDOW = 0.5;
const STILL_DIST = 1.5;

export function createWorld(balls: Ball[], geom: TableGeom, seed = 0): World {
  for (const b of balls) clearTally(b);
  return {
    balls,
    geom,
    t: 0,
    quietFor: 0,
    stopped: false,
    pulled: balls.map(() => false),
    driven: balls.map(() => false),
    running: balls.map(() => false),
    lastSubsteps: 0,
    rngState: seed >>> 0,
    stillAt: 0,
    stillX: balls.map((b) => b.x),
    stillY: balls.map((b) => b.y),
    log: newLog(),
    chompers: geom.pockets.filter((p) => p.plug !== null),
    chompOpen: geom.pockets.filter((p) => p.plug !== null).map((p) => chomperOpen(chomperOf(p), 0)),
    spitLock: balls.map(() => 0),
    solid: solidState(geom.walls, geom.bumpers, balls),
    floor: floorState(geom, balls),
    stuckAt: 0,
    box: boxOf(balls),
    pushed: new Uint8Array(balls.length),
  };
}

function boxOf(balls: readonly Ball[]): Float64Array {
  const box = new Float64Array(balls.length * 4);
  balls.forEach((b, i) => box.set([b.x, b.y, b.x, b.y], i * 4));
  return box;
}

function chomperOf(p: Pocket): { period: number; open: number; phase: number } {
  return p.trait?.kind === 'chomper' ? p.trait : { period: 1, open: 1, phase: 0 };
}

/** The world's own mulberry32 stream, in [0, 1). */
export function worldRand(w: World): number {
  w.rngState = (w.rngState + 0x6d2b79f5) >>> 0;
  let t = w.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function speedOf(b: Ball): number {
  return hyp(b.vx, b.vy);
}

function maxSpeed(balls: Ball[]): number {
  let vmax = 0;
  for (const b of balls) {
    if (!b.active) continue;
    const s = hyp(b.vx, b.vy);
    if (s > vmax) vmax = s;
  }
  return vmax;
}

/** Advance the world by dt (normally the fixed step H), appending events to `out`. */
export function stepWorld(w: World, dt: number, out: PhysEvent[]): void {
  const balls = w.balls;
  const nb = balls.length;
  if (w.pulled.length !== nb) w.pulled = balls.map(() => false);
  if (w.driven.length !== nb) w.driven = balls.map(() => false);
  if (w.spitLock.length !== nb) w.spitLock = balls.map(() => 0);
  if (w.running.length !== nb) w.running = balls.map(() => false);
  if (w.floor.n !== nb) w.floor = floorState(w.geom, balls);
  if (w.pushed.length !== nb) {
    w.pushed = new Uint8Array(nb);
    w.box = boxOf(balls);
  }

  let vmax = 0;
  for (let i = 0; i < nb; i++) {
    const b = balls[i]!;
    if (!b.active) continue;
    let s = hyp(b.vx, b.vy);
    if (s > V_MAX) {
      const f = V_MAX / s;
      b.vx *= f;
      b.vy *= f;
      s = V_MAX;
    }
    if (s > vmax) vmax = s;
  }

  // Substeps keep per-substep travel under R/2, so a centre can never hop across a rail. The
  // count is planned from the speeds at the start of the step; if a collision or a kick speeds a
  // ball up mid-step, the rest of the step is re-planned with more (never fewer) substeps.
  let n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((vmax * dt) / MAX_MOVE)));
  let h = dt / n;
  let left = dt;
  let done = 0;
  const rails = w.geom.rails;

  while (done < n) {
    const mark = out.length;
    // Sim time at the end of this substep.
    const t = w.t + (dt - left) + h;
    for (let i = 0; i < nb; i++) {
      const b = balls[i]!;
      if (!b.active) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
    }
    if (w.chompers.length) chomp(w, t, out);
    const walls = w.geom.walls;
    const bumpers = w.geom.bumpers;
    const zoned = w.geom.zones.length > 0;
    for (let it = 0; it < SOLVER_ITERS; it++) {
      for (let i = 0; i < nb; i++) {
        const a = balls[i]!;
        if (!a.active) continue;
        for (let j = i + 1; j < nb; j++) {
          const b = balls[j]!;
          if (b.active && !ghostPass(a, b)) collideBalls(a, b, out);
        }
      }
      for (let i = 0; i < nb; i++) {
        const b = balls[i]!;
        if (!b.active) continue;
        // A ball riding a belt bounces dead (the belt would otherwise juggle it off a rail forever).
        const em = zoned && (w.floor.beltX[i] !== 0 || w.floor.beltY[i] !== 0) ? BELT_BOUNCE : 1;
        for (let k = 0; k < rails.length; k++) collideRail(b, rails[k]!, out, em);
        for (let k = 0; k < w.chompers.length; k++) if (!w.chompOpen[k]) collideRail(b, w.chompers[k]!.plug!, out, em);
        for (let k = 0; k < walls.length; k++) collideWall(w.solid, b, i, walls[k]!, k, out, em);
        for (let k = 0; k < bumpers.length; k++) collideBumper(w.solid, b, bumpers[k]!, k, out);
      }
    }
    effects(w, out, mark);
    updateGateSides(w.solid, walls, balls);
    if (w.floor.limbo > 0 || w.geom.portals.length || w.geom.fields.length) {
      teleports(w.floor, w.geom, w.solid, balls, h, out, () => worldRand(w));
    }
    guard(w, t, out);
    suctionAndCapture(w, h, t, out);
    fields(w, h, out);
    friction(w, h);
    for (let k = mark; k < out.length; k++) note(w, out[k]!);
    done++;
    left -= h;
    if (done < n) {
      const need = Math.ceil((maxSpeed(balls) * left) / MAX_MOVE);
      if (need > n - done) {
        n = done + Math.min(MAX_SUBSTEPS, need);
        h = left / (n - done);
      }
    }
  }
  w.lastSubsteps = n;

  // A ball lost in a black hole is still on its way somewhere.
  let moving = w.floor.limbo > 0;
  for (let i = 0; i < nb && !moving; i++) {
    const b = balls[i]!;
    if (b.active && (b.vx !== 0 || b.vy !== 0 || w.pulled[i])) moving = true;
  }
  w.quietFor = moving ? 0 : w.quietFor + dt;
  w.t += dt;
  if (w.stopped) return;
  if (w.quietFor >= SETTLE_GRACE) {
    finish(w, out, false);
  } else if (w.t - w.stillAt >= STILL_WINDOW) {
    // A ball pinned against a rail by a field (or wedged somewhere) never reads as quiet: if
    // nothing has really moved for a whole window, call the shot over anyway.
    let still = w.floor.limbo === 0;
    for (let i = 0; i < nb && still; i++) {
      const b = balls[i]!;
      if (b.active && hyp(b.x - w.stillX[i]!, b.y - w.stillY[i]!) >= STILL_DIST) {
        still = false;
        break;
      }
    }
    if (still) {
      for (const b of balls) {
        b.vx = 0;
        b.vy = 0;
      }
      finish(w, out, false);
    } else {
      w.stillAt = w.t;
      for (let i = 0; i < nb; i++) {
        w.stillX[i] = balls[i]!.x;
        w.stillY[i] = balls[i]!.y;
      }
    }
  }
  if (!w.stopped && (w.geom.zones.length || w.geom.fields.length) && stuck(w)) {
    for (const b of balls) {
      b.vx = 0;
      b.vy = 0;
    }
    finish(w, out, false);
  }
  if (!w.stopped && w.t >= SIM_TIMEOUT) {
    for (const b of balls) {
      b.vx = 0;
      b.vy = 0;
    }
    finish(w, out, true);
  }
}

/**
 * A belt can bounce a ball off a rail forever, and the stillness check never sees it sit still.
 * Over each window, track how far every ball strays; if every ball that moved was being pushed by
 * a toy and stayed inside a small box, it is stuck, and the shot is over.
 */
function stuck(w: World): boolean {
  const balls = w.balls;
  const box = w.box;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]!;
    if (!b.active) continue;
    const k = i * 4;
    if (b.x < box[k]!) box[k] = b.x;
    if (b.y < box[k + 1]!) box[k + 1] = b.y;
    if (b.x > box[k + 2]!) box[k + 2] = b.x;
    if (b.y > box[k + 3]!) box[k + 3] = b.y;
    if (w.driven[i]) w.pushed[i] = 1;
  }
  if (w.t - w.stuckAt < STUCK_WINDOW) return false;
  let jammed = w.floor.limbo === 0;
  for (let i = 0; i < balls.length && jammed; i++) {
    if (!balls[i]!.active) continue;
    const k = i * 4;
    const ex = box[k + 2]! - box[k]!;
    const ey = box[k + 3]! - box[k + 1]!;
    if (ex < STILL_DIST && ey < STILL_DIST) continue;
    if (!w.pushed[i] || ex >= STUCK_BOX || ey >= STUCK_BOX) jammed = false;
  }
  if (jammed) return true;
  w.stuckAt = w.t;
  w.pushed.fill(0);
  balls.forEach((b, i) => box.set([b.x, b.y, b.x, b.y], i * 4));
  return false;
}

function finish(w: World, out: PhysEvent[], timedOut: boolean): void {
  for (const b of flushLimbo(w.floor, w.geom, w.solid, w.balls, () => worldRand(w))) {
    if (!pointInPolygon(b.x, b.y, w.geom.poly)) rescue(b, w.geom);
  }
  w.stopped = true;
  w.log.timedOut = timedOut;
  const cue = w.balls.find((b) => b.kind === 'cue');
  w.log.cueRest = cue && cue.active ? { x: cue.x, y: cue.y } : null;
  out.push({ type: 'stopped', timedOut });
}

/** Turn-log bookkeeping for an event the world just produced. */
function note(w: World, e: PhysEvent): void {
  switch (e.type) {
    case 'ballHit':
      logBallHit(w.log, e.a, e.b);
      break;
    case 'wallHit':
      logCushion(w.log, e.ball);
      break;
    case 'partHit':
      logCushion(w.log, e.ball);
      break;
    case 'pocketed':
      logPot(w.log, e.ball, e.pocket.vid, w.t);
      break;
    case 'glass':
      w.log.glassHp[e.src] = e.hp;
      break;
    case 'egg':
      if (!w.log.cracked.includes(e.ball.num)) w.log.cracked.push(e.ball.num);
      if (e.hp <= 0) w.log.broken.push(e.ball.num);
      break;
    case 'bomb':
      w.log.exploded.push(e.ball.num);
      break;
    default:
      break;
  }
}

/**
 * Knock-on effects of this substep's contacts, applied after the solver so the collision loops
 * stay stable: eggs crack on hard knocks, bombs burn their fuse on every real one.
 */
function effects(w: World, out: PhysEvent[], mark: number): void {
  const end = out.length;
  for (let k = mark; k < end; k++) {
    const e = out[k]!;
    let hit: Ball[];
    if (e.type === 'ballHit') hit = [e.a, e.b];
    else if (e.type === 'wallHit' || e.type === 'partHit' || e.type === 'bumperHit') hit = [e.ball];
    else continue;
    const speed = e.speed;
    for (const b of hit) {
      if (b.variant === 'egg') crackEgg(b, speed, out);
      else if (b.variant === 'bomb') burnFuse(b, w.balls, w.solid, w.geom.walls, out);
    }
  }
}

/**
 * Forces that act on balls: speed pads, fans and belts, magnets, repulsors and black holes, and
 * the chicken fleeing a moving cue ball. Each one marks the balls it keeps moving as driven.
 */
function fields(w: World, h: number, out: PhysEvent[]): void {
  const balls = w.balls;
  const zoned = w.geom.zones.length > 0;
  const pulls = w.geom.fields.length > 0;
  let cue: Ball | undefined;
  for (const b of balls) if (b.kind === 'cue') cue = b;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]!;
    const run = b.variant === 'chicken' ? flee(b, cue, h) : false;
    let driven = run;
    if (b.active) {
      if (zoned && zoneForces(w.floor, w.geom, b, i, h, out)) driven = true;
      if (pulls && pullForces(w.geom, b, h)) driven = true;
    }
    w.running[i] = run;
    w.driven[i] = driven;
  }
}

export function collideBalls(a: Ball, b: Ball, out: PhysEvent[]): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  const min = 2 * R;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2);
  let nx = 1;
  let ny = 0;
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  }
  const ia = a.invMass;
  const ib = b.invMass;
  // Equal masses keep the original arithmetic exactly, so plain tables replay bit-for-bit.
  const equal = ia === ib;
  if (equal) {
    const half = (min - d) * 0.5 + 0.005;
    a.x -= nx * half;
    a.y -= ny * half;
    b.x += nx * half;
    b.y += ny * half;
  } else {
    // Unequal masses: the lighter ball gives way more.
    const over = min - d;
    const pa = (over * ia) / (ia + ib) + 0.005;
    const pb = (over * ib) / (ia + ib) + 0.005;
    a.x -= nx * pa;
    a.y -= ny * pa;
    b.x += nx * pb;
    b.y += ny * pb;
  }
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return;
  const e = -vn < REST_SPEED ? 0 : E_BALL;
  const avx = a.vx;
  const avy = a.vy;
  const bvx = b.vx;
  const bvy = b.vy;
  if (-vn > HIT_EVENT_MIN) {
    if (a.kind === 'cue') a.braking = true;
    else if (b.kind === 'cue') b.braking = true;
  }
  if (equal) {
    const j = -(1 + e) * vn * 0.5; // equal masses
    a.vx -= nx * j;
    a.vy -= ny * j;
    b.vx += nx * j;
    b.vy += ny * j;
  } else {
    // j = -(1+e) vn / (1/ma + 1/mb), applied to each ball scaled by its 1/m.
    const j = (-(1 + e) * vn) / (ia + ib);
    a.vx -= nx * j * ia;
    a.vy -= ny * j * ia;
    b.vx += nx * j * ib;
    b.vy += ny * j * ib;
  }
  if (-vn > HIT_EVENT_MIN) {
    // English: banked draw/follow goes into the slip at the cue ball's first real contact.
    if (a.bank !== 0) releaseBank(a, avx, avy);
    if (b.bank !== 0) releaseBank(b, bvx, bvy);
    out.push({ type: 'ballHit', a, b, x: a.x + nx * R, y: a.y + ny * R, nx, ny, speed: -vn });
  }
}

/** Circle vs segment. Using the closest point makes rail ends behave as rounded jaws. */
export function collideRail(b: Ball, r: Rail, out: PhysEvent[], em = 1): void {
  const dx = r.bx - r.ax;
  const dy = r.by - r.ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((b.x - r.ax) * dx + (b.y - r.ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = r.ax + dx * t;
  const qy = r.ay + dy * t;
  const ox = b.x - qx;
  const oy = b.y - qy;
  const d2 = ox * ox + oy * oy;
  if (d2 >= R * R) return;
  const d = Math.sqrt(d2);
  let nx = r.nx;
  let ny = r.ny;
  if (d > 1e-6) {
    nx = ox / d;
    ny = oy / d;
  }
  b.x = qx + nx * R;
  b.y = qy + ny * R;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return;
  const e = -vn < REST_SPEED ? 0 : r.e * em;
  const tx = b.vx - nx * vn;
  const ty = b.vy - ny * vn;
  b.vx = tx * r.tdamp - nx * vn * e;
  b.vy = ty * r.tdamp - ny * vn * e;
  const kick = b.kind === 'cue' && hasSpin(b) ? cushionSpin(b, nx, ny, vn, e) : 0;
  if (-vn > HIT_EVENT_MIN) {
    if (b.kind === 'cue') {
      b.rails++;
      if (b.rails >= CUE_TIRED_RAILS) b.braking = true;
    }
    out.push({
      type: 'wallHit',
      ball: b,
      edge: r.edge,
      u: r.t0 + (r.t1 - r.t0) * t,
      x: qx,
      y: qy,
      nx,
      ny,
      speed: -vn,
    });
    if (kick > 150 || kick < -150) out.push({ type: 'kick', ball: b, x: qx, y: qy, dv: Math.abs(kick) });
  }
}

function capture(b: Ball, p: Pocket, out: PhysEvent[]): void {
  const vx = b.vx;
  const vy = b.vy;
  b.active = false;
  b.gone = 'pocketed';
  b.vx = 0;
  b.vy = 0;
  out.push({ type: 'pocketed', ball: b, pocket: p, vx, vy });
}

/**
 * Chomper jaws: when they snap shut, a ball caught in the mouth is swallowed if it is over the
 * hole, otherwise shoved back out onto the felt.
 */
function chomp(w: World, t: number, out: PhysEvent[]): void {
  for (let k = 0; k < w.chompers.length; k++) {
    const p = w.chompers[k]!;
    const open = chomperOpen(chomperOf(p), t);
    const was = w.chompOpen[k]!;
    w.chompOpen[k] = open;
    if (open || !was) continue;
    const pl = p.plug!;
    let ate: Ball | null = null;
    for (const b of w.balls) {
      if (!b.active) continue;
      // How far the centre sits in front of the jaw line (negative: in the mouth).
      const front = (b.x - pl.ax) * pl.nx + (b.y - pl.ay) * pl.ny;
      if (front >= R) continue;
      const ex = pl.bx - pl.ax;
      const ey = pl.by - pl.ay;
      const along = ((b.x - pl.ax) * ex + (b.y - pl.ay) * ey) / (ex * ex + ey * ey);
      if (along < 0 || along > 1) continue;
      if (hyp(b.x - p.x, b.y - p.y) < p.r) {
        capture(b, p, out);
        ate = b;
      } else {
        b.x += pl.nx * (R - front);
        b.y += pl.ny * (R - front);
      }
    }
    out.push({ type: 'chomp', pocket: p, ball: ate });
  }
}

/** Belt and braces: a centre that somehow left the polygon is pocketed or put back. */
function guard(w: World, t: number, out: PhysEvent[]): void {
  const poly = w.geom.poly;
  for (const b of w.balls) {
    if (!b.active || pointInPolygon(b.x, b.y, poly)) continue;
    let best: Pocket | null = null;
    let bd = Infinity;
    for (const p of w.geom.pockets) {
      if (!p.open) continue;
      const d = hyp(p.x - b.x, p.y - b.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best && bd < best.r + R && accepts(best, b, t)) {
      capture(b, best, out);
      continue;
    }
    rescue(b, w.geom);
    out.push({ type: 'rescued', ball: b });
  }
}

/** Put a ball back inside the table, just off the nearest boundary. */
export function rescue(b: Ball, geom: TableGeom): void {
  const poly = geom.poly;
  const q = nearestBoundary(b.x, b.y, poly);
  let x = q.x + q.nx * (R + 0.5);
  let y = q.y + q.ny * (R + 0.5);
  if (!pointInPolygon(x, y, poly)) {
    const c = centroid(poly);
    for (let k = 1; k <= 20 && !pointInPolygon(x, y, poly); k++) {
      x = x + (c.x - x) * 0.2;
      y = y + (c.y - y) * 0.2;
    }
  }
  b.x = x;
  b.y = y;
  const vn = b.vx * q.nx + b.vy * q.ny;
  if (vn < 0) {
    b.vx -= q.nx * vn;
    b.vy -= q.ny * vn;
  }
}

function suctionAndCapture(w: World, h: number, t: number, out: PhysEvent[]): void {
  const pockets = w.geom.pockets;
  const balls = w.balls;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]!;
    w.pulled[i] = false;
    if (!b.active) continue;
    const lock = w.spitLock[i]!;
    for (const p of pockets) {
      if (!p.open) continue;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const d2 = dx * dx + dy * dy;
      const cr = b.kind === 'cue' ? p.rc : p.r;
      if (lock === p.vid + 1 && d2 > 2.25 * cr * cr) w.spitLock[i] = 0;
      if (d2 < cr * cr) {
        if (accepts(p, b, t)) {
          capture(b, p, out);
          break;
        }
        if (spits(p)) {
          spitOut(b, p, cr);
          if (w.spitLock[i] !== p.vid + 1) {
            w.spitLock[i] = p.vid + 1;
            out.push({ type: 'spat', ball: b, pocket: p });
          }
        }
        continue;
      }
      // Holes only slurp object balls they would take. The cue ball (who has eyes, and stares
      // back) has to fall in on its own.
      if (d2 < p.sr * p.sr && sucks(p, b, t)) {
        const d = Math.sqrt(d2);
        const q = d / p.sr;
        const a = SUCTION_A * (1 - q * q * q * q);
        b.vx += (dx / d) * a * h;
        b.vy += (dy / d) * a * h;
        if (a > A_ROLL) w.pulled[i] = true;
      }
    }
  }
}

function friction(w: World, h: number): void {
  const balls = w.balls;
  const fl = w.floor;
  const zoned = w.geom.zones.length > 0;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]!;
    if (!b.active) continue;
    // A fleeing chicken is running on its own legs.
    if (w.running[i]) continue;
    if (!zoned) {
      rub(w, i, b, h, 1, 1);
      continue;
    }
    const bx = fl.beltX[i]!;
    const by = fl.beltY[i]!;
    if (bx === 0 && by === 0) {
      rub(w, i, b, h, fl.roll[i]!, fl.drag[i]!);
      continue;
    }
    // On a conveyor, friction works on the velocity relative to the belt.
    b.vx -= bx;
    b.vy -= by;
    rub(w, i, b, h, fl.roll[i]!, fl.drag[i]!);
    b.vx += bx;
    b.vy += by;
  }
}

/** Rolling friction and drag for one ball, scaled by the felt under it (mr, md). */
function rub(w: World, i: number, b: Ball, h: number, mr: number, md: number): void {
  if (b.kind === 'cue' && (b.eng > 0 || hasSpin(b))) {
    const skidding = spinFriction(b, h, mr, md);
    if (!skidding && hyp(b.vx, b.vy) < V_STOP && !w.pulled[i] && !w.driven[i]) {
      b.vx = 0;
      b.vy = 0;
      clearSpinState(b);
    }
    return;
  }
  const sp = hyp(b.vx, b.vy);
  if (sp === 0) return;
  const k = b.braking ? CUE_BRAKE : 1;
  const sp2 = Math.max(0, sp - A_ROLL * k * mr * h) * (1 - K_DRAG * k * md * h);
  if (sp2 < V_STOP && !w.pulled[i] && !w.driven[i]) {
    b.vx = 0;
    b.vy = 0;
  } else {
    const f = sp2 / sp;
    b.vx *= f;
    b.vy *= f;
  }
}

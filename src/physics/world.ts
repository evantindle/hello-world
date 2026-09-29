import {
  A_ROLL,
  CUE_BRAKE,
  CUE_TIRED_RAILS,
  E_BALL,
  E_WALL,
  HIT_EVENT_MIN,
  K_DRAG,
  MAX_MOVE,
  MAX_SUBSTEPS,
  R,
  REST_SPEED,
  SETTLE_GRACE,
  SIM_TIMEOUT,
  SOLVER_ITERS,
  SUCTION_A,
  T_DAMP,
  V_MAX,
  V_STOP,
} from '../config';
import { centroid, nearestBoundary, pointInPolygon } from '../geom/polygon';
import type { Pocket, Rail, TableGeom } from '../geom/table';

export interface Ball {
  id: number;
  kind: 'cue' | 'object';
  /** 0 for the cue ball, 1..10 for object balls. */
  num: number;
  color: string;
  stripe: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** False once pocketed (and while the cue ball is being spat back out). */
  active: boolean;
  /** Cue ball only: set after its first real hit on an object ball this shot (skids to a stop). */
  braking?: boolean;
  /** Cue ball only: cushions hit this shot. */
  rails?: number;
}

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
  | { type: 'rescued'; ball: Ball }
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
  lastSubsteps: number;
}

export function createWorld(balls: Ball[], geom: TableGeom): World {
  return {
    balls,
    geom,
    t: 0,
    quietFor: 0,
    stopped: false,
    pulled: balls.map(() => false),
    lastSubsteps: 0,
  };
}

export function speedOf(b: Ball): number {
  return Math.hypot(b.vx, b.vy);
}

/** Advance the world by dt (normally the fixed step H), appending events to `out`. */
export function stepWorld(w: World, dt: number, out: PhysEvent[]): void {
  const balls = w.balls;
  const nb = balls.length;
  if (w.pulled.length !== nb) w.pulled = balls.map(() => false);

  let vmax = 0;
  for (let i = 0; i < nb; i++) {
    const b = balls[i]!;
    if (!b.active) continue;
    let s = Math.hypot(b.vx, b.vy);
    if (s > V_MAX) {
      const f = V_MAX / s;
      b.vx *= f;
      b.vy *= f;
      s = V_MAX;
    }
    if (s > vmax) vmax = s;
  }

  // Substeps keep per-substep travel under R/2, so a centre can never hop across a rail.
  const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((vmax * dt) / MAX_MOVE)));
  const h = dt / n;
  w.lastSubsteps = n;
  const rails = w.geom.rails;

  for (let s = 0; s < n; s++) {
    for (let i = 0; i < nb; i++) {
      const b = balls[i]!;
      if (!b.active) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
    }
    for (let it = 0; it < SOLVER_ITERS; it++) {
      for (let i = 0; i < nb; i++) {
        const a = balls[i]!;
        if (!a.active) continue;
        for (let j = i + 1; j < nb; j++) {
          const b = balls[j]!;
          if (b.active) collideBalls(a, b, out);
        }
      }
      for (let i = 0; i < nb; i++) {
        const b = balls[i]!;
        if (!b.active) continue;
        for (let k = 0; k < rails.length; k++) collideRail(b, rails[k]!, out);
      }
    }
    guard(w, out);
    suctionAndCapture(w, h, out);
    friction(w, h);
  }

  let moving = false;
  for (let i = 0; i < nb; i++) {
    const b = balls[i]!;
    if (b.active && (b.vx !== 0 || b.vy !== 0 || w.pulled[i])) {
      moving = true;
      break;
    }
  }
  w.quietFor = moving ? 0 : w.quietFor + dt;
  w.t += dt;
  if (!w.stopped) {
    if (w.quietFor >= SETTLE_GRACE) {
      w.stopped = true;
      out.push({ type: 'stopped', timedOut: false });
    } else if (w.t >= SIM_TIMEOUT) {
      for (const b of balls) {
        b.vx = 0;
        b.vy = 0;
      }
      w.stopped = true;
      out.push({ type: 'stopped', timedOut: true });
    }
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
  const half = (min - d) * 0.5 + 0.005;
  a.x -= nx * half;
  a.y -= ny * half;
  b.x += nx * half;
  b.y += ny * half;
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return;
  const e = -vn < REST_SPEED ? 0 : E_BALL;
  const j = -(1 + e) * vn * 0.5; // equal masses
  if (-vn > HIT_EVENT_MIN) {
    if (a.kind === 'cue') a.braking = true;
    else if (b.kind === 'cue') b.braking = true;
  }
  a.vx -= nx * j;
  a.vy -= ny * j;
  b.vx += nx * j;
  b.vy += ny * j;
  if (-vn > HIT_EVENT_MIN) {
    out.push({ type: 'ballHit', a, b, x: a.x + nx * R, y: a.y + ny * R, nx, ny, speed: -vn });
  }
}

/** Circle vs segment. Using the closest point makes rail ends behave as rounded jaws. */
export function collideRail(b: Ball, r: Rail, out: PhysEvent[]): void {
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
  const e = -vn < REST_SPEED ? 0 : E_WALL;
  const tx = b.vx - nx * vn;
  const ty = b.vy - ny * vn;
  b.vx = tx * T_DAMP - nx * vn * e;
  b.vy = ty * T_DAMP - ny * vn * e;
  if (-vn > HIT_EVENT_MIN) {
    if (b.kind === 'cue') {
      b.rails = (b.rails ?? 0) + 1;
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
  }
}

function capture(b: Ball, p: Pocket, out: PhysEvent[]): void {
  const vx = b.vx;
  const vy = b.vy;
  b.active = false;
  b.vx = 0;
  b.vy = 0;
  out.push({ type: 'pocketed', ball: b, pocket: p, vx, vy });
}

/** Belt and braces: a centre that somehow left the polygon is pocketed or put back. */
function guard(w: World, out: PhysEvent[]): void {
  const poly = w.geom.poly;
  for (const b of w.balls) {
    if (!b.active || pointInPolygon(b.x, b.y, poly)) continue;
    let best: Pocket | null = null;
    let bd = Infinity;
    for (const p of w.geom.pockets) {
      if (!p.open) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best && bd < best.r + R) {
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

function suctionAndCapture(w: World, h: number, out: PhysEvent[]): void {
  const pockets = w.geom.pockets;
  const balls = w.balls;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]!;
    w.pulled[i] = false;
    if (!b.active) continue;
    for (const p of pockets) {
      if (!p.open) continue;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const d2 = dx * dx + dy * dy;
      const cr = b.kind === 'cue' ? p.rc : p.r;
      if (d2 < cr * cr) {
        capture(b, p, out);
        break;
      }
      // Pockets are picky eaters: they only slurp object balls. The cue ball (who has eyes,
      // and stares back) has to fall in on its own.
      if (b.kind === 'object' && d2 < p.sr * p.sr) {
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
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]!;
    if (!b.active) continue;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp === 0) continue;
    const k = b.braking ? CUE_BRAKE : 1;
    const sp2 = Math.max(0, sp - A_ROLL * k * h) * (1 - K_DRAG * k * h);
    if (sp2 < V_STOP && !w.pulled[i]) {
      b.vx = 0;
      b.vy = 0;
    } else {
      const f = sp2 / sp;
      b.vx *= f;
      b.vy *= f;
    }
  }
}

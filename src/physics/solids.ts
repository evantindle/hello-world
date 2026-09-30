import {
  BLAST_R,
  BLAST_V,
  BUMPER_E,
  BUMPER_KICKS,
  BUMPER_MIN,
  CHICKEN_A,
  CHICKEN_R,
  CHICKEN_VMAX,
  EGG_CRACK,
  GLASS_HIT,
  HIT_EVENT_MIN,
  R,
  REST_SPEED,
  V_MAX,
} from '../config';
import { hyp } from '../core/vec';
import { THICK, type Bumper, type Wall } from '../geom/parts';
import type { Ball } from './ball';
import { cushionSpin, hasSpin } from './spin';

/** Events the toys produce (added to the world's PhysEvent union). */
export type SolidEvent =
  | { type: 'partHit'; ball: Ball; src: number; kind: Wall['kind']; x: number; y: number; nx: number; ny: number; speed: number }
  | { type: 'bumperHit'; ball: Ball; src: number; x: number; y: number; nx: number; ny: number; speed: number }
  | { type: 'glass'; src: number; x: number; y: number; hp: number }
  | { type: 'egg'; ball: Ball; hp: number }
  | { type: 'bomb'; ball: Ball; x: number; y: number };

/** Anywhere toy events can be pushed (the world's event list). */
export interface Sink {
  push(e: SolidEvent): unknown;
}

/** The state toys need during a shot (kept on the World so a cloned world agrees). */
export interface SolidState {
  /** Glass panes: part id -> hits left. */
  glassHp: Map<number, number>;
  /** Gate side memory, [ball index * gates + gate index]: +1 ahead of the arrow, -1 behind. */
  gateSide: Int8Array;
  /** Wall index -> gate index (or -1). */
  gateOf: number[];
  gates: number;
  /** Kicks each bumper has given this shot. */
  bumperKicks: number[];
}

export function solidState(walls: readonly Wall[], bumpers: readonly Bumper[], balls: readonly Ball[]): SolidState {
  const gateOf: number[] = [];
  let gates = 0;
  const glassHp = new Map<number, number>();
  for (const w of walls) {
    gateOf.push(w.kind === 'gate' ? gates++ : -1);
    if (w.kind === 'glass' && !glassHp.has(w.src)) glassHp.set(w.src, w.hp ?? 1);
  }
  const gateSide = new Int8Array(balls.length * gates);
  const s: SolidState = { glassHp, gateSide, gateOf, gates, bumperKicks: bumpers.map(() => 0) };
  walls.forEach((w, wi) => {
    const gi = gateOf[wi]!;
    if (gi >= 0) balls.forEach((b, bi) => (gateSide[bi * gates + gi] = sideOf(b, w)));
  });
  return s;
}

function sideOf(b: Ball, w: Wall): number {
  return (b.x - w.ax) * w.nx + (b.y - w.ay) * w.ny >= 0 ? 1 : -1;
}

/** Keeps each ball's gate sides up to date while it is clear of the gate. */
export function updateGateSides(s: SolidState, walls: readonly Wall[], balls: readonly Ball[]): void {
  if (!s.gates) return;
  const min = R + THICK;
  walls.forEach((w, wi) => {
    const gi = s.gateOf[wi]!;
    if (gi < 0) return;
    balls.forEach((b, bi) => {
      if (!b.active) return;
      if (distToWall(b, w) >= min) s.gateSide[bi * s.gates + gi] = sideOf(b, w);
    });
  });
}

function distToWall(b: Ball, w: Wall): number {
  const dx = w.bx - w.ax;
  const dy = w.by - w.ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((b.x - w.ax) * dx + (b.y - w.ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return hyp(b.x - (w.ax + dx * t), b.y - (w.ay + dy * t));
}

function clampSpeed(b: Ball, vmax = V_MAX): void {
  const s = hyp(b.vx, b.vy);
  if (s > vmax) {
    b.vx *= vmax / s;
    b.vy *= vmax / s;
  }
}

/** A two-sided wall (stub, curved rail, glass, gate) with thickness. */
export function collideWall(
  s: SolidState,
  b: Ball,
  bi: number,
  w: Wall,
  wi: number,
  out: Sink,
): void {
  const min = R + THICK;
  const dx = w.bx - w.ax;
  const dy = w.by - w.ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((b.x - w.ax) * dx + (b.y - w.ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = w.ax + dx * t;
  const qy = w.ay + dy * t;
  const ox = b.x - qx;
  const oy = b.y - qy;
  const d2 = ox * ox + oy * oy;
  if (d2 >= min * min) return;
  if (w.kind === 'glass' && (s.glassHp.get(w.src) ?? 0) <= 0) return;
  const gi = s.gateOf[wi]!;
  // A gate only stops balls on the far side of its arrow (coming back the wrong way).
  if (gi >= 0 && s.gateSide[bi * s.gates + gi]! < 0) return;
  const d = Math.sqrt(d2);
  let nx: number;
  let ny: number;
  if (d > 1e-6) {
    nx = ox / d;
    ny = oy / d;
  } else {
    const side = gi >= 0 ? 1 : sideOf(b, w);
    nx = w.nx * side;
    ny = w.ny * side;
  }
  b.x = qx + nx * min;
  b.y = qy + ny * min;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return;
  const e = -vn < REST_SPEED ? 0 : w.e;
  const tx = b.vx - nx * vn;
  const ty = b.vy - ny * vn;
  b.vx = tx * w.tdamp - nx * vn * e;
  b.vy = ty * w.tdamp - ny * vn * e;
  if (b.kind === 'cue' && hasSpin(b)) cushionSpin(b, nx, ny, vn, e);
  if (-vn <= HIT_EVENT_MIN) return;
  out.push({ type: 'partHit', ball: b, src: w.src, kind: w.kind, x: qx, y: qy, nx, ny, speed: -vn });
  if (w.kind === 'glass' && -vn > GLASS_HIT) {
    const hp = Math.max(0, (s.glassHp.get(w.src) ?? 1) - 1);
    s.glassHp.set(w.src, hp);
    out.push({ type: 'glass', src: w.src, x: qx, y: qy, hp });
  }
}

/** A pinball bumper: kicks the ball away harder than it came, for its first few kicks. */
export function collideBumper(s: SolidState, b: Ball, bp: Bumper, k: number, out: Sink): void {
  const min = bp.r + R;
  const ox = b.x - bp.x;
  const oy = b.y - bp.y;
  const d2 = ox * ox + oy * oy;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2);
  const nx = d > 1e-6 ? ox / d : 1;
  const ny = d > 1e-6 ? oy / d : 0;
  b.x = bp.x + nx * min;
  b.y = bp.y + ny * min;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return;
  let vo = 0;
  if (-vn >= REST_SPEED) {
    const lively = s.bumperKicks[k]! < BUMPER_KICKS;
    vo = lively ? Math.max(-vn * BUMPER_E, BUMPER_MIN) : -vn * 0.9;
    s.bumperKicks[k]!++;
  }
  b.vx += nx * (vo - vn);
  b.vy += ny * (vo - vn);
  clampSpeed(b);
  if (b.kind === 'cue' && hasSpin(b)) cushionSpin(b, nx, ny, vn, BUMPER_E);
  if (-vn > HIT_EVENT_MIN) {
    b.via++;
    out.push({ type: 'bumperHit', ball: b, src: bp.src, x: bp.x + nx * bp.r, y: bp.y + ny * bp.r, nx, ny, speed: -vn });
  }
}

/** Ghost balls only ever touch the cue ball. */
export function ghostPass(a: Ball, b: Ball): boolean {
  return (a.variant === 'ghost' && b.kind !== 'cue') || (b.variant === 'ghost' && a.kind !== 'cue');
}

/** Egg: a hard knock cracks it; the second breaks it (it leaves the table). */
export function crackEgg(egg: Ball, speed: number, out: Sink): boolean {
  if (egg.variant !== 'egg' || !egg.active || speed <= EGG_CRACK) return false;
  egg.hp = Math.max(0, egg.hp - 1);
  if (egg.hp <= 0) {
    egg.active = false;
    egg.gone = 'broken';
    egg.vx = 0;
    egg.vy = 0;
  }
  out.push({ type: 'egg', ball: egg, hp: egg.hp });
  return true;
}

/** Bomb: every real knock burns the fuse; at zero it blows, shoving everything nearby. */
export function burnFuse(bomb: Ball, balls: readonly Ball[], s: SolidState, walls: readonly Wall[], out: Sink) {
  if (bomb.variant !== 'bomb' || !bomb.active) return;
  bomb.fuse = Math.max(0, bomb.fuse - 1);
  if (bomb.fuse > 0) return;
  const x = bomb.x;
  const y = bomb.y;
  bomb.active = false;
  bomb.gone = 'exploded';
  bomb.vx = 0;
  bomb.vy = 0;
  for (const b of balls) {
    if (!b.active) continue;
    const dx = b.x - x;
    const dy = b.y - y;
    const d = hyp(dx, dy);
    if (d >= BLAST_R || d < 1e-6) continue;
    const dv = BLAST_V * (1 - d / BLAST_R) * b.invMass;
    b.vx += (dx / d) * dv;
    b.vy += (dy / d) * dv;
    clampSpeed(b);
    if (b.gen === 255) b.gen = Math.min(254, bomb.gen + 1);
  }
  // Glass nearby shatters.
  for (const w of walls) {
    if (w.kind !== 'glass' || (s.glassHp.get(w.src) ?? 0) <= 0) continue;
    const fake = { x, y } as Ball;
    if (distToWall(fake, w) < BLAST_R) {
      s.glassHp.set(w.src, 0);
      out.push({ type: 'glass', src: w.src, x: (w.ax + w.bx) / 2, y: (w.ay + w.by) / 2, hp: 0 });
    }
  }
  out.push({ type: 'bomb', ball: bomb, x, y });
}

/** The chicken bolts away from a moving cue ball. Returns true if it was pushed (driven). */
export function flee(chick: Ball, cue: Ball | undefined, h: number): boolean {
  if (chick.variant !== 'chicken' || !chick.active || !cue || !cue.active) return false;
  if (hyp(cue.vx, cue.vy) < 50) return false;
  const dx = chick.x - cue.x;
  const dy = chick.y - cue.y;
  const d = hyp(dx, dy);
  if (d >= CHICKEN_R || d < 1e-6) return false;
  const a = CHICKEN_A * (1 - d / CHICKEN_R);
  chick.vx += (dx / d) * a * h;
  chick.vy += (dy / d) * a * h;
  clampSpeed(chick, CHICKEN_VMAX);
  return true;
}

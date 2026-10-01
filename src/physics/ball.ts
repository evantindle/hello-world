import { BALL_COLORS, COLORS } from '../config';

/** Oddball balls. 'golden' is physically normal: it only matters to Classic goals. */
export type BallVariant = 'normal' | 'bowling' | 'egg' | 'bomb' | 'chicken' | 'ghost' | 'golden';

/** Warm (odd numbers) and cool (even numbers): picky pockets and multiplayer ownership. */
export type Suit = 'warm' | 'cool';

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
  /** False once pocketed, broken or exploded (and while the cue ball is being spat back out). */
  active: boolean;
  variant: BallVariant;
  /** 1 for a normal ball; the bowling ball is heavier. */
  invMass: number;
  suit: Suit | null;
  /** Egg: cracks left before it breaks. */
  hp: number;
  /** Bomb: hits left before it goes off. */
  fuse: number;
  gone: null | 'pocketed' | 'broken' | 'exploded';
  /** Cue ball only: set after its first real hit on an object ball this shot (skids to a stop). */
  braking: boolean;
  /** Cue ball only: cushions hit this shot. */
  rails: number;
  // English (cue ball only; reset at every strike). Slip s = v - w, the cloth-contact velocity.
  sx: number;
  sy: number;
  /** Banked draw (+) / follow (-), released into the slip at the first ball contact. */
  bank: number;
  /** Sidespin: throws the ball along a cushion when it bounces. */
  wz: number;
  /** How much English was put on this shot, 0..1 (softens the dizzy brake). */
  eng: number;
  // Per-shot bookkeeping, reset by createWorld.
  /** Collision generation: 0 for the cue ball, k+1 for a ball hit by generation k, 255 if untouched. */
  gen: number;
  /** Cushions hit this shot. */
  banks: number;
  /** Boosters, bumpers, portals and black holes this ball went through this shot. */
  via: number;
  /** ...of which portals and black holes (the teleports). */
  warps: number;
}

export const UNTOUCHED = 255;

export function suitOf(num: number): Suit | null {
  return num === 0 ? null : num % 2 === 1 ? 'warm' : 'cool';
}

export interface BallInit {
  id: number;
  x: number;
  y: number;
  num?: number;
  kind?: 'cue' | 'object';
  vx?: number;
  vy?: number;
  variant?: BallVariant;
  color?: string;
}

/** Every Ball goes through here, so they all share one shape (and one hidden class). */
export function makeBall(o: BallInit): Ball {
  const num = o.num ?? o.id;
  const kind = o.kind ?? (num === 0 ? 'cue' : 'object');
  const variant = o.variant ?? 'normal';
  return {
    id: o.id,
    kind,
    num,
    color: o.color ?? (kind === 'cue' ? COLORS.cue : (BALL_COLORS[num - 1] ?? '#ffffff')),
    stripe: num >= 9,
    x: o.x,
    y: o.y,
    vx: o.vx ?? 0,
    vy: o.vy ?? 0,
    active: true,
    variant,
    invMass: variant === 'bowling' ? 1 / 3 : 1,
    suit: kind === 'cue' ? null : suitOf(num),
    hp: variant === 'egg' ? 2 : 0,
    fuse: variant === 'bomb' ? 3 : 0,
    gone: null,
    braking: false,
    rails: 0,
    sx: 0,
    sy: 0,
    bank: 0,
    wz: 0,
    eng: 0,
    gen: kind === 'cue' ? 0 : UNTOUCHED,
    banks: 0,
    via: 0,
    warps: 0,
  };
}

/** Clears braking and spin before a new strike (the launch then sets them afresh). */
export function clearSpin(b: Ball): void {
  b.braking = false;
  b.rails = 0;
  b.sx = 0;
  b.sy = 0;
  b.bank = 0;
  b.wz = 0;
  b.eng = 0;
}

/** Clears the per-shot bookkeeping; createWorld does this for every ball. */
export function clearTally(b: Ball): void {
  b.gen = b.kind === 'cue' ? 0 : UNTOUCHED;
  b.banks = 0;
  b.via = 0;
  b.warps = 0;
}

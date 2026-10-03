import { BUDGET, PAR } from '../config';

/** Where each stroke's cue angle comes from. Sequences are in degrees, +y down (screen). */
export type AngleSource = { kind: 'random' } | { kind: 'sequence'; deg: number[] };

/** How much bending a player gets. */
export type ReshapeLimits =
  | { kind: 'budget'; perTurn: number }
  | { kind: 'tokens'; tokens: number; reach: number }
  | { kind: 'free' };

export type Mode = 'free' | 'classic' | 'toybox' | 'viewer';

/** A Classic level's objective. Ball references are ball numbers. */
export type Goal =
  | { kind: 'clearAll' }
  | { kind: 'sink'; ball: number }
  | { kind: 'order'; balls: number[] }
  | { kind: 'combo'; n: number }
  | { kind: 'bank'; cushions: number }
  | { kind: 'spare'; ball: number }
  | { kind: 'scratch'; pockets?: number[] }
  | { kind: 'park'; bullseye: number };

/** Extra conditions for 2 and 3 stars (winning at all earns 1). */
export interface StarCond {
  /** Strokes plus penalties at most this. */
  score?: number;
  /** Grab tokens spent at most this. */
  tokens?: number;
  flag?: 'noScratch' | 'eggIntact';
}

/** Everything that differs between Free Play, Classic, Toy Box and the replay viewer. */
export interface Ruleset {
  mode: Mode;
  angles: AngleSource;
  reshape: ReshapeLimits;
  /** Strokes allowed (Classic), or null for no limit. */
  shotLimit: number | null;
  /** Pockets grow after dry shots. */
  hunger: boolean;
  /** A scratch bolts the pocket that swallowed the cue ball. */
  boltOnScratch: boolean;
  /** The player may put English on the cue ball. */
  english: boolean;
  /** 'guide': one honest line to first contact. 'chain': the full multi-ball preview. */
  preview: 'guide' | 'chain';
  /** Which way arrow parts (boosters, fans, gates) face when put down: the tray's direction
   * ('fixed', 'free') or spun at random. Every toy can be turned afterwards either way. */
  arrows: 'fixed' | 'random' | 'free';
  /** Toy Box: undo a whole shot. */
  rewind: boolean;
  /** Toy Box: spin the cue again for free. */
  respin: boolean;
  par: number | null;
  goal: Goal | null;
  stars: { three: StarCond; two: StarCond } | null;
}

/** The original game, exactly: tests and old seeds rely on it. */
export const V1_RULES: Readonly<Ruleset> = {
  mode: 'free',
  angles: { kind: 'random' },
  reshape: { kind: 'budget', perTurn: BUDGET },
  shotLimit: null,
  hunger: true,
  boltOnScratch: false,
  english: false,
  preview: 'guide',
  arrows: 'random',
  rewind: false,
  respin: false,
  par: PAR,
  goal: null,
  stars: null,
};

/** v2 Free Play: v1 plus bolted scratches, English, the chain preview and toys you turn yourself. */
export const FREE_RULES: Readonly<Ruleset> = {
  ...V1_RULES,
  boltOnScratch: true,
  english: true,
  preview: 'chain',
  arrows: 'free',
};

/** Toy Box: no limits, no score, every toy. */
export const TOYBOX_RULES: Readonly<Ruleset> = {
  ...V1_RULES,
  mode: 'toybox',
  reshape: { kind: 'free' },
  hunger: false,
  english: true,
  preview: 'chain',
  arrows: 'free',
  rewind: true,
  respin: true,
  par: null,
};

/** The shared-shot viewer: one recorded shot, watched over and over (nothing to play). */
export const VIEWER_RULES: Readonly<Ruleset> = {
  ...TOYBOX_RULES,
  mode: 'viewer',
  preview: 'guide',
  rewind: false,
  respin: false,
};

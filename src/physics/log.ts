import { UNTOUCHED, type Ball } from './ball';

/** One pocketed ball, as the turn log remembers it. */
export interface Pot {
  /** Ball number (0 is the cue ball). */
  ball: number;
  /** Pocket vertex id. */
  pocket: number;
  /** Sim time of the drop. */
  t: number;
  /** Collision generation of the ball when it dropped (1 = hit straight by the cue ball). */
  gen: number;
  /** Cushions the ball touched before dropping. */
  banks: number;
  /** Boosters, bumpers and portals it went through. */
  via: number;
}

/**
 * What happened during one shot, for goals, scoring, streaks and the preview. Built by the world
 * as it steps; the game reads it once the shot is over.
 */
export interface TurnLog {
  /** Number of the first ball the cue ball touched, or null if it touched none. */
  firstContact: number | null;
  /** Cushions the cue ball hit before touching a ball. */
  cushionsBeforeContact: number;
  pots: Pot[];
  scratch: { pocket: number } | null;
  cracked: number[];
  broken: number[];
  exploded: number[];
  /** Where the cue ball came to rest (null if it did not survive the shot). */
  cueRest: { x: number; y: number } | null;
  /** Deepest collision generation reached. */
  maxGen: number;
  timedOut: boolean;
}

export function newLog(): TurnLog {
  return {
    firstContact: null,
    cushionsBeforeContact: 0,
    pots: [],
    scratch: null,
    cracked: [],
    broken: [],
    exploded: [],
    cueRest: null,
    maxGen: 0,
    timedOut: false,
  };
}

/** A real contact between two balls: first-contact and collision-generation bookkeeping. */
export function logBallHit(log: TurnLog, a: Ball, b: Ball): void {
  if (log.firstContact === null) {
    if (a.kind === 'cue' && b.kind === 'object') log.firstContact = b.num;
    else if (b.kind === 'cue' && a.kind === 'object') log.firstContact = a.num;
  }
  if (a.gen !== UNTOUCHED && a.gen + 1 < b.gen) b.gen = a.gen + 1;
  if (b.gen !== UNTOUCHED && b.gen + 1 < a.gen) a.gen = b.gen + 1;
  const g = Math.max(a.gen === UNTOUCHED ? 0 : a.gen, b.gen === UNTOUCHED ? 0 : b.gen);
  if (g > log.maxGen) log.maxGen = g;
}

/** A real cushion hit. */
export function logCushion(log: TurnLog, b: Ball): void {
  b.banks++;
  if (b.kind === 'cue' && log.firstContact === null) log.cushionsBeforeContact++;
}

export function logPot(log: TurnLog, b: Ball, pocketVid: number, t: number): void {
  log.pots.push({ ball: b.num, pocket: pocketVid, t, gen: b.gen, banks: b.banks, via: b.via });
  if (b.kind === 'cue') log.scratch = { pocket: pocketVid };
}

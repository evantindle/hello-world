import { H } from '../config';
import { subSeed } from '../core/rng';
import { buildGeom, cloneTable } from '../geom/table';
import { launchFrom, type ShotQ } from '../physics/launch';
import type { TurnLog } from '../physics/log';
import { createWorld, stepWorld, type PhysEvent } from '../physics/world';
import { hashBoard, type GameState } from './serialize';

/**
 * One stroke, recorded: the board before it, the exact shot, what happened, and a fingerprint of
 * where everything came to rest. Replays, shared links, level solutions and multiplayer turns are
 * all built from these.
 */
export interface TurnRecord {
  /** 1-based stroke number (the value of `shots` during the shot). */
  stroke: number;
  /** The aim angle as shown (radians); the shot itself is in `shot`. */
  aim: number;
  shot: ShotQ;
  pre: GameState;
  log: TurnLog;
  /** hashBoard() of the table and balls when the shot came to rest. */
  postHash: number;
}

export function cloneLog(log: TurnLog): TurnLog {
  return {
    ...log,
    pots: log.pots.map((p) => ({ ...p })),
    scratch: log.scratch ? { ...log.scratch } : null,
    cracked: [...log.cracked],
    broken: [...log.broken],
    exploded: [...log.exploded],
    glassHp: { ...log.glassHp },
    cueRest: log.cueRest ? { ...log.cueRest } : null,
  };
}

/**
 * Re-runs a recorded shot from its starting state, headless. The result must match the recording
 * exactly (postHash) on any machine: that is what makes replays and shared links trustworthy.
 */
export function simulateShot(pre: GameState, shot: ShotQ, maxSteps = 6000) {
  const table = cloneTable(pre.table);
  const geom = buildGeom(table, pre.hunger);
  const balls = pre.balls.map((b) => ({ ...b }));
  const world = createWorld(balls, geom, subSeed(pre.seed, 'world', pre.shots));
  const cue = balls.find((b) => b.kind === 'cue')!;
  launchFrom(cue, shot);
  const events: PhysEvent[] = [];
  for (let i = 0; i < maxSteps && !world.stopped; i++) stepWorld(world, H, events);
  return { table, balls, world, events, hash: hashBoard(table, balls) };
}

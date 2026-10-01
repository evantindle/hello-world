import { H } from '../config';
import { buildGeom, cloneTable } from '../geom/table';
import type { ShotQ } from '../physics/launch';
import type { TurnLog } from '../physics/log';
import { stepWorld, type PhysEvent } from '../physics/world';
import { startShot } from './preview';
import { hashBoard, type GameState } from './serialize';

/**
 * One edit in the plan phase, as replayable data. Pointer positions are quantized to 1/64 of a
 * unit as they happen, so replaying the same edits through the game reproduces the table exactly.
 */
export type Edit =
  /** Dragged knob `vid` (or a new bend inserted on edge `edge`): the grab point, then each target. */
  | { op: 'grab'; vid: number; edge?: number; path: number[] }
  | { op: 'unbend'; vid: number }
  /** Put tray item `item` down at (x, y). */
  | { op: 'place'; item: number; x: number; y: number }
  /** Dragged toy `id` (grab point, then targets), and maybe dropped it back in the tray. */
  | { op: 'move'; id: number; path: number[]; stow?: boolean }
  /** Turned toy `id` toward each direction index in turn. */
  | { op: 'turn'; id: number; ks: number[] }
  | { op: 'undo' }
  | { op: 'redo' }
  | { op: 'reset' };

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
  /** The edits made before the shot (`pre` is the board after them). */
  edits: Edit[];
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
  const { world } = startShot(balls, geom, pre.seed, pre.shots, shot);
  const events: PhysEvent[] = [];
  for (let i = 0; i < maxSteps && !world.stopped; i++) stepWorld(world, H, events);
  return { table, balls, world, events, hash: hashBoard(table, balls) };
}

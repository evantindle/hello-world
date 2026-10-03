import type { Part } from '../../geom/parts';
import type { TableVertex } from '../../geom/table';
import type { BallVariant } from '../../physics/ball';
import type { TrayItem } from '../placement';
import type { Goal, StarCond } from '../ruleset';

/** A Classic level: a fixed table, fixed shots, a goal, and a few grabs to solve it with. */
export interface LevelDef {
  /** Stable id, e.g. 'rr-01' (progress and recorded solutions are keyed by it). */
  id: string;
  /** 1-based position in the world. */
  n: number;
  name: string;
  /** A line or two for the intro card. */
  blurb: string;
  /** The mechanic it introduces, for the intro card ('BENDING', 'BUMPERS'...). */
  teaches: string;
  /** Corners in order (positive area), with their pockets, bolts, rail materials and traits. Ids
   * are given by position. */
  shape: Omit<TableVertex, 'id'>[];
  /** Ball 0 is the cue ball. */
  balls: { num: number; x: number; y: number; variant?: BallVariant }[];
  parts?: Part[];
  tray?: TrayItem[];
  /** The cue's angle for each stroke in turn, in degrees (0 = right, 90 = down the screen). */
  angles: number[];
  /** Strokes allowed (scratches count too). */
  shots: number;
  /** Grab tokens, and how far one grab may reach. */
  tokens: number;
  reach: number;
  english: boolean;
  hunger?: boolean;
  goal: Goal;
  stars: { three: StarCond; two: StarCond };
  hint?: string;
  /** Seeds the world's random stream (black holes) and cue respawns. Defaults to one per level. */
  seed?: number;
}

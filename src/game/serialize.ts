import { buildGeom, cloneTable, type Table, type TableGeom } from '../geom/table';
import type { Ball } from '../physics/world';
import type { TrayItem } from './placement';
import type { Mode } from './ruleset';

/**
 * Everything durable about a game between strokes: enough to restore it exactly, replay a shot
 * from it, or send it to another player. Plain data (JSON-safe; Infinity is stored as null).
 */
export interface GameState {
  v: 2;
  mode: Mode;
  levelId: string | null;
  seed: number;
  table: Table;
  balls: Ball[];
  shots: number;
  penalties: number;
  hunger: number;
  /** Stretch budget left, or null when unlimited. */
  budget: number | null;
  /** Grab tokens left, or null when unlimited. */
  tokens: number | null;
  /** Toys still waiting in the tray. */
  tray: TrayItem[];
  streak: number;
  bestStreak: number;
}

/** What serialize needs from a game (the Game class satisfies it). */
export interface StateHost {
  rules: { mode: Mode };
  levelId: string | null;
  seed: number;
  table: Table;
  geom: TableGeom;
  balls: Ball[];
  shots: number;
  penalties: number;
  hunger: number;
  budget: number;
  tokens: number;
  tray: TrayItem[];
  streak: number;
  bestStreak: number;
}

const finiteOrNull = (n: number): number | null => (Number.isFinite(n) ? n : null);

export function snapState(g: StateHost): GameState {
  return {
    v: 2,
    mode: g.rules.mode,
    levelId: g.levelId,
    seed: g.seed,
    table: cloneTable(g.table),
    balls: g.balls.map((b) => ({ ...b })),
    shots: g.shots,
    penalties: g.penalties,
    hunger: g.hunger,
    budget: finiteOrNull(g.budget),
    tokens: finiteOrNull(g.tokens),
    tray: structuredClone(g.tray),
    streak: g.streak,
    bestStreak: g.bestStreak,
  };
}

/**
 * Restores a snapshot. Balls are updated in place when the set matches (other systems hold on to
 * the ball objects), otherwise replaced.
 */
export function restoreState(g: StateHost, s: GameState): void {
  g.levelId = s.levelId;
  g.seed = s.seed;
  g.table = cloneTable(s.table);
  g.hunger = s.hunger;
  g.geom = buildGeom(g.table, g.hunger);
  const same = g.balls.length === s.balls.length && g.balls.every((b, i) => b.id === s.balls[i]!.id);
  if (same) g.balls.forEach((b, i) => Object.assign(b, s.balls[i]!));
  else g.balls = s.balls.map((b) => ({ ...b }));
  g.shots = s.shots;
  g.penalties = s.penalties;
  g.budget = s.budget ?? Infinity;
  g.tokens = s.tokens ?? Infinity;
  g.tray = structuredClone(s.tray ?? []);
  g.streak = s.streak;
  g.bestStreak = s.bestStreak;
}

/** FNV-1a over raw float64 bytes: equal only if every position agrees to the last bit. */
export class StateHash {
  private h = 0x811c9dc5;
  private readonly view = new DataView(new ArrayBuffer(8));

  str(s: string): this {
    for (let i = 0; i < s.length; i++) {
      this.h ^= s.charCodeAt(i);
      this.h = Math.imul(this.h, 16777619);
    }
    return this;
  }

  num(x: number): this {
    this.view.setFloat64(0, x);
    for (let i = 0; i < 8; i++) {
      this.h ^= this.view.getUint8(i);
      this.h = Math.imul(this.h, 16777619);
    }
    return this;
  }

  get value(): number {
    return this.h >>> 0;
  }
}

/** Fingerprint of where everything is: the table (with its traits and toys) and every ball. */
export function hashBoard(table: Table, balls: readonly Ball[]): number {
  const h = new StateHash();
  for (const v of table.verts) {
    h.num(v.id).num(v.x).num(v.y).num(v.pocket ? 1 : 0).num(v.bolted ? 1 : 0).str(v.mat ?? '');
    if (v.trait) h.str(JSON.stringify(v.trait));
  }
  for (const part of table.parts) h.str(JSON.stringify(part));
  for (const b of balls) h.num(b.id).num(b.x).num(b.y).num(b.active ? 1 : 0).num(b.hp).num(b.fuse);
  return h.value;
}

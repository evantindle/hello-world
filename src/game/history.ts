import type { Table } from '../geom/table';

/** Everything an edit can change during the plan phase, as a full snapshot. */
export interface EditSnap {
  table: Table;
  /** Every ball's position (edits only ever shove balls). */
  balls: { x: number; y: number }[];
  budget: number;
  tokens: number;
  /** How many of each tray item are left. */
  tray: number[];
  /** Toys placed from the tray this turn (they may still be moved for free). */
  fresh: number[];
}

/** Undo steps kept per turn. */
export const HISTORY_CAP = 64;

/**
 * Undo / redo for one plan phase, as whole snapshots (simple, and immune to the order edits
 * interact in). `start` is the turn's starting point: RESET goes back to it, and the ghost
 * outline shows it.
 */
export class History {
  private past: EditSnap[] = [];
  private future: EditSnap[] = [];
  start: EditSnap | null = null;

  /** A new turn: forget everything, remember where it starts. */
  begin(start: EditSnap): void {
    this.start = start;
    this.past = [];
    this.future = [];
  }

  /** An edit was made; `before` is the state just before it. A new edit forgets the redo stack. */
  commit(before: EditSnap): void {
    this.past.push(before);
    if (this.past.length > HISTORY_CAP) this.past.shift();
    this.future = [];
  }

  /** Step back: returns the state to restore (and keeps `current` for redo), or null. */
  undo(current: EditSnap): EditSnap | null {
    const s = this.past.pop();
    if (!s) return null;
    this.future.push(current);
    return s;
  }

  redo(current: EditSnap): EditSnap | null {
    const s = this.future.pop();
    if (!s) return null;
    this.past.push(current);
    return s;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.start = null;
    this.past = [];
    this.future = [];
  }
}

/**
 * What the player has done, kept in localStorage: stars and best strokes per Classic level.
 * Storage may be blocked (private windows, sandboxed frames): then progress just lives for the
 * session.
 */
export interface LevelRecord {
  stars: number;
  /** Fewest strokes in a win. */
  best: number;
}

export interface Progress {
  levels: Record<string, LevelRecord>;
}

const KEY = 'bendy-billiards.v2';

let memory: Progress = { levels: {} };

export function loadProgress(): Progress {
  try {
    if (typeof localStorage === 'undefined') return memory;
    const raw = localStorage.getItem(KEY);
    if (!raw) return memory;
    const p = JSON.parse(raw) as Partial<Progress>;
    memory = { levels: typeof p.levels === 'object' && p.levels ? p.levels : {} };
  } catch {
    // Unreadable or blocked: keep what this session knows.
  }
  return memory;
}

export function saveProgress(p: Progress): void {
  memory = p;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: progress lasts for this session only.
  }
}

/** Records a win; keeps the best stars and the fewest strokes. Returns the updated record. */
export function recordWin(id: string, stars: number, strokes: number): LevelRecord {
  const p = loadProgress();
  const old = p.levels[id];
  const rec = { stars: Math.max(stars, old?.stars ?? 0), best: Math.min(strokes, old?.best ?? Infinity) };
  saveProgress({ levels: { ...p.levels, [id]: rec } });
  return rec;
}

/** For tests: forget everything. */
export function resetProgress(): void {
  memory = { levels: {} };
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

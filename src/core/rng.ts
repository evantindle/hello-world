export interface Rng {
  readonly seed: number;
  /** Uniform in [0, 1). */
  next(): number;
  range(lo: number, hi: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  shuffle<T>(items: T[]): T[];
}

/** mulberry32: tiny, fast, good enough for games, and deterministic under a seed. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    seed: seed >>> 0,
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (n) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p) => next() < p,
    shuffle: <T>(items: T[]): T[] => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = items[i]!;
        items[i] = items[j]!;
        items[j] = tmp;
      }
      return items;
    },
  };
  return rng;
}

/**
 * Seed for an independent stream named `salt` (plus any integers, such as the stroke number), so
 * drawing from one stream (respawn spots, say) never shifts another (the spins). FNV-1a over the
 * salt, each integer folded in, then the murmur3 finaliser. Integer math only: reproducible anywhere.
 */
export function subSeed(seed: number, salt: string, ...ints: number[]): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (const n of ints.length ? ints : [0]) {
    h ^= Math.imul((n | 0) + 1, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * A fresh generator for one purpose: `rngFor(seed, 'spin', stroke)`. Stateless by design: nothing
 * about the game's randomness has to be saved, replayed or kept in step.
 */
export function rngFor(seed: number, salt: string, ...ints: number[]): Rng {
  return createRng(subSeed(seed, salt, ...ints));
}

export function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

export interface Vec {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export const vec = (x = 0, y = 0): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;

/**
 * Length of (x, y). Uses sqrt, which every engine rounds identically, rather than Math.hypot,
 * whose last bit may differ between browsers: simulation code must be bit-reproducible so that
 * replays, shared links and solutions play out the same everywhere.
 */
export const hyp = (x: number, y: number): number => Math.sqrt(x * x + y * y);

export const len = (a: Vec): number => hyp(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => hyp(a.x - b.x, a.y - b.y);
export const copy = (a: Vec): Vec => ({ x: a.x, y: a.y });

export const norm = (a: Vec): Vec => {
  const l = hyp(a.x, a.y);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

/** Left perpendicular: the inward normal of an edge of a positive-area polygon. */
export const leftPerp = (a: Vec): Vec => ({ x: -a.y, y: a.x });

export const fromAngle = (angle: number, length = 1): Vec => ({
  x: Math.cos(angle) * length,
  y: Math.sin(angle) * length,
});

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerpVec = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Wrap an angle into [0, TAU), leaving angles already in range exactly as they are. */
export const wrapTau = (a: number): number => {
  if (a >= 0 && a < TAU) return a;
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
};

/** Wrap an angle into (-PI, PI]. */
export const wrapAngle = (a: number): number => {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
};

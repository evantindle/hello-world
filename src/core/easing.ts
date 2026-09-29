export type Ease = (t: number) => number;

export const linear: Ease = (t) => t;
export const quadIn: Ease = (t) => t * t;
export const quadOut: Ease = (t) => t * (2 - t);
export const cubicIn: Ease = (t) => t * t * t;
export const cubicOut: Ease = (t) => 1 - (1 - t) ** 3;
export const quartOut: Ease = (t) => 1 - (1 - t) ** 4;
export const cubicInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const sineInOut: Ease = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

export const backOut: Ease = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
};

export const elasticOut: Ease = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
};

export const expoOut: Ease = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

export const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach of a toward b. */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  b + (a - b) * Math.exp(-lambda * dt);

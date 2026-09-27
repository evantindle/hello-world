import type { RGB } from './math.ts';

/** sRGB (0..1) component to linear. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Parse '#rrggbb' into linear RGB. */
export function hex(h: string): RGB {
  const s = h.replace('#', '');
  const n = parseInt(s, 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

/** HSV (h in turns) to linear RGB. */
export function hsv(h: number, s: number, v: number): RGB {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const out: RGB = [
    [v, q, p, p, t, v][i % 6],
    [t, v, v, q, p, p][i % 6],
    [p, p, t, v, v, q][i % 6],
  ];
  return [srgbToLinear(out[0]), srgbToLinear(out[1]), srgbToLinear(out[2])];
}

/**
 * Blackbody chromaticity (Kim et al. Planckian locus fit) converted to linear sRGB,
 * normalised so the brightest channel is 1.
 */
export function blackbody(kelvin: number): RGB {
  const T = Math.min(25000, Math.max(1667, kelvin));
  const t1 = 1e3 / T, t2 = t1 * t1, t3 = t2 * t1;
  const x =
    T <= 4000
      ? -0.2661239 * t3 - 0.234358 * t2 + 0.8776956 * t1 + 0.17991
      : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t1 + 0.24039;
  const x2 = x * x, x3 = x2 * x;
  const y =
    T <= 2222
      ? -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683
      : T <= 4000
        ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483;
  const X = x / y, Y = 1, Z = (1 - x - y) / y;
  let r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  let g = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  let b = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  r = Math.max(r, 0); g = Math.max(g, 0); b = Math.max(b, 0);
  const m = Math.max(r, g, b);
  return [r / m, g / m, b / m];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function mulc(a: RGB, s: number): RGB {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** A few hand-tuned neon-ish palettes for bodies (linear RGB). */
export const PALETTE = {
  cyan: hex('#3fd7ff'),
  azure: hex('#4f8dff'),
  magenta: hex('#ff3fa8'),
  rose: hex('#ff5c7a'),
  gold: hex('#ffb13b'),
  amber: hex('#ff8a2a'),
  lime: hex('#9dff5c'),
  violet: hex('#a66bff'),
  white: hex('#fff4e8'),
  ice: hex('#bfe6ff'),
  ember: hex('#ff5a1f'),
};

// Exact Schwarzschild light deflection, tabulated for the per-pixel sky lensing pass.

/** Critical impact parameter b_c / r_s = 3√3/2 (edge of the black-hole shadow). */
export const B_CRIT = 1.5 * Math.sqrt(3);

export const LUT_SIZE = 512;
export const LUT_QMIN = 1e-7;
export const LUT_QMAX = 10;

/**
 * Deflection angle (radians) of a light ray with impact parameter b (units of r_s), b > b_c.
 * α = 2∫₀^{u0} du / sqrt(1/b² − u² + u³) − π, with u = r_s / r.
 * Using u = u0(1 − t²) and G(u0) = 0 the integrand factorises without cancellation:
 * α = 4 sqrt(u0) ∫₀¹ dt / sqrt(H(u)) − π,  H(u) = u0 + u − u0² − u0 u − u².
 */
export function deflection(b: number): number {
  if (b <= B_CRIT) return Infinity;
  const ib2 = 1 / (b * b);
  let lo = 0, hi = 2 / 3;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    const F = ib2 - mid * mid + mid * mid * mid;
    if (F > 0) lo = mid;
    else hi = mid;
  }
  const u0 = 0.5 * (lo + hi);
  let sum = 0;
  // Log-spaced panels resolve the sharp peak at t → 0 for near-critical rays.
  let a = 0;
  for (let k = -14; k <= 0; k += 0.25) {
    const c = Math.pow(10, k);
    const N = 48;
    const dt = (c - a) / N;
    for (let i = 0; i < N; i++) {
      const t = a + (i + 0.5) * dt;
      const u = u0 * (1 - t * t);
      const H = u0 + u - u0 * u0 - u0 * u - u * u;
      if (H > 0) sum += dt / Math.sqrt(H);
    }
    a = c;
  }
  return 4 * Math.sqrt(u0) * sum - Math.PI;
}

/** Deflection table sampled uniformly in ln(q), q = b/b_c − 1. */
export function buildDeflectionLUT(): Float32Array {
  const out = new Float32Array(LUT_SIZE);
  const l0 = Math.log(LUT_QMIN), l1 = Math.log(LUT_QMAX);
  for (let i = 0; i < LUT_SIZE; i++) {
    const q = Math.exp(l0 + ((l1 - l0) * i) / (LUT_SIZE - 1));
    out[i] = deflection(B_CRIT * (1 + q));
  }
  return out;
}

/** Weak-field series (valid for b ≫ r_s), used beyond the table. */
export function weakDeflection(b: number): number {
  const ib = 1 / b;
  return 2 * ib + ((15 * Math.PI) / 16) * ib * ib + (16 / 3) * ib * ib * ib;
}

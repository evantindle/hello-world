// Adaptive Dormand–Prince 5(4) integrator with FSAL and step-size memory.
// State vectors are Float64Array; JS numbers are doubles, which the chaotic
// three-body problems (e.g. Burrau's Pythagorean problem) genuinely need.

export type DerivFn = (t: number, y: Float64Array, out: Float64Array) => void;

const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const A71 = 35 / 384, A73 = 500 / 1113, A74 = 125 / 192, A75 = -2187 / 6784, A76 = 11 / 84;
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;
const C2 = 1 / 5, C3 = 3 / 10, C4 = 4 / 5, C5 = 8 / 9;

export interface DoPri5Options {
  rtol?: number;
  atol?: number;
  hmax?: number;
  hmin?: number;
  h0?: number;
}

export class DoPri5 {
  n: number;
  f: DerivFn;
  rtol: number;
  atol: number;
  hmax: number;
  hmin: number;
  /** Suggested next step size. */
  h: number;
  steps = 0;
  rejects = 0;

  private k1!: Float64Array;
  private k2!: Float64Array;
  private k3!: Float64Array;
  private k4!: Float64Array;
  private k5!: Float64Array;
  private k6!: Float64Array;
  private k7!: Float64Array;
  private yt!: Float64Array;
  private yn!: Float64Array;
  private fsalValid = false;

  constructor(n: number, f: DerivFn, opts: DoPri5Options = {}) {
    this.n = n;
    this.f = f;
    this.rtol = opts.rtol ?? 1e-10;
    this.atol = opts.atol ?? 1e-12;
    this.hmax = opts.hmax ?? Infinity;
    this.hmin = opts.hmin ?? 1e-14;
    this.h = opts.h0 ?? 1e-3;
    this.alloc(n);
  }

  private alloc(n: number) {
    this.k1 = new Float64Array(n);
    this.k2 = new Float64Array(n);
    this.k3 = new Float64Array(n);
    this.k4 = new Float64Array(n);
    this.k5 = new Float64Array(n);
    this.k6 = new Float64Array(n);
    this.k7 = new Float64Array(n);
    this.yt = new Float64Array(n);
    this.yn = new Float64Array(n);
  }

  /** Call when the state changed discontinuously (merge, velocity kick, resize). */
  reset(n = this.n) {
    if (n !== this.n) {
      this.n = n;
      this.alloc(n);
    }
    this.fsalValid = false;
  }

  /** Last evaluated derivative at the current state (valid after a step). */
  get derivative(): Float64Array {
    return this.k1;
  }

  /**
   * Take one accepted step of at most `hLimit` from (t, y). `y` is updated in place.
   * Returns the step size actually taken.
   */
  step(t: number, y: Float64Array, hLimit: number): number {
    const n = this.n;
    const { f, yt, yn } = this;
    let { k1, k2, k3, k4, k5, k6, k7 } = this;
    if (!this.fsalValid) {
      f(t, y, k1);
      this.fsalValid = true;
    }
    const limited = this.h >= hLimit;
    let h = Math.min(this.h, hLimit, this.hmax);
    for (;;) {
      for (let i = 0; i < n; i++) yt[i] = y[i] + h * A21 * k1[i];
      f(t + C2 * h, yt, k2);
      for (let i = 0; i < n; i++) yt[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
      f(t + C3 * h, yt, k3);
      for (let i = 0; i < n; i++) yt[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
      f(t + C4 * h, yt, k4);
      for (let i = 0; i < n; i++) yt[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
      f(t + C5 * h, yt, k5);
      for (let i = 0; i < n; i++)
        yt[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
      f(t + h, yt, k6);
      for (let i = 0; i < n; i++)
        yn[i] = y[i] + h * (A71 * k1[i] + A73 * k3[i] + A74 * k4[i] + A75 * k5[i] + A76 * k6[i]);
      f(t + h, yn, k7);

      let err = 0;
      for (let i = 0; i < n; i++) {
        const e = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
        const sc = this.atol + this.rtol * Math.max(Math.abs(y[i]), Math.abs(yn[i]));
        const r = e / sc;
        err += r * r;
      }
      err = Math.sqrt(err / n);

      if (err <= 1 || h <= this.hmin || !Number.isFinite(err)) {
        y.set(yn);
        // FSAL: k7 of this step is k1 of the next.
        this.k1 = k7;
        this.k7 = k1;
        this.steps++;
        const fac = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(err, -0.2)));
        const hNext = Math.min(h * fac, this.hmax);
        // A step truncated to hit a frame boundary should not shrink the natural step size.
        this.h = limited && h >= hLimit ? Math.max(this.h, hNext) : hNext;
        return h;
      }
      this.rejects++;
      h *= Math.max(0.1, 0.9 * Math.pow(err, -0.25));
      k1 = this.k1; k2 = this.k2; k3 = this.k3; k4 = this.k4; k5 = this.k5; k6 = this.k6; k7 = this.k7;
    }
  }
}

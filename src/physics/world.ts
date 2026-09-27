// Gravitational N-body world for the *massive* bodies: stars, black holes, galaxy cores.
// Massless tracer particles live on the GPU (see render/particles.ts) and feel these bodies.

import type { RGB, V3 } from '../core/math.ts';
import { DoPri5 } from './dopri5.ts';

export type BodyKind = 'star' | 'blackhole' | 'planet' | 'core';

export interface TrailStyle {
  /** Sim-time e-folding fade of the trail. */
  fade: number;
  /** Hard cap on trail age (sim time). */
  maxAge: number;
  /** Ribbon width in world units (clamped to a minimum pixel width when rendering). */
  width: number;
  /** Colour override (defaults to body colour). */
  color?: RGB;
  /** Brightness multiplier. */
  intensity: number;
  /** Extra white-hot core along the ribbon centre. */
  core: number;
}

export interface EmitterStyle {
  /** Particles kept alive by the emitter (steady state). */
  count: number;
  /** Particle lifetime in sim time. */
  life: number;
  /** Ejection speed relative to the body. */
  speed: number;
  /** World-space particle size. */
  size: number;
  intensity: number;
  color?: RGB;
}

export interface BodyInit {
  name?: string;
  kind?: BodyKind;
  m: number;
  x: V3;
  v: V3;
  /** Visual radius in world units. */
  radius?: number;
  /** Collision radius (0 disables collisions for this body). */
  collide?: number;
  /** Plummer softening length. */
  soft?: number;
  color?: RGB;
  intensity?: number;
  trail?: Partial<TrailStyle> | false;
  emit?: Partial<EmitterStyle> | false;
  /** Include in automatic camera framing. */
  track?: boolean;
  /** Eligible for ejection detection. */
  canEject?: boolean;
  label?: string;
  /** Diffraction-spike strength for stars. */
  spikes?: number;
  /** Photon-ring glow strength for black holes. */
  ring?: number;
  /** Arbitrary scene data. */
  tag?: string;
}

export interface Body {
  id: number;
  name: string;
  kind: BodyKind;
  m: number;
  x: V3;
  v: V3;
  radius: number;
  collide: number;
  soft: number;
  color: RGB;
  intensity: number;
  trail: TrailStyle | null;
  emit: EmitterStyle | null;
  track: boolean;
  canEject: boolean;
  label: string;
  spikes: number;
  ring: number;
  tag: string;
  alive: boolean;
  escaping: boolean;
  mergedInto: Body | null;
  /** Schwarzschild radius (black holes only, from world.c). */
  rs: number;
  /** Sim time the body came into existence. */
  born: number;
}

export type WorldEvent =
  | { type: 'merge'; t: number; a: Body; b: Body; result: Body; pos: V3; vel: V3; relSpeed: number }
  | { type: 'eject'; t: number; body: Body; speed: number }
  | { type: 'periapsis'; t: number; a: Body; b: Body; r: number; relSpeed: number };

export interface MergeOverride {
  /** Customise the merged body; return partial overrides. */
  (a: Body, b: Body, init: BodyInit): BodyInit;
}

export interface WorldOptions {
  G?: number;
  /** Speed of light in sim units (sets black-hole horizon size and GW damping). */
  c?: number;
  /** Multiplier on gravitational-radiation reaction between black holes (0 = off). */
  gw?: number;
  /** BH–BH merger mass-energy radiated away. */
  gwMassLoss?: number;
  /** Dynamical-friction proxy between 'core' bodies. */
  friction?: { coef: number; radius: number } | null;
  rtol?: number;
  atol?: number;
  hmax?: number;
  /** Ejection when the body is unbound and farther than this many "system radii". */
  ejectFactor?: number;
  /** Periapsis events are raised for passes closer than this fraction of the system radius. */
  closeFactor?: number;
  /** Merges happen when bodies touch (collide radii). */
  collisions?: boolean;
  /** Safety valve: maximum integrator steps per advance() call. */
  maxStepsPerAdvance?: number;
}

const DEFAULT_TRAIL: TrailStyle = { fade: 6, maxAge: 30, width: 0.012, intensity: 1, core: 0.6 };
const DEFAULT_EMIT: EmitterStyle = { count: 4000, life: 3, speed: 0.12, size: 0.006, intensity: 1 };

export class World {
  G: number;
  c: number;
  gw: number;
  gwMassLoss: number;
  friction: { coef: number; radius: number } | null;
  ejectFactor: number;
  closeFactor: number;
  collisions: boolean;
  maxStepsPerAdvance: number;

  t = 0;
  bodies: Body[] = [];
  /** Every body ever created, including merged-away ones (renderer keeps fading their trails). */
  history: Body[] = [];
  events: WorldEvent[] = [];
  onStep: ((w: World, h: number) => void) | null = null;
  onMerge: MergeOverride | null = null;
  /** Called after a merge so scenes can apply kicks etc. */
  afterMerge: ((result: Body, a: Body, b: Body) => void) | null = null;

  private nextId = 1;
  private y = new Float64Array(0);
  private mass = new Float64Array(0);
  private soft2 = new Float64Array(0);
  private isBH = new Uint8Array(0);
  private isCore = new Uint8Array(0);
  private integ: DoPri5;
  private pairR: Float64Array = new Float64Array(0);
  private pairDr: Float64Array = new Float64Array(0);
  private dirty = true;

  constructor(opts: WorldOptions = {}) {
    this.G = opts.G ?? 1;
    this.c = opts.c ?? Infinity;
    this.gw = opts.gw ?? 0;
    this.gwMassLoss = opts.gwMassLoss ?? 0.05;
    this.friction = opts.friction ?? null;
    this.ejectFactor = opts.ejectFactor ?? 4;
    this.closeFactor = opts.closeFactor ?? 0.2;
    this.collisions = opts.collisions ?? true;
    this.maxStepsPerAdvance = opts.maxStepsPerAdvance ?? 250000;
    this.integ = new DoPri5(0, this.deriv, {
      rtol: opts.rtol ?? 1e-11,
      atol: opts.atol ?? 1e-13,
      hmax: opts.hmax ?? Infinity,
      h0: 1e-4,
    });
  }

  schwarzschild(m: number): number {
    return Number.isFinite(this.c) ? (2 * this.G * m) / (this.c * this.c) : 0;
  }

  add(init: BodyInit): Body {
    const kind = init.kind ?? 'star';
    const rs = kind === 'blackhole' ? this.schwarzschild(init.m) : 0;
    const trail =
      init.trail === false ? null : { ...DEFAULT_TRAIL, ...(init.trail ?? {}) };
    const emit = init.emit ? { ...DEFAULT_EMIT, ...init.emit } : null;
    const b: Body = {
      id: this.nextId++,
      name: init.name ?? `body${this.nextId}`,
      kind,
      m: init.m,
      x: [init.x[0], init.x[1], init.x[2]],
      v: [init.v[0], init.v[1], init.v[2]],
      radius: init.radius ?? (kind === 'blackhole' ? rs : 0.05),
      collide: init.collide ?? (kind === 'blackhole' ? rs * 1.0 : 0),
      soft: init.soft ?? 0,
      color: init.color ?? [1, 0.9, 0.8],
      intensity: init.intensity ?? 1,
      trail,
      emit,
      track: init.track ?? true,
      canEject: init.canEject ?? true,
      label: init.label ?? '',
      spikes: init.spikes ?? 0,
      ring: init.ring ?? 1,
      tag: init.tag ?? '',
      alive: true,
      escaping: false,
      mergedInto: null,
      rs,
      born: this.t,
    };
    this.bodies.push(b);
    this.history.push(b);
    this.dirty = true;
    return b;
  }

  /** Remove a body from the dynamics (e.g. star fully disrupted). */
  remove(b: Body) {
    const i = this.bodies.indexOf(b);
    if (i < 0) return;
    this.pull();
    b.alive = false;
    this.bodies.splice(i, 1);
    this.dirty = true;
  }

  /** Apply an instantaneous velocity change. */
  kick(b: Body, dv: V3) {
    this.pull();
    b.v[0] += dv[0];
    b.v[1] += dv[1];
    b.v[2] += dv[2];
    this.dirty = true;
  }

  /** Shift positions/velocities so the barycentre is at rest at the origin. */
  centerOfMassFrame() {
    this.pull();
    let M = 0;
    const x = [0, 0, 0], v = [0, 0, 0];
    for (const b of this.bodies) {
      M += b.m;
      for (let k = 0; k < 3; k++) {
        x[k] += b.m * b.x[k];
        v[k] += b.m * b.v[k];
      }
    }
    for (const b of this.bodies)
      for (let k = 0; k < 3; k++) {
        b.x[k] -= x[k] / M;
        b.v[k] -= v[k] / M;
      }
    this.dirty = true;
  }

  // ---- internal state packing ----

  /** Push body structs into the flat integrator state. */
  private rebuild() {
    const n = this.bodies.length;
    if (this.y.length !== 6 * n) {
      this.y = new Float64Array(6 * n);
      this.mass = new Float64Array(n);
      this.soft2 = new Float64Array(n);
      this.isBH = new Uint8Array(n);
      this.isCore = new Uint8Array(n);
      this.pairR = new Float64Array(n * n);
      this.pairDr = new Float64Array(n * n);
    }
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      const o = 6 * i;
      this.y[o] = b.x[0]; this.y[o + 1] = b.x[1]; this.y[o + 2] = b.x[2];
      this.y[o + 3] = b.v[0]; this.y[o + 4] = b.v[1]; this.y[o + 5] = b.v[2];
      this.mass[i] = b.m;
      this.soft2[i] = b.soft * b.soft;
      this.isBH[i] = b.kind === 'blackhole' ? 1 : 0;
      this.isCore[i] = b.kind === 'core' ? 1 : 0;
    }
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const bi = this.bodies[i], bj = this.bodies[j];
        this.pairR[i * n + j] = Math.hypot(bi.x[0] - bj.x[0], bi.x[1] - bj.x[1], bi.x[2] - bj.x[2]);
        this.pairDr[i * n + j] = 0;
      }
    this.integ.reset(6 * n);
    this.dirty = false;
  }

  /** Pull integrator state back into body structs. */
  private pull() {
    if (this.dirty) return;
    const y = this.y;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const o = 6 * i;
      b.x[0] = y[o]; b.x[1] = y[o + 1]; b.x[2] = y[o + 2];
      b.v[0] = y[o + 3]; b.v[1] = y[o + 4]; b.v[2] = y[o + 5];
    }
  }

  private deriv = (_t: number, y: Float64Array, dy: Float64Array) => {
    const n = this.mass.length;
    const m = this.mass, s2 = this.soft2, G = this.G;
    for (let i = 0; i < n; i++) {
      const o = 6 * i;
      dy[o] = y[o + 3];
      dy[o + 1] = y[o + 4];
      dy[o + 2] = y[o + 5];
      dy[o + 3] = 0;
      dy[o + 4] = 0;
      dy[o + 5] = 0;
    }
    const gwOn = this.gw > 0 && Number.isFinite(this.c);
    const c5 = gwOn ? Math.pow(this.c, 5) : 1;
    const fr = this.friction;
    for (let i = 0; i < n; i++) {
      const oi = 6 * i;
      const xi = y[oi], yi = y[oi + 1], zi = y[oi + 2];
      for (let j = i + 1; j < n; j++) {
        const oj = 6 * j;
        const dx = y[oj] - xi, dyy = y[oj + 1] - yi, dz = y[oj + 2] - zi;
        const r2 = dx * dx + dyy * dyy + dz * dz + 0.5 * (s2[i] + s2[j]);
        const r = Math.sqrt(r2);
        const inv3 = 1 / (r2 * r);
        const fi = G * m[j] * inv3, fj = G * m[i] * inv3;
        dy[oi + 3] += fi * dx; dy[oi + 4] += fi * dyy; dy[oi + 5] += fi * dz;
        dy[oj + 3] -= fj * dx; dy[oj + 4] -= fj * dyy; dy[oj + 5] -= fj * dz;

        // Pair dissipation: damps the relative velocity, conserving momentum.
        let gamma = 0;
        if (gwOn && this.isBH[i] && this.isBH[j]) {
          // Energy loss matched to Peters' quadrupole formula for circular orbits.
          const M = m[i] + m[j];
          const r4 = r2 * r2;
          gamma += (this.gw * 32 / 5) * (G * G * G * m[i] * m[j] * M) / (c5 * r4);
        }
        if (fr && this.isCore[i] && this.isCore[j]) {
          const q = r / fr.radius;
          gamma += fr.coef * Math.exp(-q * q);
        }
        if (gamma > 0) {
          const M = m[i] + m[j];
          const dvx = y[oi + 3] - y[oj + 3], dvy = y[oi + 4] - y[oj + 4], dvz = y[oi + 5] - y[oj + 5];
          const gi = gamma * m[j] / M, gj = gamma * m[i] / M;
          dy[oi + 3] -= gi * dvx; dy[oi + 4] -= gi * dvy; dy[oi + 5] -= gi * dvz;
          dy[oj + 3] += gj * dvx; dy[oj + 4] += gj * dvy; dy[oj + 5] += gj * dvz;
        }
      }
    }
  };

  /** Integrate forward by dt sim-time units. Events accumulate in `events`. */
  advance(dt: number) {
    if (dt <= 0) return;
    if (this.dirty) this.rebuild();
    const tEnd = this.t + dt;
    let steps = 0;
    while (this.t < tEnd) {
      const remaining = tEnd - this.t;
      if (remaining <= 1e-14 * Math.max(1, Math.abs(tEnd))) {
        this.t = tEnd;
        break;
      }
      const h = this.integ.step(this.t, this.y, remaining);
      this.t = h >= remaining ? tEnd : this.t + h;
      this.pull();
      this.detectPeriapsis();
      if (this.collisions && this.checkCollisions()) this.rebuild();
      this.onStep?.(this, h);
      if (++steps >= this.maxStepsPerAdvance) break;
    }
    this.checkEjections();
  }

  private detectPeriapsis() {
    const n = this.bodies.length;
    if (n < 2 || this.closeFactor <= 0) return;
    const R = this.systemRadius();
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = this.bodies[i], b = this.bodies[j];
        const r = Math.hypot(a.x[0] - b.x[0], a.x[1] - b.x[1], a.x[2] - b.x[2]);
        const k = i * n + j;
        const dr = r - this.pairR[k];
        if (this.pairDr[k] < 0 && dr > 0 && r < this.closeFactor * R) {
          const rv = Math.hypot(a.v[0] - b.v[0], a.v[1] - b.v[1], a.v[2] - b.v[2]);
          this.events.push({ type: 'periapsis', t: this.t, a, b, r, relSpeed: rv });
        }
        if (dr !== 0) this.pairDr[k] = dr;
        this.pairR[k] = r;
      }
  }

  /** Characteristic radius: max distance of non-escaping bodies from their barycentre. */
  systemRadius(): number {
    let M = 0;
    const c = [0, 0, 0];
    for (const b of this.bodies) {
      if (b.escaping) continue;
      M += b.m;
      c[0] += b.m * b.x[0]; c[1] += b.m * b.x[1]; c[2] += b.m * b.x[2];
    }
    if (M <= 0) return 1;
    c[0] /= M; c[1] /= M; c[2] /= M;
    let R = 0;
    for (const b of this.bodies) {
      if (b.escaping) continue;
      R = Math.max(R, Math.hypot(b.x[0] - c[0], b.x[1] - c[1], b.x[2] - c[2]));
    }
    return Math.max(R, 1e-9);
  }

  private checkCollisions(): boolean {
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      const a = this.bodies[i];
      if (a.collide <= 0) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.bodies[j];
        if (b.collide <= 0) continue;
        const r = Math.hypot(a.x[0] - b.x[0], a.x[1] - b.x[1], a.x[2] - b.x[2]);
        if (r < a.collide + b.collide) {
          this.merge(a, b);
          return true;
        }
      }
    }
    return false;
  }

  private merge(a: Body, b: Body) {
    const M = a.m + b.m;
    const x: V3 = [0, 1, 2].map((k) => (a.m * a.x[k] + b.m * b.x[k]) / M) as V3;
    const v: V3 = [0, 1, 2].map((k) => (a.m * a.v[k] + b.m * b.v[k]) / M) as V3;
    const relSpeed = Math.hypot(a.v[0] - b.v[0], a.v[1] - b.v[1], a.v[2] - b.v[2]);
    const big = a.m >= b.m ? a : b;
    const small = big === a ? b : a;
    const anyBH = a.kind === 'blackhole' || b.kind === 'blackhole';
    const bothBH = a.kind === 'blackhole' && b.kind === 'blackhole';
    const m = bothBH ? M * (1 - this.gwMassLoss) : M;
    const la = a.m * a.intensity, lb = b.m * b.intensity;
    let init: BodyInit = {
      name: `${big.name}+${small.name}`,
      kind: anyBH ? 'blackhole' : big.kind,
      m,
      x,
      v,
      radius: anyBH ? undefined : big.radius * Math.cbrt(M / big.m),
      collide: anyBH ? undefined : big.collide > 0 ? big.collide * Math.cbrt(M / big.m) : 0,
      soft: Math.max(a.soft, b.soft),
      color: anyBH
        ? big.color
        : ([0, 1, 2].map((k) => (a.color[k] * la + b.color[k] * lb) / (la + lb)) as RGB),
      intensity: anyBH ? big.intensity : Math.max(a.intensity, b.intensity) * 1.25,
      trail: big.trail ?? undefined,
      emit: big.emit ?? undefined,
      track: a.track || b.track,
      canEject: a.canEject && b.canEject,
      label: big.label,
      spikes: Math.max(a.spikes, b.spikes),
      ring: Math.max(a.ring, b.ring),
      tag: big.tag,
    };
    if (this.onMerge) init = { ...init, ...this.onMerge(a, b, init) };
    // Remove a and b, then add the result.
    a.alive = false;
    b.alive = false;
    this.bodies.splice(this.bodies.indexOf(a), 1);
    this.bodies.splice(this.bodies.indexOf(b), 1);
    const result = this.add(init);
    a.mergedInto = result;
    b.mergedInto = result;
    this.afterMerge?.(result, a, b);
    this.events.push({ type: 'merge', t: this.t, a, b, result, pos: [...x] as V3, vel: [...result.v] as V3, relSpeed });
  }

  private checkEjections() {
    const n = this.bodies.length;
    if (n < 3) return;
    for (const b of this.bodies) {
      if (!b.canEject || b.escaping) continue;
      let M = 0;
      const xc = [0, 0, 0], vc = [0, 0, 0];
      for (const o of this.bodies) {
        if (o === b || o.escaping) continue;
        M += o.m;
        for (let k = 0; k < 3; k++) {
          xc[k] += o.m * o.x[k];
          vc[k] += o.m * o.v[k];
        }
      }
      if (M <= 0) continue;
      for (let k = 0; k < 3; k++) {
        xc[k] /= M;
        vc[k] /= M;
      }
      let Rrest = 0;
      for (const o of this.bodies) {
        if (o === b || o.escaping) continue;
        Rrest = Math.max(Rrest, Math.hypot(o.x[0] - xc[0], o.x[1] - xc[1], o.x[2] - xc[2]));
      }
      const rx = b.x[0] - xc[0], ry = b.x[1] - xc[1], rz = b.x[2] - xc[2];
      const vx = b.v[0] - vc[0], vy = b.v[1] - vc[1], vz = b.v[2] - vc[2];
      const r = Math.hypot(rx, ry, rz);
      const v2 = vx * vx + vy * vy + vz * vz;
      const E = 0.5 * v2 - (this.G * (M + b.m)) / r;
      const outward = rx * vx + ry * vy + rz * vz > 0;
      if (E > 0 && outward && r > this.ejectFactor * Math.max(Rrest, 1e-6)) {
        b.escaping = true;
        this.events.push({ type: 'eject', t: this.t, body: b, speed: Math.sqrt(2 * E) });
      }
    }
  }

  /** Total energy (kinetic + potential, softened). Useful for tests. */
  energy(): number {
    if (this.dirty) this.rebuild();
    let K = 0, U = 0;
    const bs = this.bodies;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      K += 0.5 * a.m * (a.v[0] ** 2 + a.v[1] ** 2 + a.v[2] ** 2);
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        const r2 = (a.x[0] - b.x[0]) ** 2 + (a.x[1] - b.x[1]) ** 2 + (a.x[2] - b.x[2]) ** 2 + 0.5 * (a.soft ** 2 + b.soft ** 2);
        U -= (this.G * a.m * b.m) / Math.sqrt(r2);
      }
    }
    return K + U;
  }

  get integratorStats() {
    return { steps: this.integ.steps, rejects: this.integ.rejects, h: this.integ.h };
  }

  /** Barycentre of tracked, non-escaping bodies. */
  barycenter(filter: (b: Body) => boolean = () => true): { x: V3; v: V3; m: number } {
    let M = 0;
    const x: V3 = [0, 0, 0], v: V3 = [0, 0, 0];
    for (const b of this.bodies) {
      if (!filter(b)) continue;
      M += b.m;
      for (let k = 0; k < 3; k++) {
        x[k] += b.m * b.x[k];
        v[k] += b.m * b.v[k];
      }
    }
    if (M > 0) for (let k = 0; k < 3; k++) { x[k] /= M; v[k] /= M; }
    return { x, v, m: M };
  }
}

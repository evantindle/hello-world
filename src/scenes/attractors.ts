// Strange attractors: hundreds of thousands of particles flowing along the vector field of a
// chaotic system of ODEs. The GPU integrates the same equations (see flowField in particles.ts);
// this file places the particles on the attractor and frames it.

import { hex } from '../core/color.ts';
import type { RGB, V3 } from '../core/math.ts';
import { Rng } from '../core/rng.ts';
import { World } from '../physics/world.ts';
import type { FlowField, ParticleGroupSpec, ParticleInit } from '../render/particles.ts';
import type { CaptionCue, SceneDef, SceneSetup } from './types.ts';

type Params = [number, number, number, number];

interface AttractorDef {
  field: FlowField;
  params: Params;
  /** Largest RK4 step (attractor time units) that stays accurate. */
  step: number;
  /** Any point in the basin of attraction. */
  start: V3;
}

/** CPU twin of the GLSL flowField (keep the two in sync). */
function F(f: FlowField, p: V3, P: Params): V3 {
  const [x, y, z] = p;
  switch (f) {
    case 'lorenz':
      return [P[0] * (y - x), x * (P[1] - z) - y, x * y - P[2] * z];
    case 'aizawa':
      return [(z - P[1]) * x - P[3] * y, P[3] * x + (z - P[1]) * y, P[2] + P[0] * z - (z * z * z) / 3 - (x * x + y * y) * (1 + 0.25 * z) + 0.1 * z * x * x * x];
    case 'thomas':
      return [Math.sin(y) - P[0] * x, Math.sin(z) - P[0] * y, Math.sin(x) - P[0] * z];
    case 'halvorsen':
      return [-P[0] * x - 4 * y - 4 * z - y * y, -P[0] * y - 4 * z - 4 * x - z * z, -P[0] * z - 4 * x - 4 * y - x * x];
    case 'chen':
      return [P[0] * (y - x), (P[2] - P[0]) * x - x * z + P[2] * y, x * y - P[1] * z];
    case 'rossler':
      return [-y - z, x + P[0] * y, P[1] + z * (x - P[2])];
  }
}

function rk4(d: AttractorDef, p: V3, h: number): V3 {
  const add = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  const k1 = F(d.field, p, d.params);
  const k2 = F(d.field, add(p, k1, h / 2), d.params);
  const k3 = F(d.field, add(p, k2, h / 2), d.params);
  const k4 = F(d.field, add(p, k3, h), d.params);
  return [0, 1, 2].map((k) => p[k] + (h / 6) * (k1[k] + 2 * k2[k] + 2 * k3[k] + k4[k])) as V3;
}

/** Points along one long trajectory, after a burn-in that lands it on the attractor. */
function trace(d: AttractorDef, n: number, every: number): V3[] {
  let p = d.start;
  for (let i = 0; i < 4000; i++) p = rk4(d, p, d.step);
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < every; k++) p = rk4(d, p, d.step);
    out.push(p);
  }
  return out;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

interface FlowOpts {
  count: number;
  /** World radius the attractor is scaled to. */
  radius: number;
  /** Attractor time per second of sim time. */
  rate: number;
  color: RGB;
  color2: RGB;
  size: number;
  intensity: number;
  /** 'fill': start spread over the whole attractor; 'seed': start as one tiny drop. */
  start: 'fill' | 'seed';
  seedRadius?: number;
  streak?: number;
  seed?: number;
}

/** A particle group flowing along an attractor, scaled so it fits `radius` around the origin. */
function attractorFlow(d: AttractorDef, o: FlowOpts): ParticleGroupSpec {
  const pts = trace(d, 6000, 6);
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const c: V3 = [0, 1, 2].map((k) => 0.5 * (lo[k] + hi[k])) as V3;
  const R = quantile(pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])), 0.98);
  const scale = o.radius / R;
  const speeds = pts.map((p) => Math.hypot(...F(d.field, p, d.params)) * scale * o.rate);
  const rng = new Rng(o.seed ?? 1);
  // Fill: every particle a point of a long trajectory, so the attractor is drawn from frame one.
  const fill = o.start === 'fill' ? trace(d, o.count, 3) : null;
  const drop = pts[Math.floor(pts.length * 0.37)];
  const r0 = (o.seedRadius ?? 1e-3) * R;
  const init = (i: number): ParticleInit => {
    let p: V3;
    if (fill) p = fill[i % fill.length];
    else {
      const u = rng.unitVector();
      const r = r0 * Math.cbrt(rng.next());
      p = [drop[0] + u[0] * r, drop[1] + u[1] * r, drop[2] + u[2] * r];
    }
    const v = F(d.field, p, d.params);
    return {
      x: [(p[0] - c[0]) * scale, (p[1] - c[1]) * scale, (p[2] - c[2]) * scale],
      v: [v[0] * scale * o.rate, v[1] * scale * o.rate, v[2] * scale * o.rate],
      param: rng.next(),
    };
  };
  return {
    name: d.field,
    count: o.count,
    mode: 'flow',
    colorMode: 'speed',
    color: o.color,
    color2: o.color2,
    size: o.size,
    intensity: o.intensity,
    streak: o.streak ?? 1,
    field: d.field,
    fieldParams: d.params,
    fieldCenter: c,
    fieldScale: scale,
    fieldRate: o.rate,
    fieldStep: d.step,
    speedRef: quantile(speeds, 0.85),
    init,
  };
}

const MATH_SKY = {
  exposure: 0.55,
  nebula: { intensity: 0.025, coverage: 0.3 },
  band: { intensity: 0.02 },
  stars: { count: 9000, brightness: 0.6 },
};

interface MathScene {
  id: string;
  title: string;
  subtitle: string;
  blurb: string;
  def: AttractorDef;
  flow: Omit<FlowOpts, 'radius'>;
  equations: string[];
  captions: CaptionCue[];
  elevation: number;
  duration?: number;
}

function mathScene(m: MathScene): SceneDef {
  return {
    id: m.id,
    title: m.title,
    subtitle: m.subtitle,
    blurb: m.blurb,
    category: 'Math',
    build(): SceneSetup {
      const radius = 1.6;
      const duration = m.duration ?? 28;
      return {
        worlds: [new World({})],
        particles: [attractorFlow(m.def, { ...m.flow, radius })],
        sky: MATH_SKY,
        duration,
        camera: {
          fixedCenter: [0, 0, 0],
          fixedRadius: radius,
          elevation: m.elevation,
          orbitSpeed: 7,
          wobble: 5,
          margin: 1.08,
          dolly: (t) => 1.12 - 0.16 * Math.min(1, t / duration),
        },
        director: { baseRate: 1, maxScreenSpeed: 0, startHold: 1.2, easeIn: 1.5, outro: 3 },
        captions: [
          { at: 0.4, text: 'Strange attractor', duration: 5.5, kind: 'kicker' },
          { at: 0.4, text: m.title, sub: m.subtitle, duration: 5.5, kind: 'title' },
          { at: 6.5, text: 'The whole rule', lines: m.equations, duration: 6, kind: 'equation' },
          ...m.captions,
        ],
      };
    },
  };
}

export const lorenz = mathScene({
  id: 'lorenz',
  title: 'The Lorenz Attractor',
  subtitle: '300,000 points · one drop of chaos',
  blurb: 'Every point starts within a hair of the others; chaos stretches the drop into the famous butterfly.',
  def: { field: 'lorenz', params: [10, 28, 8 / 3, 0], step: 0.004, start: [0.1, 0, 20] },
  flow: { count: 300000, rate: 0.62, start: 'seed', seedRadius: 2.5e-3, color: hex('#2f6bff'), color2: hex('#ffb35c'), size: 0.006, intensity: 0.05 },
  equations: ['dx/dt = 10 (y − x)', 'dy/dt = x (28 − z) − y', 'dz/dt = x y − 8/3 z'],
  captions: [
    { at: 13.5, text: 'Sensitive dependence', sub: 'neighbours drift apart exponentially fast', duration: 5, kind: 'caption' },
    { at: 21, text: 'The butterfly', sub: 'order inside chaos · Lorenz, 1963', duration: 5.5, kind: 'caption' },
  ],
  elevation: 8,
  duration: 30,
});

export const aizawa = mathScene({
  id: 'aizawa',
  title: 'The Aizawa Attractor',
  subtitle: 'a sphere with a tube through its heart',
  blurb: 'Particles spiral over a sphere, dive down its axis and fan out again.',
  def: { field: 'aizawa', params: [0.95, 0.7, 0.6, 3.5], step: 0.01, start: [0.1, 0, 0] },
  flow: { count: 300000, rate: 1.4, start: 'fill', color: hex('#12b5c9'), color2: hex('#ff4fa3'), size: 0.006, intensity: 0.045 },
  equations: ['dx/dt = (z − 0.7) x − 3.5 y', 'dy/dt = 3.5 x + (z − 0.7) y', 'dz/dt = 0.6 + 0.95 z − z³/3 − (x² + y²)(1 + z/4) + z x³/10'],
  captions: [{ at: 15, text: 'Never repeats', sub: 'the path never crosses itself · it never closes', duration: 5, kind: 'caption' }],
  elevation: 18,
});

export const thomas = mathScene({
  id: 'thomas',
  title: 'Thomas’ Attractor',
  subtitle: 'three sines chasing each other',
  blurb: 'A cyclically symmetric maze: particles wander a lattice of loops forever.',
  def: { field: 'thomas', params: [0.208186, 0, 0, 0], step: 0.03, start: [0.1, 0, 0] },
  flow: { count: 300000, rate: 3.2, start: 'fill', color: hex('#6a3dff'), color2: hex('#ffd36b'), size: 0.006, intensity: 0.045 },
  equations: ['dx/dt = sin y − 0.208 x', 'dy/dt = sin z − 0.208 y', 'dz/dt = sin x − 0.208 z'],
  captions: [{ at: 15, text: 'Perfect symmetry', sub: 'cycle x, y and z and nothing changes', duration: 5, kind: 'caption' }],
  elevation: 26,
});

export const halvorsen = mathScene({
  id: 'halvorsen',
  title: 'The Halvorsen Attractor',
  subtitle: 'three blades, one rule',
  blurb: 'A three-bladed propeller of flowing light.',
  def: { field: 'halvorsen', params: [1.4, 0, 0, 0], step: 0.004, start: [-1.48, -1.51, 2.04] },
  flow: { count: 300000, rate: 0.9, start: 'fill', color: hex('#ff3d5a'), color2: hex('#6fe7ff'), size: 0.006, intensity: 0.045 },
  equations: ['dx/dt = −1.4 x − 4 y − 4 z − y²', 'dy/dt = −1.4 y − 4 z − 4 x − z²', 'dz/dt = −1.4 z − 4 x − 4 y − x²'],
  captions: [{ at: 15, text: 'Stretch and fold', sub: 'how chaos mixes · like kneading dough', duration: 5, kind: 'caption' }],
  elevation: 30,
});

export const rossler = mathScene({
  id: 'rossler',
  title: 'The Rössler Attractor',
  subtitle: 'a spiral that keeps leaping',
  blurb: 'Particles spiral outward on a disk, then leap up and fold back into the centre.',
  def: { field: 'rossler', params: [0.2, 0.2, 5.7, 0], step: 0.01, start: [1, 1, 0] },
  flow: { count: 300000, rate: 2.2, start: 'fill', color: hex('#19c37d'), color2: hex('#fff2c4'), size: 0.006, intensity: 0.045 },
  equations: ['dx/dt = −y − z', 'dy/dt = x + 0.2 y', 'dz/dt = 0.2 + z (x − 5.7)'],
  captions: [{ at: 15, text: 'The simplest chaos', sub: 'one nonlinear term is enough · Rössler, 1976', duration: 5, kind: 'caption' }],
  elevation: 22,
});

export const MATH_SCENES: SceneDef[] = [lorenz, aizawa, thomas, halvorsen, rossler];

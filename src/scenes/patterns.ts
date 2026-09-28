// Patterns from short formulas: iterated maps (Clifford, de Jong), where a million points hop
// by one rule until a lace appears, and harmonographs, where damped pendulums draw with a pen.

import { hex } from '../core/color.ts';
import type { RGB, V3 } from '../core/math.ts';
import { Rng } from '../core/rng.ts';
import { World } from '../physics/world.ts';
import type { IteratedMap, ParticleGroupSpec, ParticleInit } from '../render/particles.ts';
import { MATH_SKY } from './attractors.ts';
import type { CaptionCue, SceneDef, SceneSetup } from './types.ts';

type Params = [number, number, number, number];

const smoother = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// ---------------------------------------------------------------------------------------------
// Iterated maps

/** CPU twin of the GLSL mapStep (keep the two in sync). */
function mapStep(m: IteratedMap, x: number, y: number, [a, b, c, d]: Params): [number, number] {
  return m === 'clifford'
    ? [Math.sin(a * y) + c * Math.cos(a * x), Math.sin(b * x) + d * Math.cos(b * y)]
    : [Math.sin(a * y) - Math.cos(b * x), Math.sin(c * x) - Math.cos(d * y)];
}

/** Morph path from p0 to p1, bowed by `bend` so that every map along it stays chaotic. */
const along = (p0: Params, p1: Params, bend: Params, s: number): Params =>
  p0.map((v, i) => v + (p1[i] - v) * s + bend[i] * Math.sin(Math.PI * s)) as Params;

function attractorPoints(m: IteratedMap, p: Params, n: number): [number, number][] {
  let x = 0.1, y = 0.1;
  for (let i = 0; i < 500; i++) [x, y] = mapStep(m, x, y, p);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    [x, y] = mapStep(m, x, y, p);
    out.push([x, y]);
  }
  return out;
}

interface MapSceneDef {
  id: string;
  title: string;
  subtitle: string;
  blurb: string;
  map: IteratedMap;
  kicker: string;
  /** Parameters the points first settle on. */
  p0: Params;
  /** Optional morph: target parameters and the bend that keeps the path chaotic. */
  morph?: { p1: Params; bend: Params };
  equations: string[];
  captions: CaptionCue[];
  color: RGB;
  color2: RGB;
  count?: number;
  duration: number;
}

function mapScene(d: MapSceneDef): SceneDef {
  return {
    id: d.id,
    title: d.title,
    subtitle: d.subtitle,
    blurb: d.blurb,
    category: 'Math',
    build(): SceneSetup {
      const radius = 1.5;
      // Frame every shape the points will visit, so the camera never has to chase them.
      const shapes = d.morph ? [0, 0.25, 0.5, 0.75, 1].map((s) => along(d.p0, d.morph!.p1, d.morph!.bend, s)) : [d.p0];
      const pts = shapes.flatMap((p) => attractorPoints(d.map, p, 40000));
      let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (const [x, y] of pts) {
        lo = [Math.min(lo[0], x), Math.min(lo[1], y)];
        hi = [Math.max(hi[0], x), Math.max(hi[1], y)];
      }
      const center: [number, number] = [0.5 * (lo[0] + hi[0]), 0.5 * (lo[1] + hi[1])];
      const R = quantile(pts.map(([x, y]) => Math.hypot(x - center[0], y - center[1])), 0.995);
      const scale = radius / R;
      const first = attractorPoints(d.map, d.p0, 40000);
      const jumps = first.map(([x, y]) => {
        const [u, v] = mapStep(d.map, x, y, d.p0);
        return Math.hypot(u - x, v - y) * scale;
      });
      const rng = new Rng(11);
      const name = d.map;
      const group: ParticleGroupSpec = {
        name,
        count: d.count ?? 800000,
        mode: 'map',
        colorMode: 'speed',
        color: d.color,
        color2: d.color2,
        size: 0.0035,
        intensity: 0.05,
        streak: 1.5,
        map: d.map,
        mapParams: d.p0,
        mapCenter: center,
        mapScale: scale,
        hopRate: 0.8,
        hopBlend: 1,
        speedRef: quantile(jumps, 0.97),
        // Pure noise: a uniform square of random points.
        init: (): ParticleInit => ({
          x: [center[0] + (rng.next() * 2 - 1) * R * 0.72, center[1] + (rng.next() * 2 - 1) * R * 0.72, 0],
          v: [0, 0, 0],
          param: rng.next(),
        }),
      };
      // Timeline (sim seconds): glides until the lace has emerged and shown it is invariant,
      // then (with a morph) speed up into continuous iteration while the parameters flow.
      const emerge = 11.25, ramp = 1.5, morphTime = 10, fastRate = 36;
      return {
        worlds: [new World({})],
        particles: [group],
        sky: MATH_SKY,
        duration: d.duration,
        camera: {
          fixedCenter: [0, 0, 0],
          fixedRadius: radius,
          elevation: 86,
          wobble: 3,
          wobblePeriod: 11,
          azimuth: -90,
          orbitSpeed: 2.5,
          margin: 1.06,
          dolly: (t) => 1.1 - 0.12 * smoother(t / d.duration),
        },
        director: { baseRate: 1, maxScreenSpeed: 0, startHold: 1.4, easeIn: 1.2, outro: 3 },
        captions: [
          { at: 0.4, text: d.kicker, duration: 5, kind: 'kicker' },
          { at: 0.4, text: d.title, sub: d.subtitle, duration: 5, kind: 'title' },
          { at: 5.8, text: 'The whole rule', lines: d.equations, duration: 5.2, kind: 'equation' },
          ...d.captions,
        ],
        onFrame: (rt) => {
          const g = rt.renderer.particles.group(name);
          if (!g?.map) return;
          const t = rt.primary.t;
          if (!d.morph) return;
          const k = smoother((t - emerge) / ramp);
          g.map.rate = 0.8 + (fastRate - 0.8) * k;
          g.map.blend = 1 - k;
          g.map.params = along(d.p0, d.morph.p1, d.morph.bend, smoother((t - emerge - ramp) / morphTime));
        },
      };
    },
  };
}

export const clifford = mapScene({
  id: 'clifford',
  title: 'The Clifford Attractor',
  subtitle: 'a million random points · one rule',
  blurb: 'Random noise hops by one rule until lace appears; then one number changes and the lace flows.',
  map: 'clifford',
  kicker: 'Iterated map',
  p0: [-1.4, 1.6, 1.0, 0.7],
  // Every map on this bowed path is chaotic (checked: Lyapunov exponent ≥ 0.28 all the way).
  morph: { p1: [-1.7, 1.7, 0.6, 1.2], bend: [-0.107, -0.074, 0.171, 0.224] },
  equations: ['x′ = sin(−1.4 y) + cos(1.4 x)', 'y′ = sin(1.6 x) + 0.7 cos(1.6 y)'],
  captions: [
    { at: 10.2, text: 'Every point jumps', sub: 'yet the picture never changes', duration: 3.6, kind: 'caption' },
    { at: 16.5, text: 'Change one number', sub: 'and the whole shape flows', duration: 5, kind: 'caption' },
    { at: 24.2, text: 'Chaos with a shape', sub: 'Clifford Pickover’s map', duration: 4.3, kind: 'caption' },
  ],
  color: hex('#5b7cff'),
  color2: hex('#ffd166'),
  duration: 28.5,
});

export const deJong = mapScene({
  id: 'dejong',
  title: 'The de Jong Attractor',
  subtitle: 'every point hops at once',
  blurb: 'A million points leap together, over and over, and always land on the same golden lace.',
  map: 'dejong',
  kicker: 'Iterated map',
  p0: [1.4, -2.3, 2.4, -2.1],
  equations: ['x′ = sin(1.4 y) − cos(2.3 x)', 'y′ = sin(2.4 x) − cos(2.1 y)'],
  captions: [
    { at: 11.5, text: 'Unpredictable points', sub: 'no one can say where a single point lands next', duration: 4.5, kind: 'caption' },
    { at: 17, text: 'A predictable whole', sub: 'together they always draw the same lace', duration: 5, kind: 'caption' },
  ],
  color: hex('#ff7a18'),
  color2: hex('#fff1c9'),
  duration: 25,
});

// ---------------------------------------------------------------------------------------------
// Harmonographs

/** One damped pendulum term: amplitude · sin(frequency · t + phase) · e^(−damping · t). */
type Pendulum = [number, number, number, number];

interface Harmonograph {
  x: Pendulum[];
  y: Pendulum[];
  z?: Pendulum[];
  /** Length of the drawing in pendulum time. */
  T: number;
}

const swing = (ps: Pendulum[] | undefined, t: number) =>
  (ps ?? []).reduce((s, [A, f, p, d]) => s + A * Math.sin(f * t + p) * Math.exp(-d * t), 0);

const penAt = (h: Harmonograph, t: number): V3 => [swing(h.x, t), swing(h.y, t), swing(h.z, t)];

interface HarmonographSceneDef {
  id: string;
  title: string;
  subtitle: string;
  blurb: string;
  h: Harmonograph;
  equations: string[];
  captions: CaptionCue[];
  color: RGB;
  color2: RGB;
  /** Sim seconds the pen takes to draw the whole figure. */
  drawTime: number;
  duration: number;
  /** 3D figures get an orbiting, low camera; flat ones are seen from above. */
  sculpture?: boolean;
}

function harmonographScene(d: HarmonographSceneDef): SceneDef {
  return {
    id: d.id,
    title: d.title,
    subtitle: d.subtitle,
    blurb: d.blurb,
    category: 'Math',
    build(): SceneSetup {
      const radius = 1.5;
      let R = 0;
      for (let i = 0; i <= 20000; i++) {
        const p = penAt(d.h, (i / 20000) * d.h.T);
        R = Math.max(R, Math.hypot(p[0], p[1], p[2]));
      }
      const scale = radius / R;
      // The drawing is exact: every particle is one sample of the pen's path, appearing when
      // the pen reaches it (negative age = not drawn yet). The first few loops are already on
      // the page when the title appears, so the opening frame is never empty.
      const preDrawn = 0.06;
      const ink: ParticleGroupSpec = {
        name: 'ink',
        count: 600000,
        mode: 'static',
        colorMode: 'ink',
        color: d.color,
        color2: d.color2,
        size: 0.0032,
        intensity: 0.03,
        inkGlow: 5,
        streak: 0,
        init: (i, n): ParticleInit => {
          const s = n > 1 ? i / (n - 1) : 0;
          const p = penAt(d.h, s * d.h.T);
          return { x: [p[0] * scale, p[1] * scale, p[2] * scale], v: [0, 0, 0], age: (preDrawn - s) * d.drawTime, param: s, size: 1 };
        },
      };
      const camera = d.sculpture
        ? { elevation: 18, wobble: 10, wobblePeriod: 13, orbitSpeed: 9 }
        : { elevation: 86, wobble: 3, wobblePeriod: 11, azimuth: -90, orbitSpeed: 2.5 };
      return {
        worlds: [new World({})],
        particles: [ink],
        sky: MATH_SKY,
        duration: d.duration,
        camera: {
          fixedCenter: [0, 0, 0],
          // A sculpture only reaches its full 3D extent in its first swings: frame it tighter.
          fixedRadius: d.sculpture ? radius * 0.82 : radius,
          margin: 1.06,
          ...camera,
          dolly: (t) => 1.08 - 0.1 * smoother(t / d.duration),
        },
        director: { baseRate: 1, maxScreenSpeed: 0, startHold: 1.4, easeIn: 1.2, outro: 3 },
        captions: [
          { at: 0.4, text: 'Harmonograph', duration: 5, kind: 'kicker' },
          { at: 0.4, text: d.title, sub: d.subtitle, duration: 5, kind: 'title' },
          { at: 6, text: 'The whole machine', lines: d.equations, duration: 5.5, kind: 'equation' },
          ...d.captions,
        ],
      };
    },
  };
}

export const harmonograph = harmonographScene({
  id: 'harmonograph',
  title: 'The Harmonograph',
  subtitle: 'two pendulums · one pen',
  blurb: 'A Victorian drawing machine: two swinging pendulums guide a pen as they slowly lose energy.',
  h: {
    x: [[1, 2, 0, 0.02], [1, 6, 0, 0.0315]],
    y: [[1, 1.002, Math.PI / 2, 0.02], [1, 3, (3 * Math.PI) / 2, 0.02]],
    T: 100,
  },
  equations: ['x = sin 2t · e^(−t/50) + sin 6t · e^(−t/32)', 'y = cos 1.002t · e^(−t/50) − cos 3t · e^(−t/50)'],
  captions: [
    { at: 13, text: 'Friction draws the lace', sub: 'each swing a little smaller than the last', duration: 5, kind: 'caption' },
    { at: 20, text: 'Nothing but sine waves', sub: 'the Victorian machine that drew with pendulums', duration: 5, kind: 'caption' },
  ],
  color: hex('#ffc861'),
  color2: hex('#ff4f8b'),
  drawTime: 20,
  duration: 27,
});

export const harmonographStar = harmonographScene({
  id: 'harmonograph-star',
  title: 'Pendulum Star',
  subtitle: 'three swings to four',
  blurb: 'Pendulums swinging in a 3 : 4 rhythm, a hair out of tune, bloom into a six-pointed star.',
  h: {
    x: [[1, 3.005, 0, 0.009], [1, 4, 1.2, 0.009]],
    y: [[1, 4, 0, 0.009], [1, 3, 2.1, 0.009]],
    T: 170,
  },
  equations: ['x = e^(−t/111) · (sin 3.005t + sin(4t + 1.2))', 'y = e^(−t/111) · (sin 4t + sin(3t + 2.1))'],
  captions: [
    { at: 13, text: 'A hair out of tune', sub: '3.005 instead of 3 · the figure slowly turns', duration: 5, kind: 'caption' },
    { at: 20, text: 'Six points from four swings', sub: 'rhythm drawn in light', duration: 5, kind: 'caption' },
  ],
  color: hex('#6ee7ff'),
  color2: hex('#b16cff'),
  drawTime: 20,
  duration: 27,
});

export const harmonograph3d = harmonographScene({
  id: 'harmonograph-3d',
  title: 'Pendulum Sculpture',
  subtitle: 'three pendulums · three directions',
  blurb: 'A third pendulum lifts the pen off the page: a wire sculpture of light, drawn in 3D.',
  h: {
    x: [[1, 2, 0, 0.009], [0.8, 3.003, 1, 0.009]],
    y: [[1, 3, Math.PI / 2, 0.009], [0.8, 2.002, 0, 0.009]],
    z: [[1, 1.001, 0, 0.009], [0.6, 4, 0.4, 0.009]],
    T: 170,
  },
  equations: ['x = sin 2t + 0.8 sin(3.003t + 1)', 'y = cos 3t + 0.8 sin 2.002t', 'z = sin 1.001t + 0.6 sin(4t + 0.4)', 'all fading as e^(−t/111)'],
  captions: [{ at: 15, text: 'Drawn in three dimensions', sub: 'the same sine waves, one more pendulum', duration: 5, kind: 'caption' }],
  color: hex('#ffa24c'),
  color2: hex('#4de2c5'),
  drawTime: 20,
  duration: 27,
  sculpture: true,
});

export const PATTERN_SCENES: SceneDef[] = [clifford, deJong, harmonograph, harmonographStar, harmonograph3d];

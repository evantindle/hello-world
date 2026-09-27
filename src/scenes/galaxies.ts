// Galaxy collision (Toomre & Toomre style): two disk galaxies of tracer stars orbiting softened
// cores. Tidal tails and bridges form on the first pass; dynamical friction merges the cores,
// which ignites a quasar.

import { blackbody, hex } from '../core/color.ts';
import { norm, rotateAxis, type RGB, type V3 } from '../core/math.ts';
import { World } from '../physics/world.ts';
import type { ParticleGroupSpec } from '../render/particles.ts';
import { diskInit } from './helpers.ts';
import type { SceneDef, SceneSetup } from './types.ts';
import { Rng } from '../core/rng.ts';

function galaxyGroups(opts: {
  name: string;
  core: { x: V3; v: V3; m: number; soft: number };
  count: number;
  rIn: number;
  rOut: number;
  normal: V3;
  seed: number;
  young: number;
  pink: RGB;
  bulgeCount: number;
  bulgeR: number;
  arms: number;
  retrograde?: boolean;
  intensity: number;
}): ParticleGroupSpec[] {
  const c = opts.core;
  const disk: ParticleGroupSpec = {
    name: `${opts.name}-disk`,
    count: opts.count,
    mode: 'free',
    colorMode: 'star',
    color: opts.pink,
    size: 0.0075,
    intensity: opts.intensity,
    streak: 0.5,
    init: diskInit({
      seed: opts.seed,
      center: c.x,
      vel: c.v,
      normal: opts.normal,
      M: c.m,
      soft: c.soft,
      rIn: opts.rIn,
      rOut: opts.rOut,
      thickness: 0.035,
      p: 1.15,
      jitter: 0.035,
      arms: opts.arms,
      pitch: 0.38,
      armStrength: 0.5,
      retrograde: opts.retrograde,
      param: (r, _phi, rng, inArm) => {
        // Young blue stars and pink star-forming knots trace the arms; older, redder stars fill the disk.
        if (inArm && rng.next() < 0.1) return -1;
        if (inArm && rng.next() < opts.young) return rng.range(9000, 16000);
        const inner = Math.exp(-r / (opts.rOut * 0.35));
        return rng.range(4200, 6800) - 900 * inner;
      },
      size: (r, rng) => 0.7 + rng.next() * 0.9 + (r < opts.rOut * 0.2 ? 0.3 : 0),
    }),
  };
  const rng = new Rng(opts.seed + 99);
  const bulge: ParticleGroupSpec = {
    name: `${opts.name}-bulge`,
    count: opts.bulgeCount,
    mode: 'free',
    colorMode: 'star',
    color: [1, 0.8, 0.6],
    size: 0.009,
    intensity: opts.intensity * 0.45,
    streak: 0.6,
    init: () => {
      // Hot spheroid: random orbits at roughly the local circular speed.
      const d = rng.unitVector();
      const r = opts.bulgeR * Math.pow(rng.next(), 1.6) + 0.01;
      const vc = Math.sqrt((c.m * r * r) / Math.pow(r * r + c.soft * c.soft, 1.5));
      let t = rng.unitVector();
      const dot = t[0] * d[0] + t[1] * d[1] + t[2] * d[2];
      t = norm([t[0] - dot * d[0], t[1] - dot * d[1], t[2] - dot * d[2]]);
      const s = vc * (0.75 + rng.next() * 0.25);
      return {
        x: [c.x[0] + d[0] * r, c.x[1] + d[1] * r, c.x[2] + d[2] * r],
        v: [c.v[0] + t[0] * s, c.v[1] + t[1] * s, c.v[2] + t[2] * s],
        param: rng.range(3600, 5000),
        size: 0.6 + rng.next(),
      };
    },
  };
  return [disk, bulge];
}

export const galaxyCollision: SceneDef = {
  id: 'galaxies',
  title: 'When Galaxies Collide',
  subtitle: 'Two spirals, a third of a million stars',
  blurb: 'Two spiral galaxies pass, fling out tidal tails, fall back together and merge.',
  category: 'Galactic',
  build(): SceneSetup {
    const w = new World({ G: 1, collisions: true, friction: { coef: 0.35, radius: 0.9 }, ejectFactor: 1e9, closeFactor: 0 });
    const M1 = 1, M2 = 0.7, M = M1 + M2;
    const rp = 0.9, R0 = 5, p = 2 * rp;
    const nu = -Math.acos(p / R0 - 1);
    const vs = Math.sqrt(M / p);
    const r: V3 = [R0 * Math.cos(nu), R0 * Math.sin(nu), 0];
    const vr = vs * Math.sin(nu), vt = vs * (1 + Math.cos(nu));
    const v: V3 = [vr * Math.cos(nu) - vt * Math.sin(nu), vr * Math.sin(nu) + vt * Math.cos(nu), 0];
    const xA: V3 = [(-r[0] * M2) / M, (-r[1] * M2) / M, 0], vA: V3 = [(-v[0] * M2) / M, (-v[1] * M2) / M, 0];
    const xB: V3 = [(r[0] * M1) / M, (r[1] * M1) / M, 0], vB: V3 = [(v[0] * M1) / M, (v[1] * M1) / M, 0];
    const coreA = w.add({ kind: 'core', name: 'A', m: M1, soft: 0.3, collide: 0.04, x: xA, v: vA, radius: 0.09, intensity: 1, color: blackbody(4200), trail: false, canEject: false });
    w.add({ kind: 'core', name: 'B', m: M2, soft: 0.25, collide: 0.04, x: xB, v: vB, radius: 0.08, intensity: 0.8, color: blackbody(4600), trail: false, canEject: false });
    const nB = rotateAxis([0, 0, 1], [1, 0, 0], (55 * Math.PI) / 180);
    const groups = [
      ...galaxyGroups({ name: 'A', core: { x: xA, v: vA, m: M1, soft: 0.3 }, count: 240000, rIn: 0.08, rOut: 1.35, normal: [0, 0, 1], seed: 101, young: 0.75, pink: hex('#ff5fae'), bulgeCount: 18000, bulgeR: 0.3, arms: 2, intensity: 0.24 }),
      ...galaxyGroups({ name: 'B', core: { x: xB, v: vB, m: M2, soft: 0.25 }, count: 170000, rIn: 0.07, rOut: 1.05, normal: nB, seed: 202, young: 0.35, pink: hex('#ff7a8c'), bulgeCount: 15000, bulgeR: 0.26, arms: 2, intensity: 0.24 }),
    ];
    const jets: ParticleGroupSpec = {
      name: 'jets',
      count: 30000,
      mode: 'jet',
      colorMode: 'jet',
      color: hex('#7f8dff'),
      host: coreA,
      life: 1.4,
      speed: 2.4,
      normal: [0, 0, 1],
      size: 0.012,
      intensity: 1.6,
      gravity: 0.2,
    };
    return {
      worlds: [w],
      duration: 42,
      particles: [...groups, jets],
      sky: {
        exposure: 0.8,
        nebula: { intensity: 0.012 },
        band: { intensity: 0.0 },
        stars: { count: 5000, brightness: 0.55, bandFraction: 0 },
      },
      post: { bloomStrength: 0.75, vignette: 0.6 },
      camera: { elevation: 55, orbitSpeed: 1.6, fixedCenter: [0, 0, 0], fixedRadius: 3.3, margin: 1, dolly: (t) => 1.12 - 0.3 * Math.min(1, t / 40), fov: 36 },
      director: { baseRate: 1.25, maxScreenSpeed: 0, startHold: 1.4, easeIn: 1.4, outro: 7 },
      shutter: 0.7,
      starGain: 0.7,
      onFrame: (rt, dt) => {
        const g = rt.renderer.particles.group('jets');
        if (g) g.gain += ((rt.eventTimes.has('merge') ? 1 : 0) - g.gain) * Math.min(1, dt * 0.8);
        const tA = rt.primary.t;
        if (tA > 6 && !rt.eventTimes.has('tails')) rt.markEvent('tails');
      },
      onEvent: (ev, rt) => {
        if (ev.type === 'merge') {
          rt.markEvent('merge');
          rt.resolve('merge');
          rt.vfx.flash(rt.clock, () => ev.result.x, [0.75, 0.8, 1], 0.12, 20, 2.5, 2, 1);
          rt.vfx.shock(rt.clock, ev.pos, 10, 500, 2.5);
          return true;
        }
      },
      captions: [
        { at: 0.5, text: 'Galactic', duration: 5.5, kind: 'kicker' },
        { at: 0.5, text: 'Galaxies Collide', sub: 'two spirals · a third of a million stars', duration: 5.5, kind: 'title' },
        { on: 'tails', delay: 2.5, text: 'Tidal tails', sub: 'gravity flings streams of stars into the void', duration: 5, kind: 'caption' },
        { on: 'merge', delay: 0.5, text: 'One galaxy', sub: 'the cores merge · a quasar ignites', duration: 5.5, kind: 'caption' },
      ],
    };
  },
};

export const GALAXY_SCENES: SceneDef[] = [galaxyCollision];

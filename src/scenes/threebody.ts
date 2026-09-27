// Three-body scenes: periodic choreographies, Burrau's Pythagorean problem, the unstable
// Lagrange triangle, the "butterfly effect" ensemble and seeded random chaos.

import { hex, hsv, PALETTE } from '../core/color.ts';
import type { RGB, V3 } from '../core/math.ts';
import { Rng } from '../core/rng.ts';
import { World, type BodyInit } from '../physics/world.ts';
import type { ParticleGroupSpec } from '../render/particles.ts';
import { diskInit, embers, sparks } from './helpers.ts';
import { orbitById, type PeriodicOrbit } from './orbits.ts';
import type { SceneDef, SceneSetup } from './types.ts';

const TRIO: RGB[] = [PALETTE.cyan, PALETTE.magenta, PALETTE.gold];

function star(name: string, m: number, x: V3, v: V3, color: RGB, radius: number, extra: Partial<BodyInit> = {}): BodyInit {
  return { name, kind: 'star', m, x, v, color, radius, intensity: 1, spikes: 0.8, ...extra };
}

/** Faint dust nebula lit by the stars; gets stirred into streamers by their gravity. */
function litDust(opts: { M: number; rIn: number; rOut: number; count?: number; size?: number; intensity?: number; seed?: number; soft?: number; ambient?: number; thickness?: number }): ParticleGroupSpec {
  return {
    name: 'dust',
    count: opts.count ?? 120000,
    mode: 'free',
    colorMode: 'lit',
    color: hex('#3a6bff'),
    color2: hex('#ff4fa3'),
    size: opts.size ?? 0.006,
    intensity: opts.intensity ?? 0.05,
    ambient: opts.ambient ?? 0.12,
    lightSoftening: opts.soft ?? 0.12,
    streak: 0.4,
    init: diskInit({
      seed: opts.seed ?? 3,
      M: opts.M,
      rIn: opts.rIn,
      rOut: opts.rOut,
      thickness: opts.thickness ?? 0.05,
      p: 0.8,
      jitter: 0.05,
      param: (r, phi) => 0.5 + 0.5 * Math.sin(phi * 2 + r * 2.5),
    }),
  };
}

// ---------------------------------------------------------------------------------------------

export const figureEight: SceneDef = {
  id: 'figure-eight',
  title: 'The Figure-Eight',
  subtitle: 'Three equal suns chasing each other forever',
  blurb: 'Chenciner–Montgomery choreography: a perfectly stable three-body dance.',
  category: 'Three-Body',
  build(): SceneSetup {
    const o = orbitById('figure8');
    const [p1, p2] = o.p;
    const w = new World({ rtol: 1e-11, collisions: false });
    const trail = { fade: o.T * 0.55, maxAge: o.T * 1.2, width: 0.012, intensity: 1.4, core: 0.7 };
    w.add(star('A', 1, [-1, 0, 0], [p1, p2, 0], TRIO[0], 0.035, { trail }));
    w.add(star('B', 1, [1, 0, 0], [p1, p2, 0], TRIO[1], 0.035, { trail }));
    w.add(star('C', 1, [0, 0, 0], [-2 * p1, -2 * p2, 0], TRIO[2], 0.035, { trail }));
    return {
      worlds: [w],
      duration: 24,
      particles: [
        ...embers(w, { count: 5000, life: 0.9, speed: 0.025, size: 0.004, intensity: 2.0, gravity: 0.1 }),
        litDust({ M: 3, rIn: 0.25, rOut: 2.6, count: 220000, size: 0.012, intensity: 0.022, ambient: 0.05 }),
      ],
      camera: { elevation: 38, orbitSpeed: 3, margin: 1.25, holdTime: 8 },
      director: { baseRate: 1.1, maxScreenSpeed: 2.5, startHold: 1.5, easeIn: 1.5 },
      captions: [
        { at: 0.4, text: 'The Figure-Eight', sub: 'three equal masses · one shared orbit', duration: 5.5, kind: 'title' },
        { at: 0.4, text: 'Three-body problem', duration: 5.5, kind: 'kicker' },
        { at: 13, text: 'Perfectly stable', sub: 'found by computer in 1993 · proven in 2000', duration: 5, kind: 'caption' },
      ],
    };
  },
};

export const pythagorean: SceneDef = {
  id: 'pythagorean',
  title: 'The Pythagorean Problem',
  subtitle: 'Masses 3 · 4 · 5, released from rest',
  blurb: "Burrau's 1913 puzzle: a 3-4-5 triangle of stars. Sixty time units of chaos, then an exile.",
  category: 'Three-Body',
  build(): SceneSetup {
    const w = new World({ rtol: 1e-13, atol: 1e-15, collisions: false, ejectFactor: 5, closeFactor: 0.08 });
    const trail = { fade: 3.2, maxAge: 9, width: 0.028, intensity: 1.5, core: 0.7 };
    const r = (m: number) => 0.055 * Math.cbrt(m);
    const b3 = w.add(star('three', 3, [1, 3, 0], [0, 0, 0], TRIO[0], r(3), { trail, intensity: 0.9 }));
    const b4 = w.add(star('four', 4, [-2, -1, 0], [0, 0, 0], TRIO[1], r(4), { trail, intensity: 1.0 }));
    const b5 = w.add(star('five', 5, [1, -1, 0], [0, 0, 0], TRIO[2], r(5), { trail, intensity: 1.1 }));
    return {
      worlds: [w],
      duration: 70,
      particles: [
        ...embers(w, { count: 6000, life: 0.9, speed: 0.045, size: 0.009, intensity: 2.4, gravity: 0.1 }),
      ],
      camera: { elevation: 58, orbitSpeed: 1.6, margin: 1.32, holdTime: 4, azimuth: -90, minRadius: 1.6 },
      director: { baseRate: 2.8, maxScreenSpeed: 1.15, minRate: 0.05, startHold: 3.2, easeIn: 1.8, outro: 7, ejectFollow: 3.5 },
      labels: [
        { body: b3, text: 'm = 3', from: 0.6, to: 4.2 },
        { body: b4, text: 'm = 4', from: 0.6, to: 4.2 },
        { body: b5, text: 'm = 5', from: 0.6, to: 4.2 },
      ],
      captions: [
        { at: 0.4, text: 'Three-body problem', duration: 5.2, kind: 'kicker' },
        { at: 0.4, text: 'Masses 3 · 4 · 5', sub: 'placed on a 3-4-5 triangle · released from rest', duration: 5.2, kind: 'title' },
        { on: 'eject', delay: 0.4, text: 'One star is exiled', sub: 'the other two lock into a binary · forever', duration: 5.5, kind: 'caption' },
      ],
      onEvent: (ev, rt) => {
        if (ev.type === 'eject') rt.resolve('eject');
        if (ev.type === 'periapsis' && ev.r < 0.12) {
          const col = ev.a.color.map((c, k) => (c + ev.b.color[k]) / 2) as RGB;
          const mid: V3 = [(ev.a.x[0] + ev.b.x[0]) / 2, (ev.a.x[1] + ev.b.x[1]) / 2, 0];
          rt.vfx.flash(rt.clock, mid, col, 0.08, 6, 0.8, 4, 1);
        }
      },
    };
  },
};

export const lagrangeCollapse: SceneDef = {
  id: 'lagrange',
  title: 'Perfect Balance',
  subtitle: 'Three suns on a spinning triangle',
  blurb: "Lagrange's equilateral solution. Nudge one star by a millionth — watch symmetry shatter.",
  category: 'Three-Body',
  build(): SceneSetup {
    const w = new World({ rtol: 1e-12, atol: 1e-14, collisions: false, ejectFactor: 5, closeFactor: 0.1 });
    const R = 1, m = 1;
    const v = Math.sqrt(m / (Math.sqrt(3) * R));
    const trail = { fade: 2.6, maxAge: 8, width: 0.012, intensity: 1.5, core: 0.7 };
    const cols = [PALETTE.azure, PALETTE.rose, PALETTE.lime];
    for (let k = 0; k < 3; k++) {
      const a = (k * 2 * Math.PI) / 3 + Math.PI / 2;
      const x: V3 = [R * Math.cos(a), R * Math.sin(a), 0];
      if (k === 0) x[0] += 1e-6;
      w.add(star(`L${k}`, m, x, [-v * Math.sin(a), v * Math.cos(a), 0], cols[k], 0.035, { trail }));
    }
    return {
      worlds: [w],
      duration: 40,
      particles: [
        ...embers(w, { count: 5000, life: 0.8, speed: 0.025, size: 0.0045, intensity: 2.4, gravity: 0.1 }),
      ],
      camera: { elevation: 50, orbitSpeed: -2, margin: 1.3, holdTime: 3, minRadius: 1.1 },
      director: { baseRate: 2.4, maxScreenSpeed: 1.3, startHold: 2.2, easeIn: 1.5, outro: 6 },
      captions: [
        { at: 0.4, text: 'Three-body problem', duration: 5, kind: 'kicker' },
        { at: 0.4, text: 'Perfect Balance', sub: 'an equilateral triangle, spinning in lockstep', duration: 5, kind: 'title' },
        { at: 8.5, text: 'One star is nudged', sub: 'by one millionth of the distance', duration: 4.2, kind: 'caption' },
        { on: 'eject', delay: 0.5, text: 'Symmetry never survives', sub: 'one star is thrown out of the system', duration: 5, kind: 'caption' },
      ],
      onEvent: (ev, rt) => {
        if (ev.type === 'eject') rt.resolve('eject');
      },
    };
  },
};

/** One scene per famous periodic orbit: long-exposure light painting. */
function periodicScene(id: string, orbitId: string, title: string, blurb: string, colors: RGB[], periods = 2.2): SceneDef {
  return {
    id,
    title,
    subtitle: 'A periodic three-body orbit',
    blurb,
    category: 'Three-Body',
    build(): SceneSetup {
      const o: PeriodicOrbit = orbitById(orbitId);
      const [p1, p2] = o.p;
      const w = new World({ rtol: 1e-12, atol: 1e-14, collisions: false });
      const trail = { fade: o.T * 0.9, maxAge: o.T * 1.02, width: 0.009, intensity: 1.2, core: 0.55 };
      w.add(star('A', 1, [-1, 0, 0], [p1, p2, 0], colors[0], 0.03, { trail }));
      w.add(star('B', 1, [1, 0, 0], [p1, p2, 0], colors[1], 0.03, { trail }));
      w.add(star('C', 1, [0, 0, 0], [-2 * p1, -2 * p2, 0], colors[2], 0.03, { trail }));
      // Aim the clip at ~periods × T of sim time.
      const clip = 26;
      const baseRate = (o.T * periods) / (clip - 3.5);
      return {
        worlds: [w],
        duration: clip,
        particles: [],
        camera: { elevation: 78, orbitSpeed: 1.2, wobble: 3, margin: 1.15, holdTime: 30, minRadius: 0.8 },
        director: { baseRate, maxScreenSpeed: 3.5, minRate: 0.08, startHold: 1.8, easeIn: 1.2 },
        trailSpacing: 0.002,
        captions: [
          { at: 0.4, text: 'Three-body problem', duration: 5, kind: 'kicker' },
          { at: 0.4, text: title, sub: `a periodic orbit · T = ${o.T.toFixed(2)}`, duration: 5, kind: 'title' },
          { at: clip - 7, text: 'Same start · same dance', sub: 'Šuvakov & Dmitrašinović, 2013', duration: 5, kind: 'caption' },
        ],
      };
    },
  };
}

export const butterfly = periodicScene('butterfly', 'butterfly1', 'The Butterfly', 'Šuvakov–Dmitrašinović orbit I.A.1 — wings drawn in light.', [PALETTE.cyan, PALETTE.violet, PALETTE.gold], 3);
export const moth = periodicScene('moth', 'moth1', 'The Moth', 'Orbit I.B.1: three suns trace a moth, then do it again.', [PALETTE.amber, PALETTE.ice, PALETTE.rose], 2);
export const dragonfly = periodicScene('dragonfly', 'dragonfly', 'The Dragonfly', 'Orbit I.B.7: slow wings, violent close passes.', [PALETTE.lime, PALETTE.azure, PALETTE.magenta], 1.3);
export const yinYang = periodicScene('yin-yang', 'yinyang1a', 'Yin-Yang', 'Orbit II.C.2a: a choreography that folds into itself.', [PALETTE.white, PALETTE.azure, PALETTE.ember], 1.6);
export const goggles = periodicScene('goggles', 'goggles', 'The Goggles', 'Orbit I.B.5: two lenses and a bridge.', [PALETTE.gold, PALETTE.cyan, PALETTE.magenta], 2);

/** Many universes that start identically (to one part in a billion) and then diverge. */
export const butterflyEffect: SceneDef = {
  id: 'butterfly-effect',
  title: 'The Butterfly Effect',
  subtitle: '48 universes, one starting point',
  blurb: 'Forty-eight copies of one system, nudged by a billionth. White light splits into a rainbow of fates.',
  category: 'Three-Body',
  build(): SceneSetup {
    const N = 48;
    const worlds: World[] = [];
    const base: { m: number; x: V3; v: V3 }[] = [
      { m: 3, x: [1, 3, 0], v: [0, 0, 0] },
      { m: 4, x: [-2, -1, 0], v: [0, 0, 0] },
      { m: 5, x: [1, -1, 0], v: [0, 0, 0] },
    ];
    for (let i = 0; i < N; i++) {
      const w = new World({ rtol: 1e-12, atol: 1e-14, collisions: false, closeFactor: 0, ejectFactor: 6 });
      const col = hsv(i / N, 0.85, 1);
      const trail = { fade: 2.2, maxAge: 5, width: 0.012, intensity: 0.5, core: 0.12, color: col };
      base.forEach((b, k) => {
        const x: V3 = [...b.x];
        if (k === 0) x[0] += (i - N / 2) * 1e-9;
        w.add(star(`u${i}b${k}`, b.m, x, [...b.v], col, 0.03 * Math.cbrt(b.m), { trail, intensity: 0.06, spikes: 0, canEject: false }));
      });
      worlds.push(w);
    }
    let diverged = false;
    return {
      worlds,
      duration: 60,
      camera: { elevation: 62, orbitSpeed: 1.2, margin: 1.12, holdTime: 3, minRadius: 2.2 },
      director: { baseRate: 3.1, maxScreenSpeed: 1.3, minRate: 0.08, startHold: 3, easeIn: 1.5, outro: 9 },
      trailSpacing: 0.01,
      captions: [
        { at: 0.4, text: 'The Butterfly Effect', sub: '48 universes · identical to one part in a billion', duration: 5.5, kind: 'title' },
        { at: 0.4, text: 'Three-body problem', duration: 5.5, kind: 'kicker' },
        { at: 12, text: 'They all agree…', sub: 'every universe follows the same path', duration: 4.5, kind: 'caption' },
        { on: 'diverge', delay: 0.2, text: 'Until they don\'t', sub: 'a billionth of a difference · 48 different fates', duration: 6, kind: 'caption' },
      ],
      onFrame: (rt) => {
        if (diverged) return;
        const ref = rt.worlds[0].bodies;
        let maxd = 0;
        for (const w of rt.worlds)
          for (let b = 0; b < 3; b++) maxd = Math.max(maxd, Math.hypot(w.bodies[b].x[0] - ref[b].x[0], w.bodies[b].x[1] - ref[b].x[1]));
        if (maxd > 0.25) {
          diverged = true;
          rt.markEvent('diverge');
          rt.resolve('diverge');
          rt.director.slowmo(rt.clock, 0.25, 1.2, 0.3, 2.5);
        }
      },
    };
  },
};

/** Random bound triple, re-rolled until it resolves with an ejection in a reasonable time. */
export const randomChaos: SceneDef = {
  id: 'chaos',
  title: 'Random Chaos',
  subtitle: 'A new three-body system every seed',
  blurb: 'Random masses and positions. Watch them fight until one star is thrown out.',
  category: 'Three-Body',
  seeded: true,
  build({ seed }): SceneSetup {
    const make = (s: number) => {
      const rng = new Rng(s);
      const w = new World({ rtol: 1e-11, atol: 1e-13, collisions: true, ejectFactor: 5, closeFactor: 0.08 });
      const cols = [PALETTE.cyan, PALETTE.magenta, PALETTE.gold, PALETTE.lime, PALETTE.violet, PALETTE.amber];
      const pick = rng.int(cols.length);
      const ms = [0, 1, 2].map(() => rng.range(0.7, 1.6));
      const M = ms[0] + ms[1] + ms[2];
      const spin = rng.next() < 0.5 ? 1 : -1;
      const f = rng.range(0.3, 0.6);
      const base = rng.range(0, 2 * Math.PI);
      for (let k = 0; k < 3; k++) {
        const r = rng.range(0.5, 1.5);
        const a = base + (k * 2 * Math.PI) / 3 + rng.normal() * 0.35;
        // Partial rotation about the centre plus random motion: bound, but not a head-on plunge.
        const vt = spin * f * Math.sqrt(M / r) * 0.6;
        const m = ms[k];
        w.add(
          star(
            `s${k}`,
            m,
            [r * Math.cos(a), r * Math.sin(a), rng.normal() * 0.05],
            [-vt * Math.sin(a) + rng.normal() * 0.12, vt * Math.cos(a) + rng.normal() * 0.12, rng.normal() * 0.02],
            cols[(pick + k * 2) % cols.length],
            0.03 * Math.cbrt(m),
            { trail: { fade: 2.5, maxAge: 7, width: 0.014, intensity: 1.4, core: 0.6 }, collide: 0.012 * Math.cbrt(m) },
          ),
        );
      }
      w.centerOfMassFrame();
      return w;
    };
    // Pre-simulate (bodies only) to find a seed that resolves between t = 15 and 55 while
    // staying compact enough to frame nicely.
    let s = seed;
    let fallback = -1;
    let found = false;
    for (let tries = 0; tries < 80 && !found; tries++, s += 7919) {
      const probe = make(s);
      let resolved = -1;
      let maxR = 0;
      while (probe.t < 60 && resolved < 0) {
        probe.advance(0.25);
        maxR = Math.max(maxR, probe.systemRadius());
        for (const e of probe.events) if (e.type === 'eject' || e.type === 'merge') resolved = e.t;
        probe.events.length = 0;
      }
      if (resolved > 18 && fallback < 0) fallback = s;
      if (resolved > 18 && maxR < 5) found = true;
    }
    if (found) s -= 7919;
    else if (fallback >= 0) s = fallback;
    else s = seed;
    const w = make(s);
    return {
      worlds: [w],
      duration: 75,
      particles: [...embers(w, { count: 5000, life: 0.8, speed: 0.025, size: 0.0045, intensity: 2.2, gravity: 0.1 }), sparks(24000, 4, 0.006)],
      camera: { elevation: 55, orbitSpeed: 2, margin: 1.2, holdTime: 3.5, minRadius: 0.9 },
      director: { baseRate: 1.8, maxScreenSpeed: 1.15, startHold: 2.4, easeIn: 1.4, outro: 6 },
      captions: [
        { at: 0.4, text: 'Three-body problem', duration: 4.5, kind: 'kicker' },
        { at: 0.4, text: `System #${seed}`, sub: 'random masses · random start', duration: 4.5, kind: 'title' },
        { on: 'eject', delay: 0.4, text: 'Ejected', sub: 'the system resolves into a binary + a runaway', duration: 5, kind: 'caption' },
        { on: 'merge', delay: 0.6, text: 'Collision', sub: 'two stars merge into one', duration: 5, kind: 'caption' },
      ],
      onEvent: (ev, rt) => {
        if (ev.type === 'eject' || ev.type === 'merge') rt.resolve(ev.type);
      },
    };
  },
};

export const THREE_BODY_SCENES: SceneDef[] = [
  pythagorean,
  figureEight,
  lagrangeCollapse,
  butterflyEffect,
  randomChaos,
  butterfly,
  moth,
  dragonfly,
  yinYang,
  goggles,
];

// Black-hole scenes: a lensed accretion disk, a gravitational-wave inspiral and merger,
// a tidal disruption event, and a chaotic triple of black holes.

import { blackbody, hex } from '../core/color.ts';
import { dist, type RGB, type V3 } from '../core/math.ts';
import { Rng } from '../core/rng.ts';
import { live, World, type Body } from '../physics/world.ts';
import type { ParticleGroupSpec } from '../render/particles.ts';
import type { Runtime } from '../engine/runtime.ts';
import { accretionDisk, diskInit, sparks } from './helpers.ts';
import type { SceneDef, SceneSetup } from './types.ts';

const BH_SKY = {
  exposure: 1.25,
  nebula: { intensity: 0.07, a: [0.12, 0.3, 0.95] as RGB, b: [0.95, 0.35, 0.18] as RGB, c: [0.9, 0.2, 0.6] as RGB, coverage: 0.02 },
  band: { intensity: 0.07, width: 0.25 },
  stars: { count: 22000, brightness: 1.2, bandFraction: 0.45 },
};

// ---------------------------------------------------------------------------------------------

export const gargantua: SceneDef = {
  id: 'black-hole',
  title: 'Anatomy of a Black Hole',
  subtitle: 'An accretion disk seen through warped spacetime',
  blurb: 'A lensed, Doppler-beamed accretion disk: the far side of the disk bends over the shadow.',
  category: 'Black Holes',
  build(): SceneSetup {
    const w = new World({ c: 1, collisions: false });
    const bh = w.add({ name: 'M', kind: 'blackhole', m: 1, x: [0, 0, 0], v: [0, 0, 0], ring: 1.6, trail: false });
    const normal: V3 = [0, 0, 1];
    return {
      worlds: [w],
      duration: 26,
      c: 1,
      particles: [
        accretionDisk(bh, { count: 400000, rIn: 6.2, rOut: 34, normal, thickness: 0.01, inflow: 0.0025, tempIn: 10000, size: 0.09, intensity: 0.5, doppler: 1, falloff: 2.3, p: 1.3 }),
      ],
      sky: BH_SKY,
      post: { bloomStrength: 0.7 },
      camera: {
        fixedCenter: [0, 0, 0],
        fixedRadius: 30,
        elevation: 7,
        azimuth: -100,
        orbitSpeed: 2.4,
        wobble: 1.5,
        wobblePeriod: 26,
        margin: 1,
        fov: 36,
        dolly: (t) => 1.08 - 0.22 * Math.min(1, t / 26),
      },
      director: { baseRate: 14, maxScreenSpeed: 0, startHold: 0, easeIn: 0.1 },
      shutter: 0.8,
      captions: [
        { at: 0.6, text: 'Black hole', duration: 5.5, kind: 'kicker' },
        { at: 0.6, text: 'Event Horizon', sub: 'light from behind the hole is bent over the top', duration: 5.5, kind: 'title' },
        { at: 13, text: 'Doppler beaming', sub: 'gas rushing toward us glows brighter and bluer', duration: 5, kind: 'caption' },
      ],
    };
  },
};


/**
 * Drive the screen-space gravitational-wave pattern from the tightest black-hole pair.
 * `visScale` shortens the physical wavelength so several wavefronts fit in frame.
 */
function gravWaves(rt: Runtime, dt: number, opts: { amp: number; visScale: number; omegaRef: number }) {
  const bhs = rt.primary.bodies.filter((b) => b.kind === 'blackhole');
  const c = rt.primary.c;
  let best: [Body, Body] | null = null;
  let bestOmega = 0;
  for (let i = 0; i < bhs.length; i++)
    for (let j = i + 1; j < bhs.length; j++) {
      const r = dist(bhs[i].x, bhs[j].x);
      const omega = Math.sqrt((bhs[i].m + bhs[j].m) / (r * r * r));
      if (omega > bestOmega) {
        bestOmega = omega;
        best = [bhs[i], bhs[j]];
      }
    }
  if (best) {
    const [A, B] = best;
    const M = A.m + B.m;
    const com: V3 = [0, 1, 2].map((k) => (A.m * A.x[k] + B.m * B.x[k]) / M) as V3;
    const phase = Math.atan2(A.x[1] - B.x[1], A.x[0] - B.x[0]);
    const lambda = ((Math.PI / bestOmega) * c) / opts.visScale;
    const amp = opts.amp * Math.pow(bestOmega / opts.omegaRef, 2 / 3);
    rt.vfx.gw = { pos: com, phase, wavelength: lambda, amp: Math.min(amp, opts.amp * 3.5), extent: dist(A.x, B.x) * 1.2 + 2 };
    (rt as any).__gwOmega = bestOmega;
  } else if (rt.vfx.gw) {
    // Ringdown: the last wavefronts keep expanding while fading.
    const omega = (rt as any).__gwOmega ?? 0.3;
    rt.vfx.gw.phase += omega * rt.lastSimDt;
    rt.vfx.gw.amp *= Math.exp(-dt / 0.7);
    rt.vfx.gw.extent += dt * 20;
    if (rt.vfx.gw.amp < 0.02) rt.vfx.gw = null;
  }
}

export const bbhMerger: SceneDef = {
  id: 'bh-merger',
  title: 'Two Black Holes Collide',
  subtitle: 'An inspiral, a chirp, and a ripple in spacetime',
  blurb: 'Two black holes spiral together radiating gravitational waves, then merge in a flash.',
  category: 'Black Holes',
  build(): SceneSetup {
    const c = 2;
    const w = new World({ c, gw: 14, gwMassLoss: 0.05, collisions: true });
    const m1 = 1, m2 = 0.75, M = m1 + m2, a0 = 12;
    const v = Math.sqrt(M / a0);
    const A = w.add({ kind: 'blackhole', name: 'A', m: m1, x: [(a0 * m2) / M, 0, 0], v: [0, (v * m2) / M, 0], ring: 1.2, trail: { fade: 60, maxAge: 200, width: 0.05, intensity: 0.35, core: 0.2, color: [0.55, 0.75, 1] } });
    const B = w.add({ kind: 'blackhole', name: 'B', m: m2, x: [(-a0 * m1) / M, 0, 0], v: [0, (-v * m1) / M, 0], ring: 1.2, trail: { fade: 60, maxAge: 200, width: 0.05, intensity: 0.35, core: 0.2, color: [1, 0.7, 0.45] } });
    // Recoil kick from asymmetric gravitational-wave emission.
    w.afterMerge = (res, a) => {
      const dir = [a.v[0] - res.v[0], a.v[1] - res.v[1], 0];
      const l = Math.hypot(dir[0], dir[1]) || 1;
      res.v[0] += (0.012 * dir[1]) / l;
      res.v[1] += (-0.012 * dir[0]) / l;
    };
    const normal: V3 = [0, 0, 1];
    const hill = (m: number) => 0.33 * a0 * Math.cbrt(m / M);
    return {
      worlds: [w],
      duration: 45,
      c,
      particles: [
        accretionDisk(A, { name: 'diskA', count: 140000, rIn: 3 * A.rs, rOut: hill(m1), normal, thickness: 0.015, inflow: 0.003, tempIn: 14000, size: 0.025, intensity: 0.3, falloff: 2.0, seed: 21, clumps: 90 }),
        accretionDisk(B, { name: 'diskB', count: 120000, rIn: 3 * B.rs, rOut: hill(m2), normal, thickness: 0.015, inflow: 0.003, tempIn: 7500, size: 0.025, intensity: 0.3, falloff: 2.0, seed: 22, clumps: 90 }),
      ],
      sky: BH_SKY,
      post: { bloomStrength: 0.8 },
      camera: { elevation: 11, wobble: 4, wobblePeriod: 30, orbitSpeed: 1.2, margin: 1.2, minRadius: 6.5, holdTime: 6, zoomIn: 0.35, fov: 36 },
      director: { baseRate: 60, maxScreenSpeed: 0.85, minRate: 0.02, startHold: 1.2, easeIn: 2, outro: 7 },
      shutter: 0.18,
      captions: [
        { at: 0.5, text: 'Black holes', duration: 5.5, kind: 'kicker' },
        { at: 0.5, text: 'The Inspiral', sub: 'two black holes · each lensing the universe behind it', duration: 5.5, kind: 'title' },
        { at: 12, text: 'Gravitational waves', sub: 'the orbit shrinks as spacetime carries energy away', duration: 5, kind: 'caption' },
        { on: 'merge', delay: 0.8, text: 'Merger', sub: '5% of their mass became gravitational waves', duration: 5.5, kind: 'caption' },
      ],
      onEvent: (ev, rt) => {
        if (ev.type === 'merge') rt.resolve('merge');
      },
      onFrame: (rt, dt) => gravWaves(rt, dt, { amp: 4.5, visScale: 3.5, omegaRef: Math.sqrt(M / (a0 * a0 * a0)) }),
    };
  },
};

export const tidalDisruption: SceneDef = {
  id: 'tde',
  title: 'Spaghettification',
  subtitle: 'A star wanders too close to a black hole',
  blurb: 'A tidal disruption event: a star is stretched into a stream; half is swallowed, half flung away.',
  category: 'Black Holes',
  build(): SceneSetup {
    const w = new World({ c: 1, collisions: false });
    const bh = w.add({ kind: 'blackhole', name: 'BH', m: 1, x: [0, 0, 0], v: [0, 0, 0], ring: 0.12, trail: false });
    const Rstar = 3.2, mStar = 0.01;
    const rt_ = Rstar * Math.cbrt(bh.m / mStar);
    const rp = 9.5;
    // Parabolic approach starting at r0.
    const r0 = 48, p = 2 * rp;
    const nu = -Math.acos(p / r0 - 1);
    const vs = Math.sqrt(bh.m / p);
    const pos: V3 = [r0 * Math.cos(nu), r0 * Math.sin(nu), 0];
    const vr = vs * Math.sin(nu), vt = vs * (1 + Math.cos(nu));
    const vel: V3 = [vr * Math.cos(nu) - vt * Math.sin(nu), vr * Math.sin(nu) + vt * Math.cos(nu), 0];
    const star = w.add({ kind: 'star', name: 'star', m: mStar, x: pos, v: vel, radius: 1.0, color: blackbody(5200), intensity: 0.55, spikes: 0.45, trail: { fade: 60, maxAge: 200, width: 0.35, intensity: 0.5, core: 0.3, color: blackbody(4200) }, canEject: false });
    const rng = new Rng(5);
    const starGroup: ParticleGroupSpec = {
      name: 'star',
      count: 60000,
      mode: 'rigid',
      colorMode: 'disk',
      color: [1, 0.8, 0.5],
      host: star,
      other: bh,
      tidalRadius: rt_,
      normal: [0, 0, 1],
      speed: 0.004,
      size: 0.11,
      intensity: 0.13,
      tempIn: 11000,
      rIn: 6,
      falloff: 2.2,
      ambient: 0.1,
      doppler: 0.9,
      circularize: 0.06,
      circRadius: 3.2 * rp,
      streak: 1,
      init: () => {
        const d = rng.unitVector();
        const r = Rstar * Math.pow(rng.next(), 0.55);
        return { x: [0, 0, 0], v: [d[0] * r, d[1] * r, d[2] * r], param: 4300 + 2200 * (1 - r / Rstar) + rng.normal() * 250, age: 0 };
      },
    };
    let phase = 0;
    let fadeT = 0;
    return {
      worlds: [w],
      duration: 40,
      c: 1,
      particles: [starGroup],
      sky: BH_SKY,
      post: { bloomStrength: 0.85 },
      camera: { elevation: 34, orbitSpeed: -1.8, margin: 1.2, minRadius: 21, holdTime: 3, zoomIn: 0.5, fov: 36 },
      director: { baseRate: 16, maxScreenSpeed: 0.5, minRate: 0.1, startHold: 1.5, easeIn: 1.5, outro: 12 },
      shutter: 0.6,
      captions: [
        { at: 0.5, text: 'Black holes', duration: 5.5, kind: 'kicker' },
        { at: 0.5, text: 'Spaghettification', sub: 'a star on a collision course', duration: 5.5, kind: 'title' },
        { on: 'disrupt', delay: 0.3, text: 'Torn apart', sub: 'tides stretch the star into a stream of gas', duration: 5, kind: 'caption' },
        { on: 'disrupt', delay: 9, text: 'Half falls in', sub: 'the rest is flung back into space', duration: 5.5, kind: 'caption' },
      ],
      onFrame: (rt, dt) => {
        const g = rt.renderer.particles.group('star');
        if (!g) return;
        if (phase === 0 && star.alive && dist(star.x, bh.x) < rt_) {
          phase = 1;
          g.release = 1;
          rt.markEvent('disrupt');
          rt.resolve('disrupt');
          rt.endAt = rt.clock + 20;
          rt.vfx.flash(rt.clock, [...star.x] as V3, [1, 0.85, 0.6], 3, 8, 1.6, 3, 1);
          rt.director.slowmo(rt.clock, 0.35, 1.2, 0.3, 2.0);
          rt.camera.addShake(0.35);
        } else if (phase === 1 && g.release === 2) {
          phase = 2;
          g.spec.host = bh;
        }
        if (phase >= 1 && star.alive) {
          fadeT += dt;
          star.intensity = Math.max(0, 0.55 * (1 - fadeT / 0.8));
          if (fadeT > 0.8) rt.primary.remove(star);
        }
        // The photon ring lights up as debris starts to circle the hole.
        const target = phase === 0 ? 0.12 : Math.min(1.1, 0.12 + (rt.clock - (rt.eventTimes.get('disrupt') ?? rt.clock)) * 0.12);
        bh.ring += (target - bh.ring) * Math.min(1, dt * 2);
      },
    };
  },
};

export const tripleBlackHoles: SceneDef = {
  id: 'bh-triple',
  title: 'Three Become One',
  subtitle: 'A third black hole crashes into a binary',
  blurb: 'A black-hole binary is invaded by a third. Chaos, two mergers, and one survivor.',
  category: 'Black Holes',
  seeded: true,
  build({ seed }): SceneSetup {
    const rng = new Rng(seed === 1 ? 7 : seed);
    const w = new World({ c: 2, gw: 0.5, gwMassLoss: 0.05, collisions: true, ejectFactor: 4, closeFactor: 0.1 });
    const mA = 1, mB = 0.8, mC = 0.65, a = 4, Mab = mA + mB;
    const vab = Math.sqrt(Mab / a);
    const ph = rng.range(0, 2 * Math.PI);
    const c = Math.cos(ph), s = Math.sin(ph);
    const tr = (col: RGB) => ({ fade: 25, maxAge: 80, width: 0.035, intensity: 0.45, core: 0.25, color: col });
    const A = w.add({ kind: 'blackhole', name: 'A', m: mA, x: [(a * mB / Mab) * c, (a * mB / Mab) * s, 0], v: [-(vab * mB / Mab) * s, (vab * mB / Mab) * c, 0], ring: 1, trail: tr([0.55, 0.75, 1]) });
    const B = w.add({ kind: 'blackhole', name: 'B', m: mB, x: [-(a * mA / Mab) * c, -(a * mA / Mab) * s, 0], v: [(vab * mA / Mab) * s, -(vab * mA / Mab) * c, 0], ring: 1, trail: tr([1, 0.72, 0.45]) });
    const R = 16, rp = rng.range(1.5, 4), M = Mab + mC;
    const E = -M / (R + rp);
    const vR = Math.sqrt(2 * (E + M / R));
    const L = Math.sqrt(2 * (E + M / rp)) * rp;
    const vt = L / R, vr = -Math.sqrt(Math.max(vR * vR - vt * vt, 0));
    const ang = rng.range(0, 2 * Math.PI), inc = rng.normal() * 0.25;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const sign = rng.next() < 0.5 ? 1 : -1;
    const C = w.add({ kind: 'blackhole', name: 'C', m: mC, x: [R * ca, R * sa, R * inc * 0.2], v: [vr * ca - sign * vt * sa, vr * sa + sign * vt * ca, 0], ring: 1, trail: tr([1, 0.5, 0.8]) });
    w.centerOfMassFrame();
    const disk = (b: Body, name: string, T: number, sd: number, rOut: number): ParticleGroupSpec =>
      accretionDisk(b, { name, count: 70000, rIn: 3 * b.rs, rOut, normal: [0, 0, 1], thickness: 0.03, inflow: 0.003, tempIn: T, size: 0.025, intensity: 0.9, falloff: 1.7, seed: sd, clumps: 30 });
    return {
      worlds: [w],
      duration: 60,
      c: 2,
      particles: [disk(A, 'dA', 12000, 31, 1.6), disk(B, 'dB', 8000, 32, 1.4), disk(C, 'dC', 10000, 33, 1.8), sparks(20000, 6, 0.02, 1.5)],
      sky: BH_SKY,
      post: { bloomStrength: 0.8 },
      camera: { elevation: 40, orbitSpeed: 1.8, margin: 1.3, minRadius: 5, holdTime: 5, zoomIn: 0.4, fov: 36 },
      director: { baseRate: 7, maxScreenSpeed: 0.7, minRate: 0.04, startHold: 1.5, easeIn: 1.5, outro: 7 },
      shutter: 0.5,
      captions: [
        { at: 0.5, text: 'Black holes', duration: 5.5, kind: 'kicker' },
        { at: 0.5, text: 'Three Become One', sub: 'a black-hole binary · and an intruder', duration: 5.5, kind: 'title' },
        { on: 'merge', delay: 0.8, text: 'First merger', sub: 'a burst of gravitational waves', duration: 4.5, kind: 'caption' },
        { on: 'final', delay: 0.8, text: 'One survivor', sub: 'three black holes · one horizon', duration: 5.5, kind: 'caption' },
      ],
      onEvent: (ev, rt) => {
        if (ev.type === 'merge' && rt.primary.bodies.filter((b) => b.kind === 'blackhole').length === 1) {
          rt.markEvent('final');
          rt.resolve('final');
        }
      },
      onFrame: (rt, dt) => gravWaves(rt, dt, { amp: 1.6, visScale: 3, omegaRef: Math.sqrt(Mab / (a * a * a)) }),
    };
  },
};


/** Hyperbolic two-body state: relative position/velocity at distance r0 on the incoming branch. */
function hyperbolicApproach(GM: number, vInf: number, rPeri: number, r0: number): { x: V3; v: V3 } {
  const a = GM / (vInf * vInf); // |a|
  const e = 1 + rPeri / a;
  const p = a * (e * e - 1);
  const nu = -Math.acos(Math.max(-1, Math.min(1, (p / r0 - 1) / e)));
  const k = Math.sqrt(GM / p);
  const vr = k * e * Math.sin(nu), vt = k * (1 + e * Math.cos(nu));
  const c = Math.cos(nu), s = Math.sin(nu);
  return { x: [r0 * c, r0 * s, 0], v: [vr * c - vt * s, vr * s + vt * c, 0] };
}

export const rogueBlackHole: SceneDef = {
  id: 'rogue',
  title: 'Rogue Black Hole',
  subtitle: 'A black hole wanders through a solar system',
  blurb: 'A black hole twice the mass of the Sun passes through the planets. Who survives?',
  category: 'Black Holes',
  build(): SceneSetup {
    const w = new World({ c: 5, collisions: true, closeFactor: 0, ejectFactor: 3, rtol: 1e-11 });
    const sun = w.add({ kind: 'star', name: 'Sun', m: 1, x: [0, 0, 0], v: [0, 0, 0], radius: 0.16, collide: 0.1, color: blackbody(5600), intensity: 1.3, spikes: 0.7, trail: { fade: 12, maxAge: 40, width: 0.02, intensity: 0.5, core: 0.3 }, canEject: false });
    const planets: { name: string; r: number; m: number; size: number; col: string }[] = [
      { name: 'Mercury', r: 0.75, m: 2e-7, size: 0.025, col: '#b9b2a8' },
      { name: 'Venus', r: 1.15, m: 2.4e-6, size: 0.035, col: '#f3d9a4' },
      { name: 'Earth', r: 1.6, m: 3e-6, size: 0.037, col: '#5aa7ff' },
      { name: 'Mars', r: 2.1, m: 3.2e-7, size: 0.03, col: '#ff6a3d' },
      { name: 'Jupiter', r: 3.9, m: 9.5e-4, size: 0.075, col: '#e3b889' },
      { name: 'Saturn', r: 5.2, m: 2.9e-4, size: 0.065, col: '#f5d27a' },
      { name: 'Uranus', r: 6.6, m: 4.4e-5, size: 0.05, col: '#8ff0ff' },
      { name: 'Neptune', r: 8.0, m: 5.2e-5, size: 0.05, col: '#4a6bff' },
    ];
    const rng = new Rng(11);
    const bodies = planets.map((pl) => {
      const ph = rng.range(0, Math.PI * 2);
      const v = Math.sqrt(1 / pl.r);
      const color = hex(pl.col);
      return w.add({
        kind: 'planet',
        name: pl.name,
        m: pl.m,
        x: [pl.r * Math.cos(ph), pl.r * Math.sin(ph), 0],
        v: [-v * Math.sin(ph), v * Math.cos(ph), 0],
        radius: pl.size,
        collide: pl.size * 0.4,
        color,
        intensity: 0.35,
        track: false,
        trail: { fade: 2 * Math.PI * Math.pow(pl.r, 1.5) * 0.35, maxAge: 60, width: 0.018, intensity: 0.9, core: 0.35, color },
      });
    });
    // The intruder: 2 solar masses, arriving at 0.35 (≈ 10 km/s-ish in these units) toward a 2.4 AU pass.
    const Mbh = 2;
    const rel = hyperbolicApproach(1 + Mbh, 0.35, 2.4, 22);
    const bh = w.add({ kind: 'blackhole', name: 'BH', m: Mbh, x: rel.x, v: rel.v, ring: 0.4, track: false, canEject: false, trail: { fade: 20, maxAge: 60, width: 0.03, intensity: 0.4, core: 0.2, color: [0.6, 0.7, 1] } });
    w.centerOfMassFrame();

    const belt = (name: string, rIn: number, rOut: number, count: number, seed: number): ParticleGroupSpec => ({
      name,
      count,
      mode: 'free',
      colorMode: 'lit',
      color: hex('#8a7a6a'),
      color2: hex('#6a7a9a'),
      size: 0.012,
      intensity: 0.06,
      ambient: 0.05,
      lightSoftening: 0.4,
      streak: 0.5,
      init: diskInit({ seed, center: sun.x, vel: sun.v, M: 1, rIn, rOut, thickness: 0.03, p: 1, jitter: 0.02 }),
    });

    let tallied = false;
    let closest = Infinity;
    return {
      worlds: [w],
      duration: 55,
      c: 5,
      particles: [belt('asteroids', 2.6, 3.3, 70000, 5), belt('kuiper', 9.0, 11.5, 70000, 6), sparks(12000, 3, 0.02, 2)],
      sky: { ...BH_SKY, exposure: 1 },
      camera: { elevation: 48, orbitSpeed: 1.2, margin: 1, minRadius: 10.5, holdTime: 6, zoomIn: 0.25, zoomOut: 0.8, pan: 0.6, fov: 38 },
      director: { baseRate: 2.4, maxScreenSpeed: 0, startHold: 1.4, easeIn: 1.5, outro: 7 },
      shutter: 0.5,
      trailSpacing: 0.01,
      labels: [
        ...bodies.filter((_, i) => i === 2 || i === 4).map((b) => ({ body: b, text: b.name, from: 1, to: 6 })),
        { body: bh, text: 'black hole · 2 M☉', from: 6.5, to: 11 },
      ],
      captions: [
        { at: 0.5, text: 'Black holes', duration: 5.5, kind: 'kicker' },
        { at: 0.5, text: 'Rogue Black Hole', sub: 'what if one passed through the solar system?', duration: 5.5, kind: 'title' },
      ],
      onEvent: (ev, rt) => {
        if (ev.type === 'merge') {
          const victim = ev.a.kind === 'planet' ? ev.a : ev.b.kind === 'planet' ? ev.b : null;
          if (!victim) return; // sun + BH: default fireworks
          rt.vfx.flash(rt.clock, [...ev.pos] as V3, victim.color, 0.08, 10, 0.9, 3, 1);
          return true;
        }
        if (ev.type === 'eject') return true;
      },
      onFrame: (rt) => {
        const cur = live(sun);
        const hole = live(bh);
        const d = hole === cur ? 0 : dist(hole.x, cur.x);
        closest = Math.min(closest, d);
        // Once the intruder has passed and receded, classify each planet by what it is bound to.
        if (!tallied && closest < 6 && d > 17) {
          tallied = true;
          let ejected = 0, captured = 0, kept = 0, lost = 0;
          for (const p of bodies) {
            if (!p.alive) { lost++; continue; }
            const bound = (host: Body) => {
              const dx = p.x.map((x, k) => x - host.x[k]);
              const dv = p.v.map((v, k) => v - host.v[k]);
              const r = Math.hypot(dx[0], dx[1], dx[2]);
              return 0.5 * (dv[0] ** 2 + dv[1] ** 2 + dv[2] ** 2) - host.m / r < 0 && r < 30;
            };
            if (hole !== cur && bound(cur)) kept++;
            else if (bound(hole)) captured++;
            else ejected++;
          }
          const parts = [`${kept} still orbit the Sun`, captured ? `${captured} stolen by the black hole` : '', ejected ? `${ejected} flung into interstellar space` : '', lost ? `${lost} destroyed` : ''].filter(Boolean);
          rt.setup.captions!.push({ at: rt.clock + 0.3, text: 'The aftermath', sub: parts.join(' · '), duration: 6.5, kind: 'caption' });
          rt.resolve('aftermath');
        }
      },
    };
  },
};

export const BLACK_HOLE_SCENES: SceneDef[] = [gargantua, bbhMerger, tidalDisruption, tripleBlackHoles, rogueBlackHole];

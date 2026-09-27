// Reusable particle recipes for scenes.

import type { RGB, V3 } from '../core/math.ts';
import { cross, norm } from '../core/math.ts';
import { Rng } from '../core/rng.ts';
import type { Body, World } from '../physics/world.ts';
import type { ParticleGroupSpec, ParticleInit } from '../render/particles.ts';

/** Sparkling wakes shed by every star (weakly bound, short-lived). */
export function embers(
  world: World,
  opts: { count: number; life: number; speed: number; size: number; intensity?: number; gravity?: number; emitRadius?: number },
): ParticleGroupSpec[] {
  return world.bodies
    .filter((b) => b.kind === 'star')
    .map((b, i) => ({
      name: `embers${i}`,
      count: opts.count,
      mode: 'emitter' as const,
      colorMode: 'ember' as const,
      color: b.color,
      host: b,
      life: opts.life,
      speed: opts.speed,
      size: opts.size,
      intensity: opts.intensity ?? 1,
      gravity: opts.gravity ?? 0.05,
      emitRadius: opts.emitRadius ?? 1.2,
      streak: 1,
    }));
}

/** Pool for merger / collision debris (spawned by the runtime on 'merge'). */
export function sparks(count = 30000, life = 5, size = 0.006, intensity = 2.5): ParticleGroupSpec {
  return { name: 'sparks', count, mode: 'burst', colorMode: 'debris', color: [1, 0.8, 0.6], size, intensity, life, gravity: 1 };
}

function basisFor(n: V3): [V3, V3] {
  const u = norm(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const w = cross(n, u);
  return [u, w];
}

/**
 * Rotating disk of tracer particles around a centre of mass `M` (Keplerian, optionally
 * Plummer-softened). Used for dust clouds, galaxy disks and accretion disks.
 */
export function diskInit(opts: {
  seed: number;
  center?: V3;
  vel?: V3;
  normal?: V3;
  M: number;
  G?: number;
  rIn: number;
  rOut: number;
  thickness: number;
  /** Surface density power law Σ ∝ r^-p (p=1 → uniform in r). */
  p?: number;
  soft?: number;
  /** Paczyński–Wiita horizon radius for BH disks. */
  rs?: number;
  /** Fractional velocity dispersion. */
  jitter?: number;
  /** Spiral-arm modulation: number of arms and pitch (radians); 0 = none. */
  arms?: number;
  pitch?: number;
  armStrength?: number;
  /** Maps radius/angle to the particle colour parameter (inArm: sampled from a spiral arm). */
  param?: (r: number, phi: number, rng: Rng, inArm: boolean) => number;
  size?: (r: number, rng: Rng) => number;
  retrograde?: boolean;
  /** Number of gas clumps (sheared into streaks by differential rotation). */
  clumps?: number;
  clumpFraction?: number;
}): (i: number) => ParticleInit {
  const rng = new Rng(opts.seed);
  const G = opts.G ?? 1;
  const c = opts.center ?? [0, 0, 0];
  const cv = opts.vel ?? [0, 0, 0];
  const n = norm(opts.normal ?? [0, 0, 1]);
  const [u, w] = basisFor(n);
  const p = opts.p ?? 1;
  const soft = opts.soft ?? 0;
  const sign = opts.retrograde ? -1 : 1;
  const clumps: { r: number; phi: number; w: number }[] = [];
  for (let k = 0; k < (opts.clumps ?? 0); k++) {
    const u01 = rng.next();
    clumps.push({ r: opts.rIn * Math.pow(opts.rOut / opts.rIn, Math.pow(u01, 1.3)), phi: rng.range(0, Math.PI * 2), w: rng.range(0.03, 0.12) });
  }
  return () => {
    // Sample r from Σ ∝ r^-p between rIn and rOut: pdf ∝ r^(1-p).
    const a = 2 - p;
    const x = rng.next();
    const r =
      Math.abs(a) < 1e-6
        ? opts.rIn * Math.pow(opts.rOut / opts.rIn, x)
        : Math.pow(Math.pow(opts.rIn, a) + x * (Math.pow(opts.rOut, a) - Math.pow(opts.rIn, a)), 1 / a);
    let phi = rng.range(0, Math.PI * 2);
    let rr = r;
    let inArm = false;
    if (clumps.length && rng.next() < (opts.clumpFraction ?? 0.6)) {
      // Gas clumps: differential rotation shears them into streaks.
      const c = clumps[rng.int(clumps.length)];
      rr = Math.min(opts.rOut, Math.max(opts.rIn, c.r * (1 + rng.normal() * c.w)));
      phi = c.phi + rng.normal() * c.w * 2.5;
    } else if (opts.arms && opts.arms > 0 && rng.next() < (opts.armStrength ?? 0.6)) {
      // Logarithmic spiral arms: phi = ln(r)/tan(pitch) + arm offset, with scatter.
      const arm = rng.int(opts.arms);
      inArm = true;
      phi = Math.log(r / opts.rIn) / Math.tan(opts.pitch ?? 0.3) + (arm * 2 * Math.PI) / opts.arms + rng.normal() * 0.28;
    }
    const R = rr;
    const z = rng.normal() * opts.thickness * R;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const rh: V3 = [u[0] * cp + w[0] * sp, u[1] * cp + w[1] * sp, u[2] * cp + w[2] * sp];
    const th = cross(n, rh);
    let vc: number;
    if (opts.rs) vc = Math.sqrt(G * opts.M * R) / (R - opts.rs);
    else vc = Math.sqrt((G * opts.M * R * R) / Math.pow(R * R + soft * soft, 1.5));
    const j = opts.jitter ?? 0.02;
    const vr = rng.normal() * j * vc, vt = vc * (1 + rng.normal() * j), vz = rng.normal() * j * vc * 0.5;
    const pos: V3 = [c[0] + rh[0] * R + n[0] * z, c[1] + rh[1] * R + n[1] * z, c[2] + rh[2] * R + n[2] * z];
    const vel: V3 = [
      cv[0] + th[0] * vt * sign + rh[0] * vr + n[0] * vz,
      cv[1] + th[1] * vt * sign + rh[1] * vr + n[1] * vz,
      cv[2] + th[2] * vt * sign + rh[2] * vr + n[2] * vz,
    ];
    return { x: pos, v: vel, param: opts.param ? opts.param(R, phi, rng, inArm) : rng.next(), size: opts.size ? opts.size(R, rng) : undefined, age: 0 };
  };
}

/** Accretion disk around a black hole, recycled at the rim with slow viscous inflow. */
export function accretionDisk(
  bh: Body,
  opts: {
    name?: string;
    count: number;
    rIn: number;
    rOut: number;
    normal?: V3;
    thickness?: number;
    inflow?: number;
    tempIn?: number;
    doppler?: number;
    size?: number;
    intensity?: number;
    seed?: number;
    G?: number;
    color?: RGB;
    falloff?: number;
    /** Surface-density power law of the initial particle distribution. */
    p?: number;
    clumps?: number;
  },
): ParticleGroupSpec {
  const normal = opts.normal ?? [0, 0, 1];
  return {
    name: opts.name ?? 'disk',
    count: opts.count,
    mode: 'disk',
    colorMode: 'disk',
    color: opts.color ?? [1, 0.7, 0.4],
    host: bh,
    rIn: opts.rIn,
    rOut: opts.rOut,
    thickness: opts.thickness ?? 0.015,
    inflow: opts.inflow ?? 0.004,
    normal,
    tempIn: opts.tempIn ?? 16000,
    doppler: opts.doppler ?? 1,
    size: opts.size ?? 0.02,
    intensity: opts.intensity ?? 1.5,
    falloff: opts.falloff ?? 2.2,
    streak: 1,
    init: diskInit({
      seed: opts.seed ?? 11,
      center: bh.x,
      vel: bh.v,
      normal,
      M: bh.m,
      G: opts.G,
      rIn: opts.rIn,
      rOut: opts.rOut,
      thickness: opts.thickness ?? 0.015,
      p: opts.p ?? 1.4,
      rs: bh.rs,
      jitter: 0.004,
      size: (r) => Math.sqrt(r / opts.rIn),
      param: () => 0.5,
      clumps: opts.clumps ?? 140,
      clumpFraction: 0.55,
    }),
  };
}

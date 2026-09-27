import type { V3 } from '../core/math.ts';
import type { Body, World, WorldEvent } from '../physics/world.ts';
import type { ParticleGroupSpec } from '../render/particles.ts';
import type { PostSettings } from '../render/post.ts';
import type { SkyConfig } from '../render/sky.ts';
import type { Runtime } from '../engine/runtime.ts';

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface CameraConfig {
  /** Field of view across the *shorter* frame dimension (degrees). */
  fov: number;
  /** Degrees above the reference (xy) plane. */
  elevation: number;
  azimuth: number;
  /** Degrees per second of slow orbiting. */
  orbitSpeed: number;
  /** Elevation oscillation amplitude (degrees) and period (s). */
  wobble: number;
  wobblePeriod: number;
  /** Framing radius multiplier (breathing room). */
  margin: number;
  minRadius: number;
  maxRadius: number;
  /** Seconds a framing radius is remembered (prevents pumping zoom). */
  holdTime: number;
  /** Spring rates (1/s). */
  zoomIn: number;
  zoomOut: number;
  pan: number;
  /** Fixed framing instead of automatic. */
  fixedCenter?: V3;
  fixedRadius?: number;
  /** Optional scripted radius multiplier over clip time (dolly). */
  dolly?: (t: number) => number;
  roll: number;
}

export interface DirectorConfig {
  /** Sim time per real second at cruise. */
  baseRate: number;
  /** Cap on how fast bodies may cross the frame (frame radii per second). */
  maxScreenSpeed: number;
  /** Lowest allowed rate as a fraction of baseRate. */
  minRate: number;
  /** Time constants for speeding up / slowing down (s). */
  rampUp: number;
  rampDown: number;
  /** Seconds of stillness at the start (title card), then ease-in duration. */
  startHold: number;
  easeIn: number;
  /** Seconds the camera keeps an ejected body in frame. */
  ejectFollow: number;
  /** After the resolution event, how long until the clip ends. */
  outro: number;
}

export interface CaptionCue {
  /** Show at a clip time (s) ... */
  at?: number;
  /** ... or this many seconds after the first event of a kind. */
  on?: 'eject' | 'merge' | 'periapsis' | 'resolve' | string;
  delay?: number;
  text: string;
  sub?: string;
  duration: number;
  kind: 'title' | 'caption' | 'kicker';
}

export interface BodyLabel {
  body: Body;
  text: string;
  /** Clip-time window. */
  from: number;
  to: number;
}

export interface SceneSetup {
  worlds: World[];
  particles?: ParticleGroupSpec[];
  sky?: DeepPartial<SkyConfig>;
  post?: Partial<PostSettings>;
  camera?: Partial<CameraConfig>;
  director?: Partial<DirectorConfig>;
  captions?: CaptionCue[];
  labels?: BodyLabel[];
  /** Maximum clip length (s). */
  duration: number;
  /** Trail sample spacing in world units. */
  trailSpacing?: number;
  /** Speed of light used for particle Doppler colouring. */
  c?: number;
  /** Motion-blur shutter as a fraction of the frame's sim step. */
  shutter?: number;
  starGain?: number;
  /** Particle integration sub-steps per frame. */
  substeps?: number;
  /** React to physics events (default reactions still run unless it returns true). */
  onEvent?: (ev: WorldEvent, rt: Runtime) => boolean | void;
  /** Called every frame after physics. */
  onFrame?: (rt: Runtime, dt: number) => void;
}

export interface SceneDef {
  id: string;
  title: string;
  subtitle: string;
  blurb: string;
  category: 'Three-Body' | 'N-Body' | 'Black Holes' | 'Galactic';
  seeded?: boolean;
  build(ctx: { seed: number }): SceneSetup;
}

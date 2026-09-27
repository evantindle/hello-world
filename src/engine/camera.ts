// Cinematic auto-framing camera: critically damped follow, slow orbit, breathing elevation, shake.

import { cross, mat4, mul4, norm, perspective, springStep, viewFromBasis, type V3 } from '../core/math.ts';
import type { CameraConfig } from '../scenes/types.ts';

export const DEFAULT_CAMERA: CameraConfig = {
  fov: 34,
  elevation: 32,
  azimuth: -70,
  orbitSpeed: 2.2,
  wobble: 5,
  wobblePeriod: 23,
  margin: 1.2,
  minRadius: 0.1,
  maxRadius: 1e9,
  holdTime: 3.5,
  zoomIn: 0.9,
  zoomOut: 2.6,
  pan: 1.6,
  roll: 0,
};

export class CinematicCamera {
  cfg: CameraConfig;
  center: V3 = [0, 0, 0];
  private centerVel: V3 = [0, 0, 0];
  radius = 1;
  private radiusVel = 0;
  private history: { t: number; r: number }[] = [];
  clock = 0;
  shake = 0;
  /** Manual adjustments from the user (degrees / multiplier). */
  userYaw = 0;
  userPitch = 0;
  userZoom = 1;
  private initialized = false;

  // Outputs
  pos: V3 = [0, 0, 1];
  right: V3 = [1, 0, 0];
  up: V3 = [0, 1, 0];
  fwd: V3 = [0, 0, -1];
  fovY = 0.6;
  tanHalfX = 0.3;
  tanHalfY = 0.3;
  near = 0.01;
  far = 1000;
  dist = 1;

  constructor(cfg: CameraConfig) {
    this.cfg = cfg;
  }

  /** Snap to a framing target without smoothing. */
  snap(center: V3, radius: number) {
    this.center = [...center] as V3;
    this.centerVel = [0, 0, 0];
    this.radius = this.clampRadius(radius * this.cfg.margin);
    this.radiusVel = 0;
    this.history = [];
    this.initialized = true;
  }

  private clampRadius(r: number) {
    return Math.min(this.cfg.maxRadius, Math.max(this.cfg.minRadius, r));
  }

  update(dt: number, center: V3, radius: number) {
    const c = this.cfg;
    this.clock += dt;
    if (c.fixedCenter) center = c.fixedCenter;
    if (c.fixedRadius !== undefined) radius = c.fixedRadius;
    if (!this.initialized) this.snap(center, radius);
    // Remember the largest recent radius so periodic motion does not pump the zoom.
    this.history.push({ t: this.clock, r: radius });
    while (this.history.length && this.history[0].t < this.clock - c.holdTime) this.history.shift();
    let target = 0;
    for (const h of this.history) target = Math.max(target, h.r);
    target = this.clampRadius(target * c.margin);
    if (c.dolly) target *= c.dolly(this.clock);
    const w = target > this.radius ? c.zoomOut : c.zoomIn;
    [this.radius, this.radiusVel] = springStep(this.radius, this.radiusVel, target, w, dt);
    for (let k = 0; k < 3; k++) {
      [this.center[k], this.centerVel[k]] = springStep(this.center[k], this.centerVel[k], center[k], c.pan, dt);
    }
    this.shake *= Math.exp(-dt * 2.2);
  }

  addShake(amount: number) {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  /** Compute basis + projection for a target aspect ratio. */
  compute(aspect: number) {
    const c = this.cfg;
    const short = (c.fov * Math.PI) / 180;
    const tShort = Math.tan(short / 2);
    if (aspect < 1) {
      this.tanHalfX = tShort;
      this.tanHalfY = tShort / aspect;
    } else {
      this.tanHalfY = tShort;
      this.tanHalfX = tShort * aspect;
    }
    this.fovY = 2 * Math.atan(this.tanHalfY);
    const t = this.clock;
    const sh = this.shake;
    const n1 = Math.sin(t * 37.1) * 0.6 + Math.sin(t * 23.3 + 1.3) * 0.4;
    const n2 = Math.sin(t * 29.7 + 2.1) * 0.6 + Math.sin(t * 41.9 + 0.3) * 0.4;
    const az = ((c.azimuth + c.orbitSpeed * t + this.userYaw + sh * n1 * 0.6) * Math.PI) / 180;
    const elDeg = c.elevation + c.wobble * Math.sin((2 * Math.PI * t) / c.wobblePeriod) + this.userPitch + sh * n2 * 0.6;
    const el = (Math.max(-89.5, Math.min(89.5, elDeg)) * Math.PI) / 180;
    const back: V3 = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    const fwd: V3 = [-back[0], -back[1], -back[2]];
    let right: V3 = [-Math.sin(az), Math.cos(az), 0];
    let up = cross(right, fwd);
    const roll = ((c.roll + sh * Math.sin(t * 17.3) * 0.4) * Math.PI) / 180;
    if (roll !== 0) {
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const r2: V3 = [right[0] * cr + up[0] * sr, right[1] * cr + up[1] * sr, right[2] * cr + up[2] * sr];
      const u2: V3 = [up[0] * cr - right[0] * sr, up[1] * cr - right[1] * sr, up[2] * cr - right[2] * sr];
      right = r2;
      up = u2;
    }
    const halfMin = Math.atan(Math.min(this.tanHalfX, this.tanHalfY));
    const dist = (this.radius * this.userZoom) / Math.sin(halfMin);
    this.dist = dist;
    this.pos = [this.center[0] + back[0] * dist, this.center[1] + back[1] * dist, this.center[2] + back[2] * dist];
    this.fwd = norm(fwd);
    this.right = norm(right);
    this.up = norm(up);
    this.near = dist * 0.002;
    this.far = dist * 400;
  }

  viewProj(aspect: number): Float32Array {
    const proj = perspective(mat4(), this.fovY, aspect, this.near, this.far);
    const view = viewFromBasis(mat4(), this.pos, this.right, this.up, this.fwd);
    return mul4(mat4(), proj, view);
  }
}

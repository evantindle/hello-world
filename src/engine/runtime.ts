// A live scene: physics worlds + director + camera + effects, feeding the renderer.
// update(dt) is fully deterministic for a given dt sequence, which is what makes
// frame-exact video export possible.

import { mix as mixc } from '../core/color.ts';
import { dist, project, type RGB, type V3 } from '../core/math.ts';
import type { Body, StepSnapshot, World, WorldEvent } from '../physics/world.ts';
import type { SpriteInstance } from '../render/bodies.ts';
import { MAX_LENS } from '../render/glsl.ts';
import { B_CRIT } from '../render/lensing.ts';
import type { BodyFrame } from '../render/particles.ts';
import { DEFAULT_POST, type PostSettings } from '../render/post.ts';
import type { RenderFrame, Renderer } from '../render/renderer.ts';
import { DEFAULT_SKY, type SkyConfig } from '../render/sky.ts';
import type { Trail } from '../render/trails.ts';
import type { LensInfo, View } from '../render/view.ts';
import type { CameraConfig, DeepPartial, DirectorConfig, SceneDef, SceneSetup } from '../scenes/types.ts';
import { CinematicCamera, DEFAULT_CAMERA } from './camera.ts';
import { DEFAULT_DIRECTOR, Director } from './director.ts';
import type { LabelDraw, Overlay } from './overlay.ts';
import { Vfx } from './vfx.ts';

function deepMerge<T>(base: T, over: DeepPartial<T> | undefined): T {
  if (!over) return structuredClone(base);
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    const b = (base as any)[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && typeof v === 'object' && !Array.isArray(v) ? deepMerge(b, v as any) : v;
  }
  return out;
}

export interface RuntimeOptions {
  seed: number;
  /** Disable captions/labels. */
  captions?: boolean;
  /** Override clip duration (s). */
  duration?: number;
}

export class Runtime {
  readonly def: SceneDef;
  readonly setup: SceneSetup;
  readonly seed: number;
  readonly renderer: Renderer;
  readonly overlay: Overlay;
  worlds: World[];
  primary: World;
  camera: CinematicCamera;
  director: Director;
  vfx = new Vfx();
  post: PostSettings;
  sky: SkyConfig;
  clock = 0;
  frameIndex = 0;
  lastSimDt = 0;
  eventTimes = new Map<string, number>();
  trails = new Map<Body, Trail>();
  /** Clip time at which the clip ends. */
  endAt: number;
  private follow: { body: Body; until: number }[] = [];
  private trailSpacing: number;
  private spin = new Map<Body, V3>();
  /** Extra user-facing speed multiplier for the particle glow etc. */
  trailOpacity = 1;
  trailWidth = 1;
  paused = false;
  /** Skip GPU particle updates (fast timeline previews / pacing analysis). */
  skipParticles = false;
  /** Events seen this frame (for scene logic / tests). */
  frameEvents: WorldEvent[] = [];

  constructor(renderer: Renderer, overlay: Overlay, def: SceneDef, opts: RuntimeOptions) {
    this.renderer = renderer;
    this.overlay = overlay;
    this.def = def;
    this.seed = opts.seed;
    this.setup = def.build({ seed: opts.seed });
    const s = this.setup;
    this.worlds = s.worlds;
    this.primary = s.worlds[0];
    this.post = { ...DEFAULT_POST, ...(s.post ?? {}) };
    this.sky = deepMerge(DEFAULT_SKY, s.sky);
    const camCfg: CameraConfig = { ...DEFAULT_CAMERA, ...(s.camera ?? {}) };
    const dirCfg: DirectorConfig = { ...DEFAULT_DIRECTOR, ...(s.director ?? {}) };
    this.camera = new CinematicCamera(camCfg);
    this.director = new Director(dirCfg);
    this.endAt = opts.duration ?? s.duration;
    overlay.reset();
    overlay.enabled = opts.captions ?? true;

    renderer.sky.generate(this.sky);
    renderer.trails.reset();
    const R0 = Math.max(...this.worlds.map((w) => w.systemRadius()));
    this.trailSpacing = s.trailSpacing ?? R0 * 0.004;

    // Particles.
    renderer.particles.G = this.primary.G;
    renderer.particles.c = s.c ?? (Number.isFinite(this.primary.c) ? this.primary.c : 1);
    renderer.particles.substeps = s.substeps ?? 4;
    renderer.particles.gain = 1;
    renderer.particles.setup(s.particles ?? [], opts.seed);
    for (const g of s.particles ?? []) {
      if (g.mode === 'disk' && g.host) this.spin.set(g.host, g.normal ?? [0, 0, 1]);
    }

    for (const w of this.worlds) {
      w.onStep = (_world, snap) => this.recordStep(snap);
      this.recordTrails(w);
    }
    const f = this.framing();
    this.camera.snap(f.center, f.radius);
  }

  /** Associate a spin axis with a black hole (photon-ring Doppler asymmetry). */
  setSpin(b: Body, axis: V3) {
    this.spin.set(b, axis);
  }

  private trailFor(b: Body): Trail | null {
    if (!b.trail) return null;
    let t = this.trails.get(b);
    if (!t) {
      const created = this.renderer.trails.create(b, b.trail);
      if (!created) return null;
      t = created;
      this.trails.set(b, t);
    }
    return t;
  }

  /** Trail samples at every integrator step (dense through close encounters). */
  private recordStep(snap: StepSnapshot) {
    for (let j = 0; j < snap.bodies.length; j++) {
      const b = snap.bodies[j];
      if (!b.alive) continue;
      const t = this.trailFor(b);
      if (!t) continue;
      const o = 3 * j;
      t.record([snap.x[o], snap.x[o + 1], snap.x[o + 2]], [snap.v[o], snap.v[o + 1], snap.v[o + 2]], snap.t, this.trailSpacing);
    }
  }

  /** Trail live heads follow the displayed (interpolated) body positions. */
  private recordTrails(w: World) {
    for (const b of w.bodies) {
      const t = this.trailFor(b);
      if (t) t.record(b.x, b.v, w.t, this.trailSpacing);
    }
  }

  get done(): boolean {
    return this.clock >= this.endAt;
  }

  /** Resolution event: schedule the outro. */
  resolve(label = 'resolve') {
    if (this.director.resolvedAt !== null) return;
    this.director.resolvedAt = this.clock;
    this.markEvent(label);
    this.markEvent('resolve');
    this.endAt = Math.min(this.endAt, this.clock + this.director.cfg.outro);
  }

  markEvent(name: string) {
    if (!this.eventTimes.has(name)) this.eventTimes.set(name, this.clock);
  }

  /** Bodies the camera should keep in frame. */
  trackedBodies(): Body[] {
    const out: Body[] = [];
    for (const w of this.worlds)
      for (const b of w.bodies) {
        if (!b.track) continue;
        if (b.escaping && !this.follow.some((f) => f.body === b && this.clock < f.until)) continue;
        out.push(b);
      }
    return out;
  }

  framing(): { center: V3; radius: number; vcenter: V3 } {
    const bs = this.trackedBodies();
    if (!bs.length) return { center: this.camera.center, radius: this.camera.radius, vcenter: [0, 0, 0] };
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    let M = 0;
    const com: V3 = [0, 0, 0], vcom: V3 = [0, 0, 0];
    for (const b of bs) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], b.x[k]);
        hi[k] = Math.max(hi[k], b.x[k]);
        com[k] += b.m * b.x[k];
        vcom[k] += b.m * b.v[k];
      }
      M += b.m;
    }
    const center: V3 = [0, 1, 2].map((k) => 0.5 * (0.5 * (lo[k] + hi[k])) + 0.5 * (M > 0 ? com[k] / M : 0.5 * (lo[k] + hi[k]))) as V3;
    if (M > 0) for (let k = 0; k < 3; k++) vcom[k] /= M;
    let radius = 0;
    for (const b of bs) radius = Math.max(radius, dist(b.x, center) + b.radius * 2 + (b.kind === 'blackhole' ? b.rs * 3 : 0));
    return { center, radius: Math.max(radius, 1e-6), vcenter: vcom };
  }

  private speedMetric(vcenter: V3): number {
    let vmax = 0;
    for (const b of this.trackedBodies()) {
      const v = Math.hypot(b.v[0] - vcenter[0], b.v[1] - vcenter[1], b.v[2] - vcenter[2]);
      vmax = Math.max(vmax, v);
    }
    return vmax / Math.max(this.camera.radius, 1e-9);
  }

  update(dt: number) {
    if (this.paused) dt = 0;
    this.clock += dt;
    this.frameIndex++;
    this.frameEvents = [];
    const f0 = this.framing();
    const simDt = dt > 0 ? this.director.update(dt, this.clock, this.speedMetric(f0.vcenter)) : 0;
    this.lastSimDt = simDt;

    // Snapshot for particle interpolation.
    const before = new Map<Body, { x: V3; v: V3 }>();
    for (const b of this.primary.bodies) before.set(b, { x: [...b.x] as V3, v: [...b.v] as V3 });

    const t0 = this.primary.t;
    if (simDt > 0) {
      for (const w of this.worlds) {
        w.advance(simDt);
        this.recordTrails(w);
      }
    }
    const advanced = this.primary.t - t0;
    this.lastSimDt = advanced;

    for (const w of this.worlds) {
      for (const ev of w.events) {
        this.frameEvents.push(ev);
        this.handleEvent(ev);
      }
      w.events.length = 0;
    }

    if (advanced > 0 && !this.skipParticles) {
      const frames: BodyFrame[] = [];
      for (const b of this.primary.bodies) {
        const s = before.get(b);
        frames.push({
          body: b,
          x0: s ? s.x : ([b.x[0] - b.v[0] * advanced, b.x[1] - b.v[1] * advanced, b.x[2] - b.v[2] * advanced] as V3),
          v0: s ? s.v : b.v,
          x1: b.x,
          v1: b.v,
        });
      }
      this.renderer.particles.update(frames, advanced);
    }

    const f = this.framing();
    this.camera.update(dt, f.center, f.radius);
    this.vfx.update(this.clock, dt);
    this.overlay.trigger(this.setup.captions ?? [], this.clock, this.eventTimes);
    this.setup.onFrame?.(this, dt);

    // Fade and recycle trails of bodies that merged away.
    for (const [b, t] of this.trails) {
      if (!b.alive) {
        t.body = null;
        t.opacity = Math.max(0, t.opacity - dt / 2.5);
        if (t.expired) this.trails.delete(b);
      }
    }
    this.renderer.trails.gc();
  }

  private handleEvent(ev: WorldEvent) {
    if (this.setup.onEvent?.(ev, this) === true) return;
    const c = this.clock;
    if (ev.type === 'merge') {
      this.markEvent('merge');
      const bh = ev.result.kind === 'blackhole';
      const col: RGB = bh ? [0.7, 0.82, 1.0] : mixc(ev.a.color, ev.b.color, 0.5);
      const R = Math.max(ev.a.radius, ev.b.radius, ev.result.rs * 2);
      const res = ev.result;
      // A tight white-hot core, a coloured bloom and an expanding hollow ring.
      this.vfx.flash(c, () => res.x, [1, 0.97, 0.92], R * 1.5, 45, 0.9, 1.5, 1);
      this.vfx.flash(c, () => res.x, col, R * 3, 6, 1.6, 2.5, 1);
      this.vfx.flash(c, [...ev.pos] as V3, col, R * 2, 3.5, 2.4, 9, 2);
      this.vfx.shock(c, ev.pos, bh ? 30 : 16, bh ? 1000 : 750, 2.6);
      this.vfx.pulseScreen(bh ? 0.3 : 0.18, col);
      this.camera.addShake(bh ? 0.7 : 0.45);
      this.director.slowmo(c, 0.12, 0.9, 0.08, 2.0);
      const g = this.renderer.particles.group('sparks');
      if (g) {
        const speed = Math.max(ev.relSpeed * 0.9, 0.05);
        this.renderer.particles.burst('sparks', {
          count: g.spec.count,
          center: ev.pos,
          vel: ev.vel,
          speed,
          life: g.spec.life ?? 4,
          radius: R * 0.6,
          flat: 0.55,
          normal: this.spin.get(ev.result) ?? [0, 0, 1],
        });
      }
    } else if (ev.type === 'eject') {
      this.markEvent('eject');
      this.follow.push({ body: ev.body, until: c + this.director.cfg.ejectFollow });
      this.director.slowmo(c, 0.4, 0.4, 0.2, 1.4);
    } else if (ev.type === 'periapsis') {
      this.markEvent('periapsis');
    }
  }

  // ---- rendering ----

  view(w: number, h: number): View {
    const cam = this.camera;
    const aspect = w / h;
    cam.compute(aspect);
    const vp = cam.viewProj(aspect);
    const focalPx = h / 2 / cam.tanHalfY;
    const lenses: LensInfo[] = [];
    const cands: { b: Body; size: number }[] = [];
    for (const wd of this.worlds)
      for (const b of wd.bodies) {
        if (b.kind !== 'blackhole' || b.rs <= 0) continue;
        const d = dist(b.x, cam.pos);
        cands.push({ b, size: b.rs / d });
      }
    cands.sort((a, b) => b.size - a.size);
    for (const { b } of cands.slice(0, MAX_LENS)) {
      const p = project(vp, b.x);
      const Dl = dist(b.x, cam.pos);
      const shadowPx = ((B_CRIT * b.rs) / Dl) * focalPx;
      const ringCol: RGB = [1.0 * b.ring, 0.78 * b.ring, 0.55 * b.ring];
      lenses.push({
        pos: b.x,
        rs: b.rs,
        scr: [(p.x * 0.5 + 0.5) * w, (p.y * 0.5 + 0.5) * h, p.w > 0 ? shadowPx : 0],
        ring: ringCol,
        ringWidth: 0.035,
        spin: this.spin.get(b) ?? [0, 0, 0],
      });
    }
    return {
      w,
      h,
      camPos: cam.pos,
      right: cam.right,
      up: cam.up,
      fwd: cam.fwd,
      fovY: cam.fovY,
      tanHalfX: cam.tanHalfX,
      tanHalfY: cam.tanHalfY,
      focalPx,
      viewProj: vp,
      pxScale: Math.min(w, h) / 1080,
      near: cam.near,
      far: cam.far,
      lenses,
      time: this.clock,
      simTime: this.primary.t,
    };
  }

  sprites(): SpriteInstance[] {
    const out: SpriteInstance[] = [];
    for (const w of this.worlds)
      for (const b of w.bodies) {
        if (b.kind === 'core') {
          // Galactic nuclei: soft unresolved glow.
          if (b.intensity > 0)
            out.push({ pos: b.x, radius: b.radius, color: b.color, intensity: b.intensity, spikes: 0, style: 1, seed: b.id, angle: 0 });
          continue;
        }
        if (b.kind !== 'star' && b.kind !== 'planet') continue;
        out.push({
          pos: b.x,
          radius: b.radius,
          color: b.color,
          intensity: 14 * b.intensity,
          spikes: b.spikes,
          style: 0,
          seed: b.id,
          angle: 0.35,
        });
      }
    this.vfx.sprites(this.clock, out);
    return out;
  }

  labels(v: View): LabelDraw[] {
    const out: LabelDraw[] = [];
    for (const l of this.setup.labels ?? []) {
      if (!l.body.alive) continue;
      const a = Math.min(1, Math.max(0, (this.clock - l.from) / 0.5)) * Math.min(1, Math.max(0, (l.to - this.clock) / 0.6));
      if (a <= 0) continue;
      const p = project(v.viewProj, l.body.x);
      if (p.w <= 0) continue;
      out.push({ x: (p.x * 0.5 + 0.5) * v.w, y: (1 - (p.y * 0.5 + 0.5)) * v.h, text: l.text, alpha: a });
    }
    return out;
  }

  /** Global fade in/out envelope for clips. */
  fade(): number {
    const fin = Math.min(1, this.clock / 0.6);
    const fout = Math.min(1, Math.max(0, (this.endAt - this.clock) / 1.2));
    return Math.min(fin, fout);
  }

  render(w: number, h: number, opts: { fadeOut?: boolean } = {}) {
    const r = this.renderer;
    r.resize(w, h);
    this.overlay.resize(w, h);
    const v = this.view(w, h);
    const dirty = this.overlay.draw(this.clock, this.labels(v));
    const frame: RenderFrame = {
      view: v,
      sprites: this.sprites(),
      now: this.primary.t,
      trailOpacity: this.trailOpacity,
      trailWidth: this.trailWidth,
      shutter: this.lastSimDt * (this.setup.shutter ?? 0.6),
      ripples: this.vfx.ripples(this.clock, v),
      post: this.post,
      flash: this.vfx.screenFlash,
      flashColor: this.vfx.screenFlashColor,
      fade: opts.fadeOut === false ? Math.min(1, this.clock / 0.6) : this.fade(),
      overlay: this.overlay.visible || dirty ? this.overlay.canvas : null,
      overlayDirty: dirty,
      starGain: this.setup.starGain ?? 1,
    };
    r.render(frame);
  }
}

// Application shell: owns the renderer and the live scene, sizes the canvas to the clip
// aspect ratio, runs the real-time loop, and exposes a small automation API.

import { Runtime } from './engine/runtime.ts';
import { Overlay } from './engine/overlay.ts';
import { Renderer } from './render/renderer.ts';
import { sceneById } from './scenes/index.ts';
import type { SceneDef } from './scenes/types.ts';

export interface AspectPreset {
  id: string;
  label: string;
  w: number;
  h: number;
}

export const ASPECTS: AspectPreset[] = [
  { id: '9:16', label: '9:16 · Reels / TikTok / Shorts', w: 1080, h: 1920 },
  { id: '1:1', label: '1:1 · Square', w: 1080, h: 1080 },
  { id: '4:5', label: '4:5 · Feed', w: 1080, h: 1350 },
  { id: '16:9', label: '16:9 · YouTube', w: 1920, h: 1080 },
];

export interface AppOptions {
  cubeSize?: number;
  /** Particle-count multiplier (e.g. 0.5 for slower machines / drafts). */
  particleScale?: number;
  /** Max internal pixels on the long edge for the live preview. */
  previewLongEdge?: number;
}

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly stage: HTMLElement;
  readonly renderer: Renderer;
  readonly overlay = new Overlay();
  runtime: Runtime | null = null;
  scene: SceneDef;
  seed = 1;
  aspect: AspectPreset = ASPECTS[0];
  captions = true;
  previewLongEdge: number;
  /** Set while exporting; the live loop pauses. */
  busy = false;
  autoRestart = true;
  onSceneChange: ((rt: Runtime) => void) | null = null;
  private last = 0;
  private restartAt = -1;
  fps = 60;
  private fpsAcc = 0;
  private fpsN = 0;
  /** Adaptive preview resolution (live view only; exports always use the exact size). */
  private previewMax: number;
  private slowTime = 0;
  private fastTime = 0;

  constructor(canvas: HTMLCanvasElement, stage: HTMLElement, opts: AppOptions = {}) {
    this.canvas = canvas;
    this.stage = stage;
    this.renderer = new Renderer(canvas, { cubeSize: opts.cubeSize ?? 1024 });
    this.previewLongEdge = opts.previewLongEdge ?? 1600;
    this.previewMax = this.previewLongEdge;
    this.renderer.particles.countScale = opts.particleScale ?? 1;
    this.scene = sceneById(null);
  }

  load(scene: SceneDef, seed = this.seed) {
    this.scene = scene;
    this.seed = seed;
    this.runtime = new Runtime(this.renderer, this.overlay, scene, { seed, captions: this.captions });
    this.restartAt = -1;
    this.onSceneChange?.(this.runtime);
  }

  restart() {
    this.load(this.scene, this.seed);
  }

  /** Canvas display size and internal resolution for the live preview. */
  layout(): { w: number; h: number } {
    const a = this.aspect;
    const sw = this.stage.clientWidth || window.innerWidth;
    const sh = this.stage.clientHeight || window.innerHeight;
    const ar = a.w / a.h;
    let cw = sw, ch = sw / ar;
    if (ch > sh) {
      ch = sh;
      cw = sh * ar;
    }
    this.canvas.style.width = `${Math.round(cw)}px`;
    this.canvas.style.height = `${Math.round(ch)}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = cw * dpr, h = ch * dpr;
    const long = Math.max(w, h);
    if (long > this.previewLongEdge) {
      w *= this.previewLongEdge / long;
      h *= this.previewLongEdge / long;
    }
    return { w: Math.round(w), h: Math.round(h) };
  }

  start() {
    const loop = (t: number) => {
      requestAnimationFrame(loop);
      if (this.busy) {
        this.last = t;
        return;
      }
      const dt = this.last ? Math.min((t - this.last) / 1000, 1 / 20) : 1 / 60;
      this.last = t;
      this.fpsAcc += dt;
      this.fpsN++;
      if (this.fpsAcc > 0.5) {
        this.fps = this.fpsN / this.fpsAcc;
        this.adaptPreview(this.fpsAcc);
        this.fpsAcc = 0;
        this.fpsN = 0;
      }
      this.tick(dt, t / 1000);
    };
    requestAnimationFrame(loop);
  }

  /** Trade preview resolution for smoothness on slower GPUs. */
  private adaptPreview(span: number) {
    if (this.fps < 42) {
      this.slowTime += span;
      this.fastTime = 0;
      if (this.slowTime > 1.5 && this.previewLongEdge > 720) {
        this.previewLongEdge = Math.max(720, Math.round(this.previewLongEdge * 0.82));
        this.slowTime = 0;
      }
    } else if (this.fps > 57) {
      this.fastTime += span;
      this.slowTime = 0;
      if (this.fastTime > 6 && this.previewLongEdge < this.previewMax) {
        this.previewLongEdge = Math.min(this.previewMax, Math.round(this.previewLongEdge * 1.12));
        this.fastTime = 0;
      }
    } else {
      this.slowTime = this.fastTime = 0;
    }
  }

  tick(dt: number, now = performance.now() / 1000) {
    const rt = this.runtime;
    if (!rt) return;
    if (rt.done && this.autoRestart) {
      if (this.restartAt < 0) this.restartAt = now + 1.2;
      if (now > this.restartAt) {
        this.restart();
        return;
      }
    } else {
      rt.update(dt);
    }
    const { w, h } = this.layout();
    rt.render(w, h);
  }
}

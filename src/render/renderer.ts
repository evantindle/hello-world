// Frame orchestration: sky → stars → trails → particles → sprites (HDR, additive)
// → distortion → bloom → tone-mapped composite with captions.

import type { RGB } from '../core/math.ts';
import { SpriteRenderer, type SpriteInstance } from './bodies.ts';
import { Fullscreen, Target, hdrOpts, type GL } from './gl.ts';
import { ParticleSystem } from './particles.ts';
import { Post, type PostSettings, type Ripple } from './post.ts';
import { Sky } from './sky.ts';
import { TrailRenderer } from './trails.ts';
import type { View } from './view.ts';

export interface RenderFrame {
  view: View;
  sprites: SpriteInstance[];
  /** Sim time used for trail ageing. */
  now: number;
  trailOpacity: number;
  trailWidth: number;
  /** Motion-blur shutter (sim time). */
  shutter: number;
  ripples: Ripple[];
  post: PostSettings;
  flash: number;
  flashColor: RGB;
  fade: number;
  overlay: HTMLCanvasElement | null;
  overlayDirty: boolean;
  starGain: number;
}

export interface RendererOptions {
  cubeSize?: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: GL;
  readonly fs: Fullscreen;
  readonly sky: Sky;
  readonly post: Post;
  readonly sprites: SpriteRenderer;
  readonly trails: TrailRenderer;
  readonly particles: ParticleSystem;
  private scene: Target;
  private overlayTex: WebGLTexture;
  private overlayVisible = false;
  w = 0;
  h = 0;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is required.');
    gl.getExtension('OES_texture_float_linear');
    this.gl = gl;
    this.fs = new Fullscreen(gl);
    this.sky = new Sky(gl, this.fs, opts.cubeSize ?? 1024);
    this.post = new Post(gl, this.fs);
    this.sprites = new SpriteRenderer(gl);
    this.trails = new TrailRenderer(gl);
    this.particles = new ParticleSystem(gl, this.fs);
    this.scene = new Target(gl, 4, 4, [hdrOpts(gl)]);
    this.overlayTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resize(w: number, h: number) {
    w = Math.max(16, Math.round(w));
    h = Math.max(16, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.scene.resize(w, h);
    this.post.resize(w, h);
  }

  render(f: RenderFrame) {
    const gl = this.gl;
    const v = f.view;
    this.scene.bind();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.sky.drawBackground(v);
    this.sky.drawStars(v, f.starGain);
    this.trails.draw(v, f.now, f.trailOpacity, f.trailWidth);
    this.particles.draw(v, f.shutter);
    this.sprites.draw(v, f.sprites);
    gl.disable(gl.BLEND);

    const src = this.post.applyDistortion(this.scene.tex[0], this.w, this.h, f.ripples);
    const bloom = this.post.bloom(src, this.w, this.h, f.post.bloomKaris);
    if (f.overlay && f.overlayDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, f.overlay);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.overlayVisible = true;
    }
    if (!f.overlay) this.overlayVisible = false;
    this.post.composite(src, bloom, this.overlayVisible ? this.overlayTex : null, this.w, this.h, f.post, {
      flash: f.flash,
      flashColor: f.flashColor,
      time: v.time,
      fade: f.fade,
    });
  }
}

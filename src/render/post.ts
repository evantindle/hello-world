// HDR post-processing: physically-based bloom (13-tap down / tent up mip chain),
// screen-space distortion (shockwaves, gravitational waves), and the final grade.

import { FULLSCREEN_VS, Fullscreen, Program, Target, hdrOpts, type GL } from './gl.ts';
import { HASH, HEADER } from './glsl.ts';

const DOWN_FS = HEADER + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uKaris;
in vec2 vUv;
out vec4 o;
vec3 S(vec2 off) { return texture(uSrc, vUv + off * uTexel).rgb; }
float kw(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)) * uKaris); }
void main() {
  vec3 a = S(vec2(-2, 2)), b = S(vec2(0, 2)), c = S(vec2(2, 2));
  vec3 d = S(vec2(-2, 0)), e = S(vec2(0, 0)), f = S(vec2(2, 0));
  vec3 g = S(vec2(-2, -2)), h = S(vec2(0, -2)), i = S(vec2(2, -2));
  vec3 j = S(vec2(-1, 1)), k = S(vec2(1, 1)), l = S(vec2(-1, -1)), m = S(vec2(1, -1));
  vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25;
  vec3 g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
  float w0 = 0.125 * kw(g0), w1 = 0.125 * kw(g1), w2 = 0.125 * kw(g2), w3 = 0.125 * kw(g3), w4 = 0.5 * kw(g4);
  vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  o = vec4(max(col, vec3(0.0)), 1.0);
}`;

const UP_FS = HEADER + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uWeight;
in vec2 vUv;
out vec4 o;
void main() {
  vec2 d = uTexel;
  vec3 s = texture(uSrc, vUv).rgb * 4.0;
  s += (texture(uSrc, vUv + vec2(-d.x, 0.0)).rgb + texture(uSrc, vUv + vec2(d.x, 0.0)).rgb
      + texture(uSrc, vUv + vec2(0.0, -d.y)).rgb + texture(uSrc, vUv + vec2(0.0, d.y)).rgb) * 2.0;
  s += texture(uSrc, vUv + vec2(-d.x, -d.y)).rgb + texture(uSrc, vUv + vec2(d.x, -d.y)).rgb
     + texture(uSrc, vUv + vec2(-d.x, d.y)).rgb + texture(uSrc, vUv + vec2(d.x, d.y)).rgb;
  o = vec4(s * (uWeight / 16.0), 1.0);
}`;

export const MAX_RIPPLES = 8;

const DISTORT_FS = HEADER + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uViewport;
uniform int uRippleN;
uniform vec4 uRipple[${MAX_RIPPLES}];   // xy centre px, z radius px, w amplitude px
uniform vec4 uRippleB[${MAX_RIPPLES}];  // x width px, y type (0 ring, 1 quadrupole chirp), z phase, w wavelength px
in vec2 vUv;
out vec4 o;
void main() {
  vec2 px = vUv * uViewport;
  vec2 disp = vec2(0.0);
  float glow = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uRippleN) break;
    vec4 R = uRipple[i];
    vec4 B = uRippleB[i];
    vec2 d = px - R.xy;
    float r = length(d) + 1e-4;
    vec2 dir = d / r;
    if (B.y < 0.5) {
      // Expanding shock ring: derivative-of-gaussian radial displacement.
      float x = (r - R.z) / B.x;
      float prof = -x * exp(-x * x);
      disp += dir * prof * R.w;
      glow += exp(-x * x) * abs(R.w) * 0.02;
    } else {
      // Outgoing quadrupolar gravitational wave: h ~ cos(2(phi - k r) + phase) / r.
      float phi = atan(d.y, d.x);
      float k = 6.2831853 / B.w;
      float env = smoothstep(R.z * 0.15, R.z * 0.5, r) * exp(-r / (R.z * 3.0));
      float wave = cos(2.0 * phi - k * r + B.z);
      disp += dir * wave * env * R.w;
    }
  }
  vec2 uv = (px + disp) / uViewport;
  vec3 c = texture(uSrc, uv).rgb;
  // Subtle prismatic split along the displacement.
  vec2 dd = disp / uViewport * 0.12;
  c.r = texture(uSrc, uv + dd).r;
  c.b = texture(uSrc, uv - dd).b;
  o = vec4(c * (1.0 + glow), 1.0);
}`;

const COMPOSITE_FS = HEADER + HASH + /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uOverlay;
uniform vec2 uBloomTexel;
uniform vec2 uViewport;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uCA;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uTime;
uniform float uSaturation;
uniform float uContrast;
uniform float uFade;
uniform int uTonemap;
uniform int uOverlayOn;
in vec2 vUv;
out vec4 o;

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 v) {
  const mat3 inM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                        0.0784335999999992, 0.878468636469772, 0.0784336,
                        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outM = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                         -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                         -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393, maxEv = 4.026069;
  v = inM * max(v, vec3(1e-10));
  v = clamp(log2(v), minEv, maxEv);
  v = (v - minEv) / (maxEv - minEv);
  v = agxContrast(v);
  // "Punchy" look.
  float l = dot(v, vec3(0.2126, 0.7152, 0.0722));
  v = pow(max(v, vec3(0.0)), vec3(1.25));
  v = l + (v - l) * 1.35;
  v = outM * v;
  return clamp(v, 0.0, 1.0); // display-referred (already encoded)
}
vec3 aces(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = inM * c;
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(outM * (a / b), 0.0, 1.0);
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 bloomTap(vec2 uv) {
  vec2 d = uBloomTexel;
  vec3 s = texture(uBloom, uv).rgb * 4.0;
  s += (texture(uBloom, uv + vec2(-d.x, 0.0)).rgb + texture(uBloom, uv + vec2(d.x, 0.0)).rgb
      + texture(uBloom, uv + vec2(0.0, -d.y)).rgb + texture(uBloom, uv + vec2(0.0, d.y)).rgb) * 2.0;
  s += texture(uBloom, uv + vec2(-d.x, -d.y)).rgb + texture(uBloom, uv + vec2(d.x, -d.y)).rgb
     + texture(uBloom, uv + vec2(-d.x, d.y)).rgb + texture(uBloom, uv + vec2(d.x, d.y)).rgb;
  return s / 16.0;
}
void main() {
  vec2 uv = vUv;
  vec2 dc = uv - 0.5;
  vec3 col;
  if (uCA > 0.0) {
    col.r = texture(uScene, uv - dc * uCA).r;
    col.g = texture(uScene, uv).g;
    col.b = texture(uScene, uv + dc * uCA).b;
  } else {
    col = texture(uScene, uv).rgb;
  }
  col += bloomTap(uv) * uBloomStrength;
  col += uFlashColor * uFlash;
  col *= uExposure;
  // Vignette (in scene-referred space so highlights survive).
  float asp = uViewport.x / uViewport.y;
  vec2 vq = dc * vec2(asp, 1.0) / max(asp, 1.0);
  col *= mix(1.0, smoothstep(0.95, 0.15, length(vq)), uVignette);
  vec3 disp = uTonemap == 0 ? agx(col) : toSrgb(aces(col));
  // Grade in display space.
  float l = dot(disp, vec3(0.2126, 0.7152, 0.0722));
  disp = mix(vec3(l), disp, uSaturation);
  disp = clamp((disp - 0.5) * uContrast + 0.5, 0.0, 1.0);
  if (uOverlayOn == 1) {
    vec4 ov = texture(uOverlay, vec2(uv.x, 1.0 - uv.y));
    disp = disp * (1.0 - ov.a) + ov.rgb;
  }
  disp *= uFade;
  // Film grain + dither to kill banding in smooth glows.
  vec2 fc = gl_FragCoord.xy;
  float t = fract(uTime * 7.31);
  float g = hash12(fc + t * 911.0) + hash12(fc * 1.37 + t * 419.0) - 1.0;
  disp += g * uGrain * (0.35 + 0.65 * (1.0 - l));
  disp += (hash12(fc + t * 97.0) - 0.5) / 255.0;
  o = vec4(disp, 1.0);
}`;

export interface PostSettings {
  bloomStrength: number;
  bloomKaris: number;
  exposure: number;
  vignette: number;
  grain: number;
  ca: number;
  saturation: number;
  contrast: number;
  tonemap: 'agx' | 'aces';
}

export const DEFAULT_POST: PostSettings = {
  bloomStrength: 0.9,
  bloomKaris: 0.15,
  exposure: 1.0,
  vignette: 0.55,
  grain: 0.025,
  ca: 0.0025,
  saturation: 1.05,
  contrast: 1.04,
  tonemap: 'agx',
};

export interface Ripple {
  x: number;
  y: number;
  radius: number;
  amp: number;
  width: number;
  type: 0 | 1;
  phase: number;
  wavelength: number;
}

export class Post {
  private gl: GL;
  private fs: Fullscreen;
  private down: Program;
  private up: Program;
  private comp: Program;
  private distort: Program;
  private mips: Target[] = [];
  distortTarget: Target;
  private rippleA = new Float32Array(MAX_RIPPLES * 4);
  private rippleB = new Float32Array(MAX_RIPPLES * 4);

  constructor(gl: GL, fs: Fullscreen) {
    this.gl = gl;
    this.fs = fs;
    this.down = new Program(gl, FULLSCREEN_VS, DOWN_FS, 'bloomDown');
    this.up = new Program(gl, FULLSCREEN_VS, UP_FS, 'bloomUp');
    this.comp = new Program(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite');
    this.distort = new Program(gl, FULLSCREEN_VS, DISTORT_FS, 'distort');
    this.distortTarget = new Target(gl, 4, 4, [hdrOpts(gl)]);
  }

  resize(w: number, h: number) {
    const gl = this.gl;
    for (const m of this.mips) m.dispose();
    this.mips = [];
    let mw = w, mh = h;
    const levels = Math.max(3, Math.min(9, Math.floor(Math.log2(Math.min(w, h))) - 2));
    for (let i = 0; i < levels; i++) {
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      this.mips.push(new Target(gl, mw, mh, [hdrOpts(gl)]));
    }
    this.distortTarget.resize(w, h);
  }

  /** Screen-space distortion; returns the texture to feed into bloom/composite. */
  applyDistortion(src: WebGLTexture, w: number, h: number, ripples: Ripple[]): WebGLTexture {
    if (!ripples.length) return src;
    const gl = this.gl;
    this.distortTarget.bind();
    gl.disable(gl.BLEND);
    const n = Math.min(ripples.length, MAX_RIPPLES);
    this.rippleA.fill(0);
    this.rippleB.fill(0);
    for (let i = 0; i < n; i++) {
      const r = ripples[i];
      this.rippleA.set([r.x, r.y, r.radius, r.amp], i * 4);
      this.rippleB.set([r.width, r.type, r.phase, r.wavelength], i * 4);
    }
    const p = this.distort.use();
    p.tex('uSrc', 0, src).f2('uViewport', w, h).i1('uRippleN', n).f4v('uRipple', this.rippleA).f4v('uRippleB', this.rippleB);
    this.fs.draw();
    return this.distortTarget.tex[0];
  }

  bloom(src: WebGLTexture, w: number, h: number, karis: number): WebGLTexture {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    let srcTex = src, sw = w, sh = h;
    const d = this.down.use();
    this.mips.forEach((m, i) => {
      m.bind();
      d.tex('uSrc', 0, srcTex).f2('uTexel', 1 / sw, 1 / sh).f1('uKaris', i === 0 ? karis : 0);
      this.fs.draw();
      srcTex = m.tex[0];
      sw = m.w;
      sh = m.h;
    });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const u = this.up.use();
    for (let i = this.mips.length - 2; i >= 0; i--) {
      const small = this.mips[i + 1];
      this.mips[i].bind();
      u.tex('uSrc', 0, small.tex[0]).f2('uTexel', 1 / small.w, 1 / small.h).f1('uWeight', 1.0);
      this.fs.draw();
    }
    gl.disable(gl.BLEND);
    return this.mips[0].tex[0];
  }

  composite(
    scene: WebGLTexture,
    bloom: WebGLTexture,
    overlay: WebGLTexture | null,
    w: number,
    h: number,
    s: PostSettings,
    extra: { flash: number; flashColor: [number, number, number]; time: number; fade: number },
  ) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    const m0 = this.mips[0];
    const p = this.comp.use();
    p.tex('uScene', 0, scene)
      .tex('uBloom', 1, bloom)
      .tex('uOverlay', 2, overlay)
      .i1('uOverlayOn', overlay ? 1 : 0)
      .f2('uBloomTexel', 1 / m0.w, 1 / m0.h)
      .f2('uViewport', w, h)
      .f1('uBloomStrength', s.bloomStrength / this.mips.length)
      .f1('uExposure', s.exposure)
      .f1('uVignette', s.vignette)
      .f1('uGrain', s.grain)
      .f1('uCA', s.ca)
      .f1('uFlash', extra.flash)
      .v3('uFlashColor', extra.flashColor)
      .f1('uTime', extra.time)
      .f1('uSaturation', s.saturation)
      .f1('uContrast', s.contrast)
      .f1('uFade', extra.fade)
      .i1('uTonemap', s.tonemap === 'agx' ? 0 : 1);
    this.fs.draw();
  }
}

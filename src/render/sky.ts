// Deep-space backdrop: procedural nebula cubemap (lensed per pixel) + crisp star sprites (lensed per vertex).

import { blackbody } from '../core/color.ts';
import { cross, norm, type RGB, type V3 } from '../core/math.ts';
import { Rng } from '../core/rng.ts';
import { FULLSCREEN_VS, Fullscreen, Program, type GL } from './gl.ts';
import { CAMERA, HASH, HEADER, LENS, OCCLUSION, MAX_LENS, NOISE } from './glsl.ts';
import { buildDeflectionLUT, LUT_QMAX, LUT_QMIN, LUT_SIZE } from './lensing.ts';
import { setViewUniforms, type View } from './view.ts';

export interface SkyConfig {
  seed: number;
  /** Overall sky gain. */
  exposure: number;
  ambient: RGB;
  nebula: {
    a: RGB;
    b: RGB;
    c: RGB;
    intensity: number;
    scale: number;
    /** Higher = less sky covered by gas. */
    coverage: number;
    dust: number;
  };
  band: {
    normal: V3;
    width: number;
    intensity: number;
    color: RGB;
  };
  stars: {
    count: number;
    brightness: number;
    /** Fraction of stars concentrated in the galactic band. */
    bandFraction: number;
  };
}

export const DEFAULT_SKY: SkyConfig = {
  seed: 7,
  exposure: 1,
  ambient: [0.0009, 0.0011, 0.0022],
  nebula: {
    a: [0.1, 0.25, 0.9],
    b: [0.9, 0.12, 0.45],
    c: [1.0, 0.55, 0.2],
    intensity: 0.05,
    scale: 1.6,
    coverage: 0.05,
    dust: 0.7,
  },
  band: { normal: norm([0.3, 0.2, 1]), width: 0.22, intensity: 0.05, color: [1.0, 0.86, 0.72] },
  stars: { count: 14000, brightness: 1, bandFraction: 0.35 },
};

const NEBULA_FS = HEADER + HASH + NOISE + /* glsl */ `
uniform int uFace;
uniform float uSize;
uniform vec3 uSeedOff;
uniform vec3 uNebA, uNebB, uNebC, uAmbient, uBandN, uBandColor;
uniform float uNebI, uNebScale, uCoverage, uDust, uBandW, uBandI;
out vec4 o;

vec3 faceDir(int f, vec2 st) {
  vec2 c = st * 2.0 - 1.0;
  if (f == 0) return vec3(1.0, -c.y, -c.x);
  if (f == 1) return vec3(-1.0, -c.y, c.x);
  if (f == 2) return vec3(c.x, 1.0, c.y);
  if (f == 3) return vec3(c.x, -1.0, -c.y);
  if (f == 4) return vec3(c.x, -c.y, 1.0);
  return vec3(-c.x, -c.y, -1.0);
}

void main() {
  vec3 d = normalize(faceDir(uFace, gl_FragCoord.xy / uSize));
  vec3 p = d * uNebScale + uSeedOff;
  vec3 w1 = vec3(fbm(p, 4), fbm(p + vec3(5.2, 1.3, 2.8), 4), fbm(p + vec3(1.7, 9.2, 4.4), 4));
  vec3 pw = p + 1.7 * w1;
  float n = fbm(pw, 6);
  float dens = smoothstep(uCoverage - 0.05, uCoverage + 0.5, n);
  float fil = ridged(pw * 1.9 + 3.0, 5);
  dens *= 0.35 + 1.1 * fil * fil;
  float cm = fbm(p * 0.8 + 11.0, 3) * 1.6 + 0.5;
  vec3 col = mix(uNebA, uNebB, smoothstep(0.05, 0.95, cm));
  col = mix(col, uNebC, smoothstep(0.55, 1.0, fil) * smoothstep(0.2, 0.7, n) * 0.8);
  float dust = smoothstep(0.05, 0.5, fbm(pw * 2.4 + 7.0, 5));
  vec3 neb = col * dens * uNebI * (1.0 - uDust * dust);
  // A bright, grainy galactic band with dark dust lanes.
  float lat = dot(d, uBandN);
  float bw2 = uBandW * uBandW;
  float band = exp(-lat * lat / bw2);
  float core = exp(-lat * lat / (bw2 * 0.12));
  float grain = fbm(d * 38.0 + uSeedOff, 4) * 0.5 + 0.5;
  float clouds = fbm(d * 7.0 + uSeedOff * 1.3, 5) * 0.5 + 0.5;
  float lanes = smoothstep(0.35, 0.7, fbm(d * 9.0 + vec3(3.0), 5) + 0.45) * core;
  vec3 mw = uBandColor * band * (0.25 + 1.2 * grain * grain * clouds) * (1.0 - 0.85 * lanes);
  o = vec4(uAmbient + neb + mw * uBandI, 1.0);
}`;

const SKY_FS = HEADER + LENS + CAMERA + /* glsl */ `
uniform samplerCube uNebula;
uniform sampler2D uDefl;
uniform float uSkyGain;
uniform vec2 uTanHalf;
uniform vec4 uLensRing[MAX_LENS];
uniform vec4 uLensSpin[MAX_LENS];
in vec2 vUv;
out vec4 o;
const float BC = 2.5980762;
const float LUTN = ${LUT_SIZE}.0;
const float LQ0 = ${Math.log(LUT_QMIN).toFixed(8)};
const float LQ1 = ${Math.log(LUT_QMAX).toFixed(8)};

float deflect(float b) {
  float q = b / BC - 1.0;
  if (q >= ${LUT_QMAX.toFixed(1)}) {
    float ib = 1.0 / b;
    return 2.0 * ib + 2.9452431 * ib * ib + 5.3333333 * ib * ib * ib;
  }
  float x = (log(max(q, ${LUT_QMIN.toExponential()})) - LQ0) / (LQ1 - LQ0);
  return texture(uDefl, vec2((x * (LUTN - 1.0) + 0.5) / LUTN, 0.5)).r;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 dir = normalize(uCamFwd + ndc.x * uTanHalf.x * uCamRight + ndc.y * uTanHalf.y * uCamUp);
  float vis = 1.0;
  vec3 ring = vec3(0.0);
  float pixAng = 1.0 / uFocalPx;
  for (int k = 0; k < MAX_LENS; k++) {
    if (k >= uLensN) break;
    vec3 toL = uLensPos[k].xyz - uCamPos;
    float Dl = length(toL);
    vec3 n = toL / Dl;
    float rs = uLensPos[k].w;
    float c = dot(dir, n);
    vec3 ax = cross(dir, n);
    float s = length(ax);
    float b = Dl * s / rs;
    float pxb = Dl * pixAng / rs;
    if (c > 0.0) {
      vis *= smoothstep(BC - pxb, BC + pxb, b);
      float q = b / BC - 1.0;
      float w = uLensRing[k].w;
      float g = (q - w) / (w * 0.9 + 1.5 * pxb / BC);
      vec3 e = normalize(dir - c * n);
      float dop = 1.0;
      if (uLensSpin[k].w > 0.0) {
        float approach = dot(cross(uLensSpin[k].xyz, e), -n);
        dop = pow(max(0.08, 1.0 + uLensSpin[k].w * approach), 3.0);
      }
      ring += uLensRing[k].rgb * exp(-g * g) * dop;
    }
    float alpha = deflect(max(b, BC * 1.0000002)) * (1.0 + c) * 0.5;
    if (s > 1e-9) {
      ax /= s;
      dir = dir * cos(alpha) + cross(ax, dir) * sin(alpha);
    }
  }
  vec3 col = texture(uNebula, dir).rgb * uSkyGain * vis + ring;
  o = vec4(col, 1.0);
}`;

const STAR_VS = HEADER + LENS + CAMERA + /* glsl */ `
layout(location = 0) in vec3 aDir;
layout(location = 1) in float aFlux;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aSpike;
uniform float uStarGain;
uniform float uSkyDist;
out vec2 vLocal;
out vec2 vCorner;
out vec3 vCol;
out vec4 vBehind;
out float vSpike;
void main() {
  vec2 c = quadCorner(gl_VertexID);
  float halfPx = (2.2 + 3.0 * clamp(sqrt(aFlux) * 0.08, 0.0, 1.0) + aSpike * 26.0) * uPxScale;
  vec3 p = uCamPos + aDir * uSkyDist;
  if (!secondaryCandidate(p)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float wpp = uSkyDist / uFocalPx;
  vec3 corner = p + (uCamRight * c.x + uCamUp * c.y) * halfPx * wpp;
  float valid;
  corner = lensMap(corner, vBehind, valid);
  vec4 clip = uViewProj * vec4(corner, 1.0);
  clip.z = clip.w * 0.99999;
  if (valid < 0.5) clip = vec4(2.0, 2.0, 2.0, 1.0);
  gl_Position = clip;
  vLocal = c * halfPx / uPxScale;
  vCorner = c;
  vCol = aColor * aFlux * uStarGain;
  vSpike = aSpike;
}`;

const STAR_FS = HEADER + LENS + OCCLUSION + /* glsl */ `
in vec2 vLocal;
in vec2 vCorner;
in vec3 vCol;
in vec4 vBehind;
in float vSpike;
out vec4 o;
void main() {
  float r2 = dot(vLocal, vLocal);
  float I = exp(-r2 * 1.15) + 0.018 / (1.0 + r2 * 0.35);
  if (vSpike > 0.0) {
    vec2 a = abs(vLocal);
    float sx = exp(-a.y * 1.7) * exp(-a.x * 0.09);
    float sy = exp(-a.x * 1.7) * exp(-a.y * 0.09);
    I += vSpike * 0.35 * (sx + sy);
  }
  float edge = smoothstep(1.0, 0.75, max(abs(vCorner.x), abs(vCorner.y)));
  o = vec4(vCol * I * edge * shadowOcclusion(vBehind), 0.0);
}`;

export class Sky {
  private gl: GL;
  private fs: Fullscreen;
  private nebProg: Program;
  private skyProg: Program;
  private starProg: Program;
  private cube: WebGLTexture | null = null;
  private cubeSize: number;
  private lut: WebGLTexture;
  private starVao: WebGLVertexArrayObject;
  private starBuf: WebGLBuffer;
  private starCount = 0;
  config: SkyConfig = DEFAULT_SKY;
  private ringBuf = new Float32Array(MAX_LENS * 4);
  private spinBuf = new Float32Array(MAX_LENS * 4);

  constructor(gl: GL, fs: Fullscreen, cubeSize: number) {
    this.gl = gl;
    this.fs = fs;
    this.cubeSize = cubeSize;
    this.nebProg = new Program(gl, FULLSCREEN_VS, NEBULA_FS, 'nebula');
    this.skyProg = new Program(gl, FULLSCREEN_VS, SKY_FS, 'sky');
    this.starProg = new Program(gl, STAR_VS, STAR_FS, 'stars');

    const lutData = buildDeflectionLUT();
    this.lut = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.lut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, LUT_SIZE, 1, 0, gl.RED, gl.FLOAT, lutData);
    const linearFloat = !!gl.getExtension('OES_texture_float_linear');
    const f = linearFloat ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.starVao = gl.createVertexArray()!;
    this.starBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.starVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf);
    const stride = 8 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 28);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
  }

  /** (Re)generate the nebula cubemap and star catalogue. */
  generate(cfg: SkyConfig) {
    this.config = cfg;
    this.generateCube(cfg);
    this.generateStars(cfg);
  }

  private generateCube(cfg: SkyConfig) {
    const gl = this.gl;
    const size = this.cubeSize;
    if (!this.cube) {
      this.cube = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cube);
      const levels = Math.floor(Math.log2(size)) + 1;
      gl.texStorage2D(gl.TEXTURE_CUBE_MAP, levels, gl.RGBA16F, size, size);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, size, size);
    gl.disable(gl.BLEND);
    const rng = new Rng(cfg.seed);
    const p = this.nebProg.use();
    const n = cfg.nebula, b = cfg.band;
    p.f1('uSize', size)
      .f3('uSeedOff', rng.range(-50, 50), rng.range(-50, 50), rng.range(-50, 50))
      .v3('uNebA', n.a).v3('uNebB', n.b).v3('uNebC', n.c)
      .f1('uNebI', n.intensity).f1('uNebScale', n.scale).f1('uCoverage', n.coverage).f1('uDust', n.dust)
      .v3('uAmbient', cfg.ambient)
      .v3('uBandN', norm(b.normal)).f1('uBandW', b.width).f1('uBandI', b.intensity).v3('uBandColor', b.color);
    for (let face = 0; face < 6; face++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, this.cube, 0);
      p.i1('uFace', face);
      this.fs.draw();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cube);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
  }

  private generateStars(cfg: SkyConfig) {
    const gl = this.gl;
    const rng = new Rng(cfg.seed * 7919 + 13);
    const N = cfg.stars.count;
    const data = new Float32Array(N * 8);
    const bn = norm(cfg.band.normal);
    const bu = norm(cross(bn, Math.abs(bn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const bv = cross(bn, bu);
    for (let i = 0; i < N; i++) {
      let d: V3;
      if (rng.next() < cfg.stars.bandFraction) {
        const phi = rng.range(0, Math.PI * 2);
        const lat = rng.normal() * cfg.band.width * 0.55;
        const cl = Math.cos(lat), sl = Math.sin(lat);
        d = norm([
          (bu[0] * Math.cos(phi) + bv[0] * Math.sin(phi)) * cl + bn[0] * sl,
          (bu[1] * Math.cos(phi) + bv[1] * Math.sin(phi)) * cl + bn[1] * sl,
          (bu[2] * Math.cos(phi) + bv[2] * Math.sin(phi)) * cl + bn[2] * sl,
        ]);
      } else {
        d = rng.unitVector();
      }
      // Euclidean source counts: N(>F) ∝ F^-3/2.
      const flux = Math.min(160, Math.pow(1 - rng.next() * 0.999999, -2 / 3));
      const r = rng.next();
      const T =
        r < 0.08 ? rng.range(2600, 3500)
        : r < 0.62 ? rng.range(3500, 5600)
        : r < 0.88 ? rng.range(5600, 7800)
        : rng.range(7800, 16000);
      const c = blackbody(T);
      const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const sat = 1.35;
      const col = c.map((x) => Math.max(0, lum + (x - lum) * sat)) as RGB;
      const spike = flux > 120 ? Math.min(1, (flux - 120) / 60) * 0.5 : 0;
      data.set([d[0], d[1], d[2], flux, col[0], col[1], col[2], spike], i * 8);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.starCount = N;
  }

  /** Fullscreen lensed nebula + black-hole shadows + photon rings. */
  drawBackground(v: View) {
    const gl = this.gl;
    const p = this.skyProg.use();
    setViewUniforms(p, v);
    this.ringBuf.fill(0);
    this.spinBuf.fill(0);
    v.lenses.slice(0, MAX_LENS).forEach((L, i) => {
      this.ringBuf.set([L.ring[0], L.ring[1], L.ring[2], L.ringWidth], i * 4);
      const s = norm(L.spin);
      this.spinBuf.set([s[0], s[1], s[2], s[0] || s[1] || s[2] ? 0.6 : 0], i * 4);
    });
    p.f4v('uLensRing', this.ringBuf).f4v('uLensSpin', this.spinBuf);
    p.f2('uTanHalf', v.tanHalfX, v.tanHalfY).f1('uSkyGain', this.config.exposure);
    p.tex('uNebula', 0, this.cube, gl.TEXTURE_CUBE_MAP).tex('uDefl', 1, this.lut);
    gl.disable(gl.BLEND);
    this.fs.draw();
  }

  /** Star sprites; additive. Draws primary images and one secondary image per lens. */
  drawStars(v: View, gain = 1) {
    const gl = this.gl;
    const p = this.starProg.use();
    p.f1('uStarGain', 0.07 * this.config.stars.brightness * this.config.exposure * gain);
    p.f1('uSkyDist', 1e5 * Math.max(1, Math.hypot(...v.camPos)));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.starVao);
    const passes = 1 + Math.min(v.lenses.length, MAX_LENS);
    for (let img = -1; img < passes - 1; img++) {
      setViewUniforms(p, v, img);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.starCount);
    }
    gl.bindVertexArray(null);
  }
}

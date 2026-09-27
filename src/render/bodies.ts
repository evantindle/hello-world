// Stars as HDR sprites: limb-darkened disk, corona, and JWST-style diffraction spikes.
// Flashes from events reuse the same sprite with no disk.

import type { RGB, V3 } from '../core/math.ts';
import { Program, type GL } from './gl.ts';
import { CAMERA, HEADER, LENS, OCCLUSION, MAX_LENS } from './glsl.ts';
import { setViewUniforms, type View } from './view.ts';

export interface SpriteInstance {
  pos: V3;
  radius: number;
  color: RGB;
  intensity: number;
  spikes: number;
  /** 0 = star, 1 = soft flash (no disk), 2 = ring (shock), 3 = hollow flare. */
  style: number;
  seed: number;
  /** Rotation of the spike pattern (radians). */
  angle: number;
}

const FLOATS = 12;

const VS = HEADER + LENS + CAMERA + /* glsl */ `
layout(location = 0) in vec4 aPosR;     // xyz, radius
layout(location = 1) in vec4 aColI;     // rgb, intensity
layout(location = 2) in vec4 aMisc;     // spikes, style, seed, angle
out vec2 vLocal;
out vec2 vCorner;
out vec3 vCol;
out float vI;
out vec4 vBehind;
out vec4 vMisc;
out float vExtent;
out float vRpx;
void main() {
  vec2 c = quadCorner(gl_VertexID);
  vec3 P = aPosR.xyz;
  float depth = dot(P - uCamPos, uCamFwd);
  if (depth <= 1e-6) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float rPx = aPosR.w * uFocalPx / depth;
  float I = aColI.w;
  float minPx = 1.5 * uPxScale;
  if (rPx < minPx) { I *= mix(1.0, rPx / minPx, 0.6); rPx = minPx; }
  float spikes = aMisc.x;
  float style = aMisc.y;
  // Extent of the quad in units of the apparent radius.
  float extent = style > 0.5 ? 1.6 : 6.0;
  float spikeLenPx = spikes * min(uViewport.y * 0.22, max(rPx * 30.0, 90.0 * uPxScale));
  float halfPx = max(rPx * extent, spikeLenPx);
  extent = halfPx / rPx;
  float ca = cos(aMisc.w), sa = sin(aMisc.w);
  vec2 rc = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);
  vec3 corner = P + (uCamRight * rc.x + uCamUp * rc.y) * halfPx * depth / uFocalPx;
  float valid = 1.0;
  if (style < 0.5) {
    corner = lensMap(corner, vBehind, valid);
  } else {
    // Flashes and flare rings are foreground glare: not lensed, never occluded.
    vBehind = vec4(0.0);
    if (uImageLens >= 0) valid = 0.0;
  }
  gl_Position = valid > 0.5 ? uViewProj * vec4(corner, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  vLocal = c * extent;
  vCorner = c;
  vCol = aColI.rgb;
  vI = I;
  vMisc = aMisc;
  vExtent = extent;
  vRpx = rPx;
}`;

const FS = HEADER + LENS + OCCLUSION + /* glsl */ `
in vec2 vLocal;
in vec2 vCorner;
in vec3 vCol;
in float vI;
in vec4 vBehind;
in vec4 vMisc;
in float vExtent;
in float vRpx;
out vec4 o;
float spike(vec2 p, float ang, float w, float L) {
  vec2 d = vec2(cos(ang), sin(ang));
  float along = abs(dot(p, d));
  float perp = abs(dot(p, vec2(-d.y, d.x)));
  float fall = max(0.0, 1.0 - along / L);
  return exp(-perp / w) * fall * fall * fall / (1.0 + along * 0.35);
}
void main() {
  float d = length(vLocal);
  float style = vMisc.y;
  vec3 col = vec3(0.0);
  if (style < 0.5) {
    // Star: limb-darkened white-hot disk + corona + wide halo.
    float disk = 1.0 - smoothstep(1.0 - 1.2 / vRpx, 1.0 + 0.8 / vRpx, d);
    float mu = sqrt(max(0.0, 1.0 - d * d));
    vec3 hot = mix(vCol, vec3(1.0), 0.55);
    col += hot * disk * (0.55 + 0.45 * mu) * 1.0;
    float corona = exp(-max(d - 1.0, 0.0) * 2.4) * (1.0 - disk);
    col += vCol * corona * 0.45;
    col += vCol * 0.06 / (1.0 + d * d * 0.5);
    if (vMisc.x > 0.0) {
      float L = vExtent;
      float w = 0.10 + 0.02 * L / 30.0;
      float s = 0.0;
      for (int k = 0; k < 3; k++) s += spike(vLocal, float(k) * 1.0471976 + 1.5707963, w, L);
      s += 0.35 * spike(vLocal, 0.0, w * 0.8, L * 0.55);
      col += mix(vCol, vec3(1.0), 0.35) * s * vMisc.x * 0.9;
    }
  } else if (style < 1.5) {
    // Flash: soft core, no hard disk.
    col = vCol * (exp(-d * d * 3.0) + 0.25 * exp(-d * 1.8));
  } else if (style < 2.5) {
    // Hollow flare ring (e.g. merger halo).
    float x = (d - 1.0) * 6.0;
    col = vCol * exp(-x * x);
  } else {
    col = vCol * exp(-d * d * 1.5);
  }
  float edge = smoothstep(1.0, 0.85, max(abs(vCorner.x), abs(vCorner.y)));
  o = vec4(col * vI * edge * shadowOcclusion(vBehind), 0.0);
}`;

export class SpriteRenderer {
  private gl: GL;
  private prog: Program;
  private vao: WebGLVertexArrayObject;
  private buf: WebGLBuffer;
  private data = new Float32Array(FLOATS * 256);

  constructor(gl: GL) {
    this.gl = gl;
    this.prog = new Program(gl, VS, FS, 'sprites');
    this.vao = gl.createVertexArray()!;
    this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const stride = FLOATS * 4;
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, stride, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
  }

  draw(v: View, sprites: SpriteInstance[]) {
    if (!sprites.length) return;
    const gl = this.gl;
    if (this.data.length < sprites.length * FLOATS) this.data = new Float32Array(sprites.length * FLOATS * 2);
    sprites.forEach((s, i) => {
      this.data.set(
        [s.pos[0], s.pos[1], s.pos[2], s.radius, s.color[0], s.color[1], s.color[2], s.intensity, s.spikes, s.style, s.seed, s.angle],
        i * FLOATS,
      );
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, sprites.length * FLOATS), gl.DYNAMIC_DRAW);
    const p = this.prog.use();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.vao);
    const passes = 1 + Math.min(v.lenses.length, MAX_LENS);
    for (let img = -1; img < passes - 1; img++) {
      setViewUniforms(p, v, img);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sprites.length);
    }
    gl.bindVertexArray(null);
  }
}

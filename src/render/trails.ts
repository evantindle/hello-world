// Light-painting trails: CPU ring buffers of samples streamed into a float texture,
// drawn as screen-space ribbons with centripetal Catmull–Rom smoothing on the GPU.

import type { RGB, V3 } from '../core/math.ts';
import type { Body, TrailStyle } from '../physics/world.ts';
import { Program, type GL } from './gl.ts';
import { CAMERA, HEADER, LENS, OCCLUSION } from './glsl.ts';
import { setViewUniforms, type View } from './view.ts';

export const TRAIL_CAP = 4096;
const SUBDIV = 4;

export class Trail {
  row: number;
  body: Body | null;
  style: TrailStyle;
  color: RGB;
  data = new Float32Array(TRAIL_CAP * 4);
  /** Ring index of the live head (newest point). */
  head = -1;
  count = 0;
  /** Monotonic push counter; used to find the dirty range to upload. */
  seq = 0;
  uploadedSeq = 0;
  private lastDir: V3 = [0, 0, 0];
  /** Sim time of the latest sample. */
  tLast = 0;
  /** Opacity multiplier (fade-out of orphaned trails, scene fades). */
  opacity = 1;

  constructor(row: number, body: Body, style: TrailStyle) {
    this.row = row;
    this.body = body;
    this.style = style;
    this.color = style.color ?? body.color;
  }

  private push(p: V3, t: number) {
    this.head = (this.head + 1) % TRAIL_CAP;
    const o = this.head * 4;
    this.data[o] = p[0];
    this.data[o + 1] = p[1];
    this.data[o + 2] = p[2];
    this.data[o + 3] = t;
    this.count = Math.min(this.count + 1, TRAIL_CAP);
    this.seq++;
  }

  private setHead(p: V3, t: number) {
    const o = this.head * 4;
    this.data[o] = p[0];
    this.data[o + 1] = p[1];
    this.data[o + 2] = p[2];
    this.data[o + 3] = t;
  }

  point(i: number): V3 {
    // i = 0 oldest .. count-1 newest
    const idx = (this.head - (this.count - 1) + i + TRAIL_CAP * 2) % TRAIL_CAP;
    return [this.data[idx * 4], this.data[idx * 4 + 1], this.data[idx * 4 + 2]];
  }

  time(i: number): number {
    const idx = (this.head - (this.count - 1) + i + TRAIL_CAP * 2) % TRAIL_CAP;
    return this.data[idx * 4 + 3];
  }

  /**
   * Record the body's position. The newest sample is a "live head" that follows the body;
   * it is committed once the path has moved far enough or turned enough.
   */
  record(x: V3, v: V3, t: number, spacing: number) {
    this.tLast = t;
    if (this.count < 2) {
      this.push(x, t);
      this.push(x, t);
      this.lastDir = [v[0], v[1], v[2]];
      return;
    }
    const prev = this.point(this.count - 2);
    const dx = x[0] - prev[0], dy = x[1] - prev[1], dz = x[2] - prev[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let turn = 0;
    const lv = Math.hypot(...this.lastDir), cv = Math.hypot(v[0], v[1], v[2]);
    if (lv > 0 && cv > 0) {
      const c = (this.lastDir[0] * v[0] + this.lastDir[1] * v[1] + this.lastDir[2] * v[2]) / (lv * cv);
      turn = Math.acos(Math.max(-1, Math.min(1, c)));
    }
    this.setHead(x, t);
    if (d > spacing || (turn > 0.08 && d > spacing * 0.05)) {
      this.push(x, t);
      this.lastDir = [v[0], v[1], v[2]];
    }
    // Drop samples beyond the maximum age.
    while (this.count > 2 && t - this.time(0) > this.style.maxAge) this.count--;
  }

  /** Trails of bodies that no longer exist keep fading until they are invisible. */
  get expired(): boolean {
    return this.body === null && this.opacity <= 0.001;
  }
}

const VS = HEADER + LENS + CAMERA + /* glsl */ `
uniform highp sampler2D uTrail;
uniform int uRow, uHead, uCount, uCap;
uniform float uNow, uFade, uMaxAge, uWidth, uIntensity, uCore, uOpacity;
uniform vec3 uColor;
out float vAcross;
out vec3 vCol;
out float vCoreI;
out vec4 vBehind;

vec4 P(int i) {
  i = clamp(i, 0, uCount - 1);
  int idx = (uHead - (uCount - 1) + i + uCap * 2) % uCap;
  return texelFetch(uTrail, ivec2(idx, uRow), 0);
}

void main() {
  int vid = gl_VertexID;
  float side = float(vid & 1) * 2.0 - 1.0;
  int s = vid >> 1;
  int seg = s / ${SUBDIV};
  float f = float(s - seg * ${SUBDIV}) / ${SUBDIV}.0;
  if (seg >= uCount - 1) { seg = uCount - 2; f = 1.0; }
  vec4 q0 = P(seg - 1), q1 = P(seg), q2 = P(seg + 1), q3 = P(seg + 2);
  vec3 p0 = q0.xyz, p1 = q1.xyz, p2 = q2.xyz, p3 = q3.xyz;
  // Centripetal Catmull–Rom (no cusps or overshoot at hairpin turns).
  float t01 = max(pow(distance(p0, p1), 0.5), 1e-7);
  float t12 = max(pow(distance(p1, p2), 0.5), 1e-7);
  float t23 = max(pow(distance(p2, p3), 0.5), 1e-7);
  vec3 m1 = p2 - p1 + t12 * ((p1 - p0) / t01 - (p2 - p0) / (t01 + t12));
  vec3 m2 = p2 - p1 + t12 * ((p3 - p2) / t23 - (p3 - p1) / (t12 + t23));
  vec3 a = 2.0 * (p1 - p2) + m1 + m2;
  vec3 b = -3.0 * (p1 - p2) - m1 - m1 - m2;
  vec3 pos = ((a * f + b) * f + m1) * f + p1;
  vec3 tan = (3.0 * a * f + 2.0 * b) * f + m1;
  if (dot(tan, tan) < 1e-20) tan = p2 - p1;

  float t = mix(q1.w, q2.w, f);
  float age = max(uNow - t, 0.0);
  float alpha = exp(-age / uFade) * smoothstep(uMaxAge, uMaxAge * 0.7, age) * uOpacity;

  float valid;
  vec4 dummy;
  vec3 lp = lensMap(pos, vBehind, valid);
  float tl = length(tan);
  vec3 lp2 = lensMap(pos + tan / tl * 1e-3 * max(distance(pos, uCamPos), 1e-3), dummy, valid);
  vec4 c0 = uViewProj * vec4(lp, 1.0);
  vec4 c1 = uViewProj * vec4(lp2, 1.0);
  vec2 s0 = c0.xy / c0.w * uViewport * 0.5;
  vec2 s1 = c1.xy / c1.w * uViewport * 0.5;
  vec2 dir = s1 - s0;
  float dl = length(dir);
  dir = dl > 1e-6 ? dir / dl : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);

  float depth = max(c0.w, 1e-6);
  float wPx = uWidth * uFocalPx / depth;
  // Taper towards the tail.
  wPx *= 0.35 + 0.65 * sqrt(alpha / max(uOpacity, 1e-6));
  float minPx = 0.9 * uPxScale;
  if (wPx < minPx) { alpha *= wPx / minPx; wPx = minPx; }
  c0.xy += nrm * side * (wPx + 1.0) / (uViewport * 0.5) * c0.w;
  if (c0.w <= 0.0 || c1.w <= 0.0) c0 = vec4(2.0, 2.0, 2.0, 1.0);
  gl_Position = c0;
  vAcross = side * (wPx + 1.0) / wPx;
  vCol = uColor * uIntensity * alpha;
  vCoreI = uCore * uIntensity * alpha;
}`;

const FS = HEADER + LENS + OCCLUSION + /* glsl */ `
in float vAcross;
in vec3 vCol;
in float vCoreI;
in vec4 vBehind;
out vec4 o;
void main() {
  float x = vAcross;
  float glow = exp(-x * x * 2.2);
  float core = exp(-x * x * 12.0);
  vec3 c = vCol * glow + vec3(1.0, 0.97, 0.94) * core * vCoreI;
  o = vec4(c * shadowOcclusion(vBehind), 0.0);
}`;

export class TrailRenderer {
  private gl: GL;
  private prog: Program;
  private tex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  readonly maxRows: number;
  private freeRows: number[] = [];
  trails: Trail[] = [];

  constructor(gl: GL, maxRows = 256) {
    this.gl = gl;
    this.maxRows = maxRows;
    this.prog = new Program(gl, VS, FS, 'trails');
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, TRAIL_CAP, maxRows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.vao = gl.createVertexArray()!;
    this.reset();
  }

  reset() {
    this.trails = [];
    this.freeRows = [];
    for (let i = this.maxRows - 1; i >= 0; i--) this.freeRows.push(i);
  }

  create(body: Body, style: TrailStyle): Trail | null {
    const row = this.freeRows.pop();
    if (row === undefined) return null;
    const t = new Trail(row, body, style);
    this.trails.push(t);
    return t;
  }

  /** Remove expired trails and recycle their rows. */
  gc() {
    this.trails = this.trails.filter((t) => {
      if (t.expired) {
        this.freeRows.push(t.row);
        return false;
      }
      return true;
    });
  }

  private upload(t: Trail) {
    const gl = this.gl;
    const n = Math.min(t.seq - t.uploadedSeq + 1, TRAIL_CAP);
    if (n <= 0) return;
    // Newest n samples end at t.head (inclusive).
    const start = (t.head - n + 1 + TRAIL_CAP) % TRAIL_CAP;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (start + n <= TRAIL_CAP) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, start, t.row, n, 1, gl.RGBA, gl.FLOAT, t.data, start * 4);
    } else {
      const n1 = TRAIL_CAP - start;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, start, t.row, n1, 1, gl.RGBA, gl.FLOAT, t.data, start * 4);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, t.row, n - n1, 1, gl.RGBA, gl.FLOAT, t.data, 0);
    }
    t.uploadedSeq = t.seq;
  }

  draw(v: View, now: number, globalOpacity = 1, widthScale = 1) {
    const gl = this.gl;
    const p = this.prog.use();
    setViewUniforms(p, v);
    p.tex('uTrail', 0, this.tex).i1('uCap', TRAIL_CAP).f1('uNow', now);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.vao);
    for (const t of this.trails) {
      this.upload(t);
      if (t.count < 2 || t.opacity * globalOpacity <= 0.001) continue;
      const s = t.style;
      p.i1('uRow', t.row)
        .i1('uHead', t.head)
        .i1('uCount', t.count)
        .f1('uFade', s.fade)
        .f1('uMaxAge', s.maxAge)
        .f1('uWidth', s.width * widthScale)
        .f1('uIntensity', s.intensity)
        .f1('uCore', s.core)
        .f1('uOpacity', t.opacity * globalOpacity)
        .v3('uColor', t.color);
      const verts = ((t.count - 1) * SUBDIV + 1) * 2;
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, verts);
    }
    gl.bindVertexArray(null);
  }
}

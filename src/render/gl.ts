// Thin WebGL2 helpers: programs with cached uniforms, float render targets, fullscreen passes.

export type GL = WebGL2RenderingContext;

export class Program {
  readonly gl: GL;
  readonly prog: WebGLProgram;
  readonly name: string;
  private locs = new Map<string, WebGLUniformLocation | null>();

  constructor(gl: GL, vs: string, fs: string, name: string) {
    this.gl = gl;
    this.name = name;
    const v = compile(gl, gl.VERTEX_SHADER, vs, name + '.vs');
    const f = compile(gl, gl.FRAGMENT_SHADER, fs, name + '.fs');
    const p = gl.createProgram()!;
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`Link error in ${name}: ${gl.getProgramInfoLog(p)}`);
    }
    gl.deleteShader(v);
    gl.deleteShader(f);
    this.prog = p;
  }

  use(): this {
    this.gl.useProgram(this.prog);
    return this;
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name);
      this.locs.set(name, l);
    }
    return l;
  }

  f1(n: string, x: number) { this.gl.uniform1f(this.loc(n), x); return this; }
  f2(n: string, x: number, y: number) { this.gl.uniform2f(this.loc(n), x, y); return this; }
  f3(n: string, x: number, y: number, z: number) { this.gl.uniform3f(this.loc(n), x, y, z); return this; }
  f4(n: string, x: number, y: number, z: number, w: number) { this.gl.uniform4f(this.loc(n), x, y, z, w); return this; }
  v3(n: string, v: ArrayLike<number>) { this.gl.uniform3f(this.loc(n), v[0], v[1], v[2]); return this; }
  i1(n: string, x: number) { this.gl.uniform1i(this.loc(n), x); return this; }
  f1v(n: string, v: Float32Array) { this.gl.uniform1fv(this.loc(n), v); return this; }
  f3v(n: string, v: Float32Array) { this.gl.uniform3fv(this.loc(n), v); return this; }
  f4v(n: string, v: Float32Array) { this.gl.uniform4fv(this.loc(n), v); return this; }
  m4(n: string, m: Float32Array) { this.gl.uniformMatrix4fv(this.loc(n), false, m); return this; }
  tex(n: string, unit: number, t: WebGLTexture | null, target: number = this.gl.TEXTURE_2D) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, t);
    gl.uniform1i(this.loc(n), unit);
    return this;
  }
}

function compile(gl: GL, type: number, src: string, name: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? '';
    const lines = src.split('\n');
    const m = /ERROR: \d+:(\d+)/.exec(log);
    let ctx = '';
    if (m) {
      const ln = parseInt(m[1], 10);
      ctx = lines
        .slice(Math.max(0, ln - 4), ln + 2)
        .map((l, i) => `${Math.max(1, ln - 3) + i}: ${l}`)
        .join('\n');
    }
    throw new Error(`Shader compile error in ${name}:\n${log}\n${ctx}`);
  }
  return s;
}

export interface TexOpts {
  internal: number;
  format: number;
  type: number;
  filter?: number;
  wrap?: number;
  data?: ArrayBufferView | null;
}

export function createTex(gl: GL, w: number, h: number, o: TexOpts): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, o.internal, w, h, 0, o.format, o.type, o.data ?? null);
  const f = o.filter ?? gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  const wr = o.wrap ?? gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
  return t;
}

/** A framebuffer with one or more same-sized colour attachments. */
export class Target {
  readonly gl: GL;
  fbo: WebGLFramebuffer;
  tex: WebGLTexture[] = [];
  w = 0;
  h = 0;
  private opts: TexOpts[];

  constructor(gl: GL, w: number, h: number, opts: TexOpts[]) {
    this.gl = gl;
    this.opts = opts;
    this.fbo = gl.createFramebuffer()!;
    this.resize(w, h);
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    for (const t of this.tex) gl.deleteTexture(t);
    this.w = w;
    this.h = h;
    this.tex = this.opts.map((o) => createTex(gl, w, h, o));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    const bufs: number[] = [];
    this.tex.forEach((t, i) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      bufs.push(gl.COLOR_ATTACHMENT0 + i);
    });
    gl.drawBuffers(bufs);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incomplete: 0x${st.toString(16)}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.w, this.h);
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.tex) gl.deleteTexture(t);
    gl.deleteFramebuffer(this.fbo);
  }
}

export function hdrOpts(gl: GL, filter: number = gl.LINEAR): TexOpts {
  return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter };
}

export function f32Opts(gl: GL): TexOpts {
  return { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST };
}

/** Shared state for fullscreen passes. */
export class Fullscreen {
  private gl: GL;
  private vao: WebGLVertexArrayObject;
  constructor(gl: GL) {
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
  }
  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

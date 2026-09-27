// Small, allocation-light vector/matrix helpers. Vectors are plain [x, y, z] tuples.

export type V3 = [number, number, number];
export type RGB = [number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const clone = (a: V3): V3 => [a[0], a[1], a[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-300 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t: number) => {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

/** Rotate vector v around unit axis k by angle a (Rodrigues). */
export function rotateAxis(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

/** Any unit vector perpendicular to n. */
export function perpendicular(n: V3): V3 {
  const a: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return norm(cross(n, a));
}

// ---- 4x4 matrices, column-major Float32Array (WebGL convention) ----

export type M4 = Float32Array;
export const mat4 = (): M4 => {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

export function perspective(out: M4, fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** View matrix from an eye position and an orthonormal basis (right, up, forward). */
export function viewFromBasis(out: M4, eye: V3, right: V3, up: V3, fwd: V3): M4 {
  // Camera looks down -Z in view space, so the third row is -forward.
  out[0] = right[0]; out[4] = right[1]; out[8] = right[2];
  out[1] = up[0]; out[5] = up[1]; out[9] = up[2];
  out[2] = -fwd[0]; out[6] = -fwd[1]; out[10] = -fwd[2];
  out[3] = 0; out[7] = 0; out[11] = 0;
  out[12] = -dot(right, eye);
  out[13] = -dot(up, eye);
  out[14] = dot(fwd, eye);
  out[15] = 1;
  return out;
}

export function mul4(out: M4, a: M4, b: M4): M4 {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let rI = 0; rI < 4; rI++) {
      r[c * 4 + rI] =
        a[rI] * b[c * 4] + a[4 + rI] * b[c * 4 + 1] + a[8 + rI] * b[c * 4 + 2] + a[12 + rI] * b[c * 4 + 3];
    }
  }
  out.set(r);
  return out;
}

/** Project a world point with a view-projection matrix; returns NDC xy, clip w. */
export function project(vp: M4, p: V3): { x: number; y: number; w: number } {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
  const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
  const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  return { x: x / w, y: y / w, w };
}

/** Critically damped spring toward a target (per component). Returns new [value, velocity]. */
export function springStep(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  // Exact solution of x'' = -2w x' - w^2 (x - target) over dt.
  const w = omega;
  const e = Math.exp(-w * dt);
  const d = x - target;
  const c = v + w * d;
  const nx = target + (d + c * dt) * e;
  const nv = (v - w * c * dt) * e;
  return [nx, nv];
}

// Shared GLSL snippets.

export const MAX_LENS = 4;
export const MAX_BODIES = 16;
export const MAX_GROUPS = 12;

export const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

export const HASH = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
// Integer hash -> [0,1). Stable across frames for particle randomness.
float ihash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return float(x) / 4294967296.0;
}
`;

export const NOISE = /* glsl */ `
vec3 ghash(vec3 p) { return hash33(p) * 2.0 - 1.0; }
float gnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(dot(ghash(i + vec3(0,0,0)), f - vec3(0,0,0)), dot(ghash(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                 mix(dot(ghash(i + vec3(0,1,0)), f - vec3(0,1,0)), dot(ghash(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
             mix(mix(dot(ghash(i + vec3(0,0,1)), f - vec3(0,0,1)), dot(ghash(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                 mix(dot(ghash(i + vec3(0,1,1)), f - vec3(0,1,1)), dot(ghash(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * gnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
float ridged(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(gnoise(p) * 1.6);
    s += a * n * n;
    p = p * 2.07 + vec3(4.1, 1.3, 7.7);
    a *= 0.5;
  }
  return s;
}
`;

export const BLACKBODY = /* glsl */ `
// Planckian locus (Kim et al.) -> linear sRGB, max channel = 1.
vec3 blackbody(float T) {
  T = clamp(T, 1667.0, 25000.0);
  float t1 = 1000.0 / T, t2 = t1 * t1, t3 = t2 * t1;
  float x = T <= 4000.0 ? -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t1 + 0.179910
                        : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t1 + 0.240390;
  float x2 = x * x, x3 = x2 * x;
  float y = T <= 2222.0 ? -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683
          : T <= 4000.0 ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
                        :  3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
  vec3 XYZ = vec3(x / y, 1.0, (1.0 - x - y) / y);
  vec3 rgb = mat3(3.2404542, -0.9692660, 0.0556434,
                  -1.5371385, 1.8760108, -0.2040259,
                  -0.4985314, 0.0415560, 1.0572252) * XYZ;
  rgb = max(rgb, vec3(0.0));
  return rgb / max(max(rgb.r, rgb.g), rgb.b);
}
`;

/** Camera + gravitational lens uniforms and the thin-lens vertex mapping. */
export const LENS = /* glsl */ `
#define MAX_LENS ${MAX_LENS}
uniform int uLensN;
uniform vec4 uLensPos[MAX_LENS];   // xyz world position, w = Schwarzschild radius
uniform vec4 uLensScr[MAX_LENS];   // xy lens centre (target px), z shadow radius (px), w unused
uniform vec3 uCamPos;
uniform int uImageLens;            // -1 primary images; k = secondary image of lens k

// Secondary images are only worth drawing for sources close to the lens axis: beyond ~3 Einstein
// radii their magnification is below 1%. Cheap early-out for the secondary-image passes.
bool secondaryCandidate(vec3 p) {
  if (uImageLens < 0) return true;
  for (int k = 0; k < MAX_LENS; k++) {
    if (k != uImageLens) continue;
    vec3 toL = uLensPos[k].xyz - uCamPos;
    float Dl = length(toL);
    vec3 n = toL / Dl;
    vec3 toP = p - uCamPos;
    float Ds = dot(toP, n);
    if (Ds <= Dl) return false;
    float beta = length(toP - Ds * n) / Ds;
    float thetaE2 = 2.0 * uLensPos[k].w * (Ds - Dl) / (Dl * Ds);
    return beta * beta < 9.0 * thetaE2;
  }
  return false;
}

// Map a world-space source point to its lensed image position (kept at the source depth).
// valid = 0 when this pass has no image for the point (secondary pass, source not behind the lens).
vec3 lensMap(vec3 p, out vec4 behind, out float valid) {
  behind = vec4(0.0);
  valid = uImageLens < 0 ? 1.0 : 0.0;
  vec3 q = p;
  for (int k = 0; k < MAX_LENS; k++) {
    if (k >= uLensN) break;
    vec3 L = uLensPos[k].xyz;
    float rs = uLensPos[k].w;
    vec3 toL = L - uCamPos;
    float Dl = length(toL);
    vec3 n = toL / Dl;
    vec3 toP = q - uCamPos;
    float Ds = dot(toP, n);
    if (Ds <= Dl) continue;
    behind[k] = 1.0;
    vec3 perp = toP - Ds * n;
    float pl = length(perp);
    float beta = pl / Ds;
    float thetaE2 = 2.0 * rs * (Ds - Dl) / (Dl * Ds);
    float disc = sqrt(beta * beta + 4.0 * thetaE2);
    bool secondary = (k == uImageLens);
    if (secondary) valid = 1.0;
    float theta = secondary ? 0.5 * (beta - disc) : 0.5 * (beta + disc);
    vec3 dir = pl > 1e-20 ? perp / pl : vec3(0.0);
    q = uCamPos + Ds * n + dir * (theta * Ds);
  }
  return q;
}
`;

/** Fragment-only: occlusion by black-hole shadows (for geometry behind the lens). */
export const OCCLUSION = /* glsl */ `
float shadowOcclusion(vec4 behind) {
  float o = 1.0;
  for (int k = 0; k < MAX_LENS; k++) {
    if (k >= uLensN) break;
    if (behind[k] < 0.5) continue;
    float r = length(gl_FragCoord.xy - uLensScr[k].xy);
    o *= smoothstep(uLensScr[k].z - 1.0, uLensScr[k].z + 1.0, r);
  }
  return o;
}
`;

/** Camera uniforms for billboarding. */
export const CAMERA = /* glsl */ `
uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec2 uViewport;   // target size in px
uniform float uFocalPx;   // px per unit at unit distance
uniform float uPxScale;   // resolution scale (1 at 1080p short side)
vec2 quadCorner(int vid) {
  // triangle strip order
  return vec2(float(vid & 1) * 2.0 - 1.0, float((vid >> 1) & 1) * 2.0 - 1.0);
}
`;

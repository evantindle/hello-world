// GPGPU tracer particles. State lives in float textures (ping-pong); every frame a fragment
// shader integrates all particles through the gravity of the massive bodies (kick-drift-kick,
// sub-stepped, with body positions Hermite-interpolated across the frame). Rendering draws
// velocity-stretched, energy-conserving sprites that are gravitationally lensed per vertex.

import type { RGB, V3 } from '../core/math.ts';
import { norm } from '../core/math.ts';
import type { Body } from '../physics/world.ts';
import { FULLSCREEN_VS, Fullscreen, Program, Target, f32Opts, type GL } from './gl.ts';
import { BLACKBODY, CAMERA, HASH, HEADER, LENS, OCCLUSION, MAX_BODIES, MAX_GROUPS } from './glsl.ts';
import { setViewUniforms, type View } from './view.ts';

export const TEX_W = 1024;

export type ParticleMode = 'free' | 'emitter' | 'disk' | 'rigid' | 'jet' | 'burst';
export type ColorMode = 'fixed' | 'ember' | 'disk' | 'debris' | 'star' | 'jet' | 'gradient' | 'lit';

const MODE_ID: Record<ParticleMode, number> = { free: 0, emitter: 1, disk: 2, rigid: 3, jet: 4, burst: 0 };
const COLOR_ID: Record<ColorMode, number> = { fixed: 0, ember: 1, disk: 2, debris: 3, star: 4, jet: 5, gradient: 6, lit: 7 };

export interface ParticleInit {
  x: V3;
  v: V3;
  /** Sim-time age (negative = dormant until then). */
  age?: number;
  /** Lifetime (0 = forever). */
  life?: number;
  size?: number;
  /** Colour parameter: temperature (K) for 'star'/'disk' modes, brightness variation otherwise. */
  param?: number;
}

export interface ParticleGroupSpec {
  name: string;
  count: number;
  mode: ParticleMode;
  colorMode: ColorMode;
  color: RGB;
  /** Second colour for 'gradient' mode (particle param 0..1 blends color → color2). */
  color2?: RGB;
  /** World-space sprite radius. */
  size: number;
  intensity: number;
  /** Host body (emitter source, disk centre, rigid parent, jet source). */
  host?: Body | null;
  /** Second body (e.g. the black hole tidally stretching a rigid star). */
  other?: Body | null;
  life?: number;
  speed?: number;
  /** Disk: inner/outer radius, relative thickness, inflow viscosity. */
  rIn?: number;
  rOut?: number;
  thickness?: number;
  inflow?: number;
  normal?: V3;
  /** Disk: inner-edge temperature (K) and Doppler strength. */
  tempIn?: number;
  doppler?: number;
  /** Radial-velocity damping (debris circularisation) and radius where it acts. */
  circularize?: number;
  circRadius?: number;
  /** Motion-blur multiplier. */
  streak?: number;
  /** Rigid groups: radius at which tidal stretching becomes strong. */
  tidalRadius?: number;
  /** Scale of gravity felt by this group (0 = ballistic sparks). */
  gravity?: number;
  /** Emitters: spawn radius in units of the host's visual radius. */
  emitRadius?: number;
  /** 'lit' mode: softening radius of star light; ambient = brightness of the base colour
   *  ('lit') or the emissivity floor ('disk'). */
  lightSoftening?: number;
  ambient?: number;
  /** 'disk' colour mode: emissivity ∝ (r / rIn)^-falloff. */
  falloff?: number;
  /** Per-particle initial state (free/rigid/disk groups). */
  init?: (i: number) => ParticleInit;
  /** Initial brightness multiplier (e.g. 0 for effects switched on later). */
  gain?: number;
}

export interface ParticleGroup {
  spec: ParticleGroupSpec;
  index: number;
  start: number;
  count: number;
  /** Rigid groups: 0 attached, 1 release this frame, 2 free. */
  release: number;
  /** Runtime-tweakable intensity multiplier. */
  gain: number;
  /** Burst pools: next row to spawn into. */
  burstCursor: number;
}

export interface BodyFrame {
  body: Body;
  x0: V3;
  v0: V3;
  x1: V3;
  v1: V3;
}

const BODY_UNIFORMS = /* glsl */ `
#define MAX_BODIES ${MAX_BODIES}
#define MAX_GROUPS ${MAX_GROUPS}
uniform int uNB;
uniform vec4 uBP0[MAX_BODIES];  // pos at frame start, mass
uniform vec4 uBV0[MAX_BODIES];  // vel at frame start, softening^2
uniform vec4 uBP1[MAX_BODIES];  // pos at frame end, mass
uniform vec4 uBV1[MAX_BODIES];  // vel at frame end
uniform vec4 uBK[MAX_BODIES];   // kind (1 = BH), absorb radius, Paczynski-Wiita rs, visual radius
uniform vec4 uBCol[MAX_BODIES]; // light colour, luminosity (stars illuminate 'lit' particles)
uniform float uDt;
uniform float uG;
vec3 bodyPos(int i, float s) {
  // Cubic Hermite across the frame.
  float s2 = s * s, s3 = s2 * s;
  float h00 = 2.0 * s3 - 3.0 * s2 + 1.0, h10 = s3 - 2.0 * s2 + s, h01 = -2.0 * s3 + 3.0 * s2, h11 = s3 - s2;
  return h00 * uBP0[i].xyz + h10 * uDt * uBV0[i].xyz + h01 * uBP1[i].xyz + h11 * uDt * uBV1[i].xyz;
}
vec3 bodyVel(int i, float s) {
  float s2 = s * s;
  float d00 = 6.0 * s2 - 6.0 * s, d10 = 3.0 * s2 - 4.0 * s + 1.0, d01 = -6.0 * s2 + 6.0 * s, d11 = 3.0 * s2 - 2.0 * s;
  return (d00 * uBP0[i].xyz + d01 * uBP1[i].xyz) / max(uDt, 1e-12) + d10 * uBV0[i].xyz + d11 * uBV1[i].xyz;
}
`;

const GROUP_UNIFORMS = /* glsl */ `
uniform vec4 uGA[MAX_GROUPS];  // mode, host, life, speed
uniform vec4 uGB[MAX_GROUPS];  // rIn, rOut, thickness, inflow
uniform vec4 uGC[MAX_GROUPS];  // normal xyz, release state
uniform vec4 uGD[MAX_GROUPS];  // circularize, circRadius, other body, tidal radius
uniform vec4 uGE[MAX_GROUPS];  // streak multiplier, gravity scale, emit radius (x body radius), unused
uniform vec4 uGV[MAX_GROUPS];  // colorMode, size, intensity, doppler
uniform vec4 uGCol[MAX_GROUPS]; // rgb, tempIn
uniform vec4 uGCol2[MAX_GROUPS]; // secondary colour (gradient mode)
`;

const UPDATE_FS = HEADER + HASH + BODY_UNIFORMS + GROUP_UNIFORMS + /* glsl */ `
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform sampler2D uAttr;
uniform int uSub;
uniform float uFrame;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;

bool gAbsorbed;

vec3 accel(vec3 x, float s) {
  vec3 a = vec3(0.0);
  for (int i = 0; i < MAX_BODIES; i++) {
    if (i >= uNB) break;
    vec3 d = bodyPos(i, s) - x;
    float r2 = dot(d, d);
    float r = sqrt(r2);
    float m = uBP1[i].w;
    vec4 K = uBK[i];
    if (r < K.y) gAbsorbed = true;
    float rs = K.z;
    if (rs > 0.0) {
      // Paczynski-Wiita pseudo-Newtonian potential: ISCO at 3 rs, plunging orbits inside.
      float rr = max(r - rs, 0.05 * rs);
      a += d * (uG * m / (r * rr * rr + 1e-30));
    } else {
      float e2 = r2 + uBV0[i].w;
      a += d * (uG * m / (e2 * sqrt(e2)));
    }
  }
  return a;
}

float rnd(uint id, float k) {
  return ihash(id * 2654435761u + uint(k * 7919.0) + uint(uFrame) * 97u);
}
vec3 rndUnit(uint id, float k) {
  float z = rnd(id, k) * 2.0 - 1.0;
  float ph = rnd(id, k + 1.0) * 6.2831853;
  float r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(ph), r * sin(ph), z);
}
void basis(vec3 n, out vec3 u, out vec3 w) {
  u = normalize(cross(n, abs(n.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0)));
  w = cross(n, u);
}
float circSpeed(int h, float r) {
  float m = uBP1[h].w;
  float rs = uBK[h].z;
  if (rs > 0.0) return sqrt(uG * m * r) / max(r - rs, 0.05 * rs);
  float e2 = r * r + uBV0[h].w;
  return sqrt(uG * m * r * r / (e2 * sqrt(e2)));
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  uint id = uint(ij.y * ${TEX_W} + ij.x);
  vec4 P = texelFetch(uPos, ij, 0);
  vec4 V = texelFetch(uVel, ij, 0);
  vec4 A = texelFetch(uAttr, ij, 0);
  int g = int(A.x + 0.5);
  if (g < 0 || g >= MAX_GROUPS) { oPos = P; oVel = V; return; }
  vec4 GA = uGA[g], GB = uGB[g], GC = uGC[g], GD = uGD[g];
  int mode = int(GA.x + 0.5);
  int host = int(GA.y + 0.5) - 1;
  float life = V.w;
  float age = P.w;
  vec3 x = P.xyz, v = V.xyz;

  // Rigidly attached (e.g. a star before tidal disruption): offset stored in v.
  if (mode == 3 && host >= 0 && GC.w < 1.5) {
    vec3 off = v;
    vec3 c = bodyPos(host, 1.0);
    int oth = int(GD.z + 0.5) - 1;
    vec3 offS = off;
    if (oth >= 0) {
      // Tidal stretching along the line to the other body, squeezing across it.
      vec3 dd = bodyPos(oth, 1.0) - c;
      float dist = length(dd);
      vec3 u = dd / dist;
      float k = clamp(GD.w / dist, 0.0, 3.0);
      float st = 0.6 * k * k * k;
      float along = dot(off, u);
      offS = off - along * u + along * u * (1.0 + st);
      offS -= (offS - dot(offS, u) * u) * min(0.3 * st, 0.45);
    }
    if (GC.w > 0.5) {
      // Release: particles inherit the parent's velocity plus its spin.
      vec3 hv = bodyVel(host, 1.0);
      oPos = vec4(c + offS, max(age, 0.0) + uDt);
      oVel = vec4(hv + cross(GC.xyz, offS) * GA.w, 0.0);
    } else {
      oPos = vec4(c + offS, age + uDt);
      oVel = vec4(off, life);
    }
    return;
  }

  bool alive = age >= 0.0;
  float newAge = age + uDt;
  if (!alive && newAge < 0.0) { oPos = vec4(x, newAge); oVel = V; return; }

  bool respawn = false;
  float birthFrac = 0.0;   // how long ago within this frame (in sim time) the particle is born
  if (!alive) { respawn = true; birthFrac = newAge; }
  if (alive && life > 0.0 && newAge > life && (mode == 1 || mode == 4)) { respawn = true; birthFrac = newAge - life; }

  if (!respawn && alive) {
    // Per-particle adaptive sub-steps: the step is limited by the local dynamical time so
    // close passes by a body do not produce numerical slingshots.
    float gs = uGE[g].y;
    float tdyn = 1e30;
    for (int i = 0; i < MAX_BODIES; i++) {
      if (i >= uNB) break;
      vec3 d0 = uBP0[i].xyz - x, d1 = uBP1[i].xyz - x;
      float r2 = min(dot(d0, d0), dot(d1, d1)) + uBV0[i].w + 1e-12;
      tdyn = min(tdyn, sqrt(r2 * sqrt(r2) / (uG * uBP1[i].w + 1e-30)));
    }
    int n = uSub;
    if (gs > 0.0) n = max(uSub, int(ceil(uDt * sqrt(gs) / (0.12 * tdyn))));
    n = min(n, 48);
    float h = uDt / float(n);
    gAbsorbed = false;
    for (int k = 0; k < 48; k++) {
      if (k >= n) break;
      float s0 = float(k) / float(n), s1 = float(k + 1) / float(n);
      v += accel(x, s0) * (0.5 * h * gs);
      x += v * h;
      vec3 a1 = accel(x, s1);
      v += a1 * (0.5 * h * gs);
      if (host >= 0 && (GB.w > 0.0 || GD.x > 0.0)) {
        vec3 hp = bodyPos(host, s1);
        vec3 hv = bodyVel(host, s1);
        vec3 rel = x - hp;
        float r = length(rel);
        float om = sqrt(uG * uBP1[host].w / (r * r * r + 1e-9));
        vec3 vr = v - hv;
        // Viscous inflow for accretion disks.
        if (GB.w > 0.0) v -= vr * min(GB.w * om * h, 0.5);
        // Circularisation of returning debris.
        if (GD.x > 0.0 && r < GD.y) {
          vec3 rh = rel / r;
          float vrad = dot(vr, rh);
          v -= rh * vrad * min(GD.x * om * h, 0.9);
        }
      }
    }
    if (gAbsorbed) {
      if (mode == 2) { respawn = true; birthFrac = 0.0; }
      else if (mode == 1 || mode == 4) { respawn = true; birthFrac = 0.0; }
      else { oPos = vec4(x, -1e30); oVel = vec4(v, life); return; }
    }
    if (!respawn) {
      // Disk particles that wander too far get recycled too.
      if (mode == 2 && host >= 0 && length(x - bodyPos(host, 1.0)) > GB.y * 3.0) { respawn = true; birthFrac = 0.0; }
      else { oPos = vec4(x, newAge); oVel = vec4(v, life); return; }
    }
  }

  // ---- respawn ----
  if (host < 0) { oPos = vec4(x, -1e30); oVel = V; return; }
  float s = clamp(1.0 - birthFrac / max(uDt, 1e-12), 0.0, 1.0);
  vec3 hp = bodyPos(host, s);
  vec3 hv = bodyVel(host, s);
  float seedK = A.y * 1000.0 + newAge * 13.0;
  if (mode == 2) {
    vec3 n = normalize(GC.xyz);
    vec3 u, w;
    basis(n, u, w);
    float r = mix(GB.y * 0.82, GB.y, rnd(id, seedK));
    float ph = rnd(id, seedK + 3.0) * 6.2831853;
    vec3 rh = u * cos(ph) + w * sin(ph);
    vec3 th = cross(n, rh);
    float z = (rnd(id, seedK + 5.0) - 0.5) * 2.0 * GB.z * r;
    x = hp + rh * r + n * z;
    v = hv + th * circSpeed(host, r) * (1.0 + (rnd(id, seedK + 7.0) - 0.5) * 0.02);
    oPos = vec4(x, 0.0);
    oVel = vec4(v, life);
    return;
  }
  if (mode == 4) {
    vec3 n = normalize(GC.xyz);
    float side = rnd(id, seedK) < 0.5 ? -1.0 : 1.0;
    vec3 lat = rndUnit(id, seedK + 2.0);
    lat -= n * dot(lat, n);
    float sp = GA.w * (0.75 + 0.5 * rnd(id, seedK + 4.0));
    x = hp + n * side * uBK[host].w * 1.5 + lat * uBK[host].w * 0.3;
    v = hv + n * side * sp + lat * sp * 0.035;
    x += v * birthFrac;
    oPos = vec4(x, birthFrac);
    oVel = vec4(v, GA.z * (0.6 + 0.8 * rnd(id, seedK + 6.0)));
    return;
  }
  // Emitter: stream off the body's surface.
  vec3 dir = rndUnit(id, seedK);
  float sp = GA.w * (0.35 + 0.9 * rnd(id, seedK + 2.0));
  x = hp + dir * uBK[host].w * uGE[g].z;
  v = hv + dir * sp;
  x += v * birthFrac;
  oPos = vec4(x, birthFrac);
  oVel = vec4(v, GA.z * (0.5 + rnd(id, seedK + 4.0)));
}`;

const SPAWN_FS = HEADER + HASH + /* glsl */ `
uniform vec3 uCenter;
uniform vec3 uBaseVel;
uniform vec3 uNormal;
uniform float uSpeed;
uniform float uFlat;
uniform float uLife;
uniform float uRadius;
uniform float uSeed;
uniform int uStartRow;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
float r(uint id, float k) { return ihash(id * 747796405u + uint(k * 7919.0) + uint(uSeed * 1013.0)); }
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  uint id = uint(ij.y * ${TEX_W} + ij.x);
  float z = r(id, 1.0) * 2.0 - 1.0;
  float ph = r(id, 2.0) * 6.2831853;
  float rr = sqrt(max(0.0, 1.0 - z * z));
  vec3 d = vec3(rr * cos(ph), rr * sin(ph), z);
  // Flatten toward the plane perpendicular to uNormal (debris disks from orbital mergers).
  d -= uNormal * dot(d, uNormal) * uFlat;
  d = normalize(d + 1e-6);
  float sp = uSpeed * pow(r(id, 3.0), 0.6) * (0.3 + 0.7 * r(id, 4.0));
  vec3 x = uCenter + d * uRadius * r(id, 5.0);
  oPos = vec4(x, 0.0);
  oVel = vec4(uBaseVel + d * sp, uLife * (0.35 + 0.65 * r(id, 6.0)));
}`;

const RENDER_VS = HEADER + LENS + CAMERA + BLACKBODY + BODY_UNIFORMS + GROUP_UNIFORMS + /* glsl */ `
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform sampler2D uAttr;
uniform float uShutter;
uniform float uC;
uniform float uGain;
uniform vec4 uGainG[MAX_GROUPS / 4];
out vec2 vLocal;
out float vHalfLen;
out vec3 vCol;
out vec4 vBehind;

void main() {
  int id = gl_InstanceID;
  ivec2 ij = ivec2(id % ${TEX_W}, id / ${TEX_W});
  vec4 P = texelFetch(uPos, ij, 0);
  vec4 V = texelFetch(uVel, ij, 0);
  vec4 A = texelFetch(uAttr, ij, 0);
  int g = int(A.x + 0.5);
  if (g < 0 || g >= MAX_GROUPS || P.w < 0.0 || !secondaryCandidate(P.xyz)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 GA = uGA[g], GV = uGV[g], GCol = uGCol[g];
  int mode = int(GA.x + 0.5);
  int host = int(GA.y + 0.5) - 1;
  int cmode = int(GV.x + 0.5);
  vec3 x = P.xyz;
  vec3 v = (mode == 3 && uGC[g].w < 1.5) ? (host >= 0 ? uBV1[host].xyz : vec3(0.0)) : V.xyz;
  float age = P.w, life = V.w;

  // ---- colour ----
  float I = GV.z * uGain * uGainG[g / 4][g % 4];
  vec3 col = GCol.rgb;
  if (cmode == 1) {
    float t = life > 0.0 ? clamp(age / life, 0.0, 1.0) : 0.0;
    I *= (1.0 - t) * (1.0 - t) * smoothstep(0.0, 0.04, t);
    col = mix(mix(vec3(1.0), col, smoothstep(0.0, 0.25, t)), col * vec3(1.0, 0.45, 0.3), smoothstep(0.5, 1.0, t));
  } else if (cmode == 2 && host >= 0) {
    // Rigid groups (a star before disruption) are coloured relative to the body tidally heating
    // them, not their own centre.
    int oth = int(uGD[g].z + 0.5) - 1;
    int ch = (mode == 3 && oth >= 0) ? oth : host;
    vec3 rel = x - uBP1[ch].xyz;
    float r = length(rel);
    float rIn = uGB[g].x;
    float rs = uBK[ch].z;
    float T = GCol.w * pow(max(r, rIn) / rIn, -0.75);
    // Particles carrying their own temperature (e.g. stellar debris) never look cooler than it.
    float Tself = A.w > 100.0 ? A.w : 0.0;
    T = max(T, Tself);
    vec3 vr = v - uBV1[ch].xyz;
    vec3 toCam = normalize(uCamPos - x);
    float beta = min(length(vr) / uC, 0.95);
    float cosT = dot(normalize(vr + 1e-9), toCam);
    float gam = 1.0 / sqrt(1.0 - beta * beta);
    float D = 1.0 / (gam * (1.0 - beta * cosT));
    D = mix(1.0, D, GV.w);
    float grav = rs > 0.0 ? sqrt(max(1.0 - rs / r, 0.02)) : 1.0;
    float Tobs = T * D * grav;
    col = blackbody(Tobs);
    // Thin-disk emissivity falls steeply with radius; beaming boosts the approaching side.
    float emis = max(pow(max(r, rIn) / rIn, -uGCol2[g].w), uGE[g].w);
    I *= pow(D, 3.0) * pow(grav, 4.0) * emis * (Tself > 0.0 ? 1.0 : 0.7 + 0.6 * A.w);
    // Plunging material inside the ISCO fades out.
    if (rs > 0.0) I *= smoothstep(rs * 1.05, rs * 2.2, r);
  } else if (cmode == 3) {
    float cool = life > 0.0 ? clamp(age / life, 0.0, 1.0) : clamp(age * 0.15, 0.0, 1.0);
    float T = mix(14000.0, 1800.0, pow(cool, 0.6));
    col = mix(blackbody(T), col, 0.25);
    I *= (1.0 - cool) * (1.0 - cool) * smoothstep(0.0, 0.02, cool + 0.001);
  } else if (cmode == 4) {
    col = A.w > 0.0 ? blackbody(A.w) : col;
    float fadeIn = smoothstep(0.0, 0.5, age);
    I *= fadeIn;
  } else if (cmode == 6) {
    col = mix(GCol.rgb, uGCol2[g].rgb, A.w);
    I *= smoothstep(0.0, 0.4, age);
  } else if (cmode == 7) {
    // Dust lit by the stars (inverse-square, softened), plus a faint ambient tint.
    vec3 lit = vec3(0.0);
    float s2 = uGB[g].x * uGB[g].x;
    for (int i = 0; i < MAX_BODIES; i++) {
      if (i >= uNB) break;
      vec4 bc = uBCol[i];
      if (bc.w <= 0.0) continue;
      vec3 d = uBP1[i].xyz - x;
      lit += bc.rgb * (bc.w / (dot(d, d) + s2));
    }
    vec3 base = mix(GCol.rgb, uGCol2[g].rgb, A.w);
    col = base * uGE[g].w + lit * mix(vec3(1.0), base * 1.6, 0.35);
    I *= smoothstep(0.0, 0.3, age) * (0.5 + A.z * 0.5);
  } else if (cmode == 5) {
    float t = life > 0.0 ? clamp(age / life, 0.0, 1.0) : 0.0;
    I *= (1.0 - t) * smoothstep(0.0, 0.05, t);
    col = mix(vec3(0.85, 0.9, 1.0), col, smoothstep(0.0, 0.4, t));
  } else {
    I *= 0.6 + 0.8 * A.w;
    if (life > 0.0) I *= 1.0 - smoothstep(0.6, 1.0, age / life);
  }
  if (I <= 1e-5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // ---- geometry: camera-facing capsule stretched along screen-space motion ----
  vec2 c = quadCorner(gl_VertexID);
  vec3 toCam = uCamPos - x;
  float dist = length(toCam);
  vec3 vd = toCam / dist;
  float depth = dot(x - uCamPos, uCamFwd);
  if (depth <= 1e-5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float sizeW = GV.y * A.z;
  float pxPerW = uFocalPx / depth;
  float minW = 0.85 * uPxScale / pxPerW;
  if (sizeW < minW) { I *= (sizeW / minW) * (sizeW / minW); sizeW = minW; }
  vec3 streak = v * uShutter * uGE[g].x;
  streak -= vd * dot(streak, vd);
  float lenW = length(streak);
  vec3 along = lenW > 1e-12 ? streak / lenW : uCamRight;
  vec3 across = normalize(cross(along, vd));
  float halfLen = 0.5 * lenW;
  I *= sizeW / (sizeW + lenW);
  vec3 center = x - 0.5 * streak;
  vec3 corner = center + along * c.x * (halfLen + sizeW * 2.0) + across * c.y * sizeW * 2.0;
  float valid;
  corner = lensMap(corner, vBehind, valid);
  if (valid < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  gl_Position = uViewProj * vec4(corner, 1.0);
  vLocal = vec2(c.x * (halfLen + sizeW * 2.0), c.y * sizeW * 2.0) / sizeW;
  vHalfLen = halfLen / sizeW;
  vCol = col * I;
}`;

const RENDER_FS = HEADER + LENS + OCCLUSION + /* glsl */ `
in vec2 vLocal;
in float vHalfLen;
in vec3 vCol;
in vec4 vBehind;
out vec4 o;
void main() {
  float dx = max(abs(vLocal.x) - vHalfLen, 0.0);
  float d2 = dx * dx + vLocal.y * vLocal.y;
  float a = exp(-d2 * 1.6) * (1.0 - smoothstep(3.0, 4.0, d2));
  o = vec4(vCol * a * shadowOcclusion(vBehind), 0.0);
}`;

export class ParticleSystem {
  private gl: GL;
  private fs: Fullscreen;
  private updateProg: Program;
  private spawnProg: Program;
  private renderProg: Program;
  private targets: [Target, Target];
  private cur = 0;
  private attrTex: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject;
  groups: ParticleGroup[] = [];
  capacity = 0;
  rows = 0;
  private frame = 0;
  private bodyIndex = new Map<Body, number>();
  private bodyList: Body[] = [];
  private buf = {
    p0: new Float32Array(MAX_BODIES * 4),
    v0: new Float32Array(MAX_BODIES * 4),
    p1: new Float32Array(MAX_BODIES * 4),
    v1: new Float32Array(MAX_BODIES * 4),
    k: new Float32Array(MAX_BODIES * 4),
    col: new Float32Array(MAX_BODIES * 4),
    ga: new Float32Array(MAX_GROUPS * 4),
    gb: new Float32Array(MAX_GROUPS * 4),
    gc: new Float32Array(MAX_GROUPS * 4),
    gd: new Float32Array(MAX_GROUPS * 4),
    ge: new Float32Array(MAX_GROUPS * 4),
    gv: new Float32Array(MAX_GROUPS * 4),
    gcol: new Float32Array(MAX_GROUPS * 4),
    gcol2: new Float32Array(MAX_GROUPS * 4),
    gain: new Float32Array(MAX_GROUPS),
  };
  G = 1;
  c = 1;
  /** Global particle brightness. */
  gain = 1;
  substeps = 4;
  lastDt = 0;
  /** Global particle-count multiplier (draft renders); brightness is compensated. */
  countScale = 1;

  constructor(gl: GL, fs: Fullscreen) {
    this.gl = gl;
    this.fs = fs;
    this.updateProg = new Program(gl, FULLSCREEN_VS, UPDATE_FS, 'particleUpdate');
    this.spawnProg = new Program(gl, FULLSCREEN_VS, SPAWN_FS, 'particleSpawn');
    this.renderProg = new Program(gl, RENDER_VS, RENDER_FS, 'particleRender');
    this.targets = [new Target(gl, TEX_W, 1, [f32Opts(gl), f32Opts(gl)]), new Target(gl, TEX_W, 1, [f32Opts(gl), f32Opts(gl)])];
    this.vao = gl.createVertexArray()!;
  }

  /** Allocate all groups and upload initial state. Groups start on row boundaries. */
  setup(specs: ParticleGroupSpec[], rngSeed = 1) {
    const gl = this.gl;
    if (specs.length > MAX_GROUPS) throw new Error(`too many particle groups (${specs.length} > ${MAX_GROUPS})`);
    let row = 0;
    const k = Math.max(0.02, this.countScale);
    if (k !== 1) {
      specs = specs.map((sp) => {
        const count = Math.max(1, Math.round(sp.count * k));
        return { ...sp, count, intensity: sp.intensity * (sp.count / count) };
      });
    }
    this.groups = specs.map((spec, index) => {
      const start = row * TEX_W;
      const rows = Math.max(1, Math.ceil(spec.count / TEX_W));
      row += rows;
      return { spec, index, start, count: rows * TEX_W, release: 0, gain: spec.gain ?? 1, burstCursor: 0 };
    });
    this.rows = Math.max(1, row);
    this.capacity = this.rows * TEX_W;
    this.targets[0].resize(TEX_W, this.rows);
    this.targets[1].resize(TEX_W, this.rows);

    const pos = new Float32Array(this.capacity * 4);
    const vel = new Float32Array(this.capacity * 4);
    const attr = new Float32Array(this.capacity * 4);
    // Unused slots: dead, no group.
    for (let i = 0; i < this.capacity; i++) {
      pos[i * 4 + 3] = -1e30;
      attr[i * 4] = -1;
    }
    let seed = rngSeed * 1664525 + 1013904223;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
    for (const g of this.groups) {
      const s = g.spec;
      for (let k = 0; k < g.count; k++) {
        const i = g.start + k;
        const o = i * 4;
        attr[o] = k < s.count ? g.index : -1;
        attr[o + 1] = rand();
        attr[o + 2] = 0.6 + 0.8 * rand();
        attr[o + 3] = rand();
        if (k >= s.count) continue;
        if (s.mode === 'emitter' || s.mode === 'jet') {
          const life = s.life ?? 2;
          // Stagger births so emission is uniform from the first frame.
          pos[o + 3] = -(k / s.count) * life;
          vel[o + 3] = life;
          continue;
        }
        if (s.mode === 'burst') {
          pos[o + 3] = -1e30;
          continue;
        }
        if (s.init) {
          const p = s.init(k);
          if (s.mode === 'rigid' && s.host) {
            // Rigid particles store their offset in the velocity slot; place them on the parent.
            p.x = [s.host.x[0] + p.v[0], s.host.x[1] + p.v[1], s.host.x[2] + p.v[2]];
          }
          pos[o] = p.x[0]; pos[o + 1] = p.x[1]; pos[o + 2] = p.x[2];
          pos[o + 3] = p.age ?? 0;
          vel[o] = p.v[0]; vel[o + 1] = p.v[1]; vel[o + 2] = p.v[2];
          vel[o + 3] = p.life ?? 0;
          if (p.size !== undefined) attr[o + 2] = p.size;
          if (p.param !== undefined) attr[o + 3] = p.param;
        }
      }
    }
    for (const t of this.targets) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex[0]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, this.rows, gl.RGBA, gl.FLOAT, pos);
      gl.bindTexture(gl.TEXTURE_2D, t.tex[1]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, this.rows, gl.RGBA, gl.FLOAT, vel);
    }
    if (this.attrTex) gl.deleteTexture(this.attrTex);
    this.attrTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.attrTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEX_W, this.rows, 0, gl.RGBA, gl.FLOAT, attr);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.cur = 0;
    this.frame = 0;
    this.bodyIndex.clear();
    this.bodyList = [];
  }

  /** Refresh body uniforms without advancing (start holds, pauses, right after setup). */
  syncBodies(bodies: Body[]) {
    this.packBodies(bodies.map((body) => ({ body, x0: body.x, v0: body.v, x1: body.x, v1: body.v })));
  }

  group(name: string): ParticleGroup | undefined {
    return this.groups.find((g) => g.spec.name === name);
  }

  private bodyIdx(b: Body | null | undefined): number {
    if (!b) return 0;
    let cur: Body | null = b;
    while (cur && !cur.alive && cur.mergedInto) cur = cur.mergedInto;
    const i = cur ? this.bodyIndex.get(cur) : undefined;
    return i === undefined ? 0 : i + 1;
  }

  private packBodies(frames: BodyFrame[]) {
    const b = this.buf;
    b.p0.fill(0); b.v0.fill(0); b.p1.fill(0); b.v1.fill(0); b.k.fill(0); b.col.fill(0);
    this.bodyIndex.clear();
    this.bodyList = [];
    const n = Math.min(frames.length, MAX_BODIES);
    for (let i = 0; i < n; i++) {
      const f = frames[i];
      const body = f.body;
      this.bodyIndex.set(body, i);
      this.bodyList.push(body);
      const isBH = body.kind === 'blackhole';
      b.p0.set([f.x0[0], f.x0[1], f.x0[2], body.m], i * 4);
      b.v0.set([f.v0[0], f.v0[1], f.v0[2], body.soft * body.soft + (isBH ? 0 : (body.radius * 0.5) ** 2)], i * 4);
      b.p1.set([f.x1[0], f.x1[1], f.x1[2], body.m], i * 4);
      b.v1.set([f.v1[0], f.v1[1], f.v1[2], 0], i * 4);
      const lum = body.kind === 'star' ? body.intensity : 0;
      b.col.set([body.color[0], body.color[1], body.color[2], lum], i * 4);
      b.k.set([isBH ? 1 : 0, isBH ? body.rs * 1.02 : body.kind === 'core' ? 0 : body.radius * 0.35, isBH ? body.rs : 0, isBH ? body.rs * 1.5 : body.radius], i * 4);
    }
    return n;
  }

  private packGroups() {
    const b = this.buf;
    for (const g of this.groups) {
      const s = g.spec;
      const i = g.index * 4;
      const n = norm(s.normal ?? [0, 0, 1]);
      b.ga.set([MODE_ID[s.mode], this.bodyIdx(s.host), s.life ?? 0, s.speed ?? 0], i);
      b.gb.set([s.colorMode === 'lit' ? s.lightSoftening ?? 0.1 : s.rIn ?? 1, s.rOut ?? 10, s.thickness ?? 0.02, s.inflow ?? 0], i);
      b.gc.set([n[0], n[1], n[2], g.release], i);
      b.gd.set([s.circularize ?? 0, s.circRadius ?? 0, this.bodyIdx(s.other), s.tidalRadius ?? 0], i);
      b.ge.set([s.streak ?? 1, s.gravity ?? 1, s.emitRadius ?? 1.05, s.ambient ?? 0], i);
      b.gv.set([COLOR_ID[s.colorMode], s.size, s.intensity, s.doppler ?? 1], i);
      b.gcol.set([s.color[0], s.color[1], s.color[2], s.tempIn ?? 12000], i);
      const c2 = s.color2 ?? s.color;
      b.gcol2.set([c2[0], c2[1], c2[2], s.falloff ?? 2.2], i);
      b.gain[g.index] = g.gain;
    }
  }

  private setBodyUniforms(p: Program, dt: number) {
    const b = this.buf;
    p.i1('uNB', this.bodyList.length)
      .f4v('uBP0', b.p0).f4v('uBV0', b.v0).f4v('uBP1', b.p1).f4v('uBV1', b.v1).f4v('uBK', b.k).f4v('uBCol', b.col)
      .f1('uDt', dt).f1('uG', this.G);
    p.f4v('uGA', b.ga).f4v('uGB', b.gb).f4v('uGC', b.gc).f4v('uGD', b.gd).f4v('uGE', b.ge).f4v('uGV', b.gv).f4v('uGCol', b.gcol).f4v('uGCol2', b.gcol2);
  }

  /** Advance all particles by dt (sim time) given body states at the start and end of the frame. */
  update(frames: BodyFrame[], dt: number) {
    if (!this.groups.length || dt <= 0) return;
    const gl = this.gl;
    this.packBodies(frames);
    this.packGroups();
    this.lastDt = dt;
    const src = this.targets[this.cur];
    const dst = this.targets[1 - this.cur];
    dst.bind();
    gl.disable(gl.BLEND);
    const p = this.updateProg.use();
    this.setBodyUniforms(p, dt);
    p.tex('uPos', 0, src.tex[0]).tex('uVel', 1, src.tex[1]).tex('uAttr', 2, this.attrTex)
      .i1('uSub', this.substeps).f1('uFrame', this.frame++);
    this.fs.draw();
    this.cur = 1 - this.cur;
    // Rigid groups flagged for release are free from the next frame on.
    for (const g of this.groups) if (g.release === 1) g.release = 2;
  }

  /** Spawn an explosion of particles into a burst pool group. */
  burst(
    groupName: string,
    opts: { count: number; center: V3; vel: V3; speed: number; life: number; normal?: V3; flat?: number; radius?: number; color?: RGB },
  ) {
    const g = this.group(groupName);
    if (!g) return;
    const gl = this.gl;
    const totalRows = g.count / TEX_W;
    const rows = Math.min(totalRows, Math.max(1, Math.ceil(opts.count / TEX_W)));
    if (g.burstCursor + rows > totalRows) g.burstCursor = 0;
    const startRow = g.start / TEX_W + g.burstCursor;
    g.burstCursor += rows;
    if (opts.color) g.spec.color = opts.color;
    const t = this.targets[this.cur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, startRow, TEX_W, rows);
    gl.disable(gl.BLEND);
    const n = norm(opts.normal ?? [0, 0, 1]);
    const p = this.spawnProg.use();
    p.v3('uCenter', opts.center).v3('uBaseVel', opts.vel).v3('uNormal', n)
      .f1('uSpeed', opts.speed).f1('uFlat', opts.flat ?? 0).f1('uLife', opts.life)
      .f1('uRadius', opts.radius ?? 0).f1('uSeed', ((this.frame * 7.31 + g.burstCursor * 13.7) % 997) + 1).i1('uStartRow', startRow);
    this.fs.draw();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  draw(v: View, shutter: number) {
    if (!this.groups.length) return;
    const gl = this.gl;
    const src = this.targets[this.cur];
    this.packGroups();
    const p = this.renderProg.use();
    this.setBodyUniforms(p, this.lastDt || 1e-3);
    const gains = new Float32Array(MAX_GROUPS);
    gains.set(this.buf.gain.subarray(0, MAX_GROUPS));
    p.tex('uPos', 0, src.tex[0]).tex('uVel', 1, src.tex[1]).tex('uAttr', 2, this.attrTex)
      .f1('uShutter', shutter).f1('uC', this.c).f1('uGain', this.gain).f4v('uGainG', gains);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.vao);
    const passes = 1 + Math.min(v.lenses.length, 4);
    for (let img = -1; img < passes - 1; img++) {
      setViewUniforms(p, v, img);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.capacity);
    }
    gl.bindVertexArray(null);
  }
}

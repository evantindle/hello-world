// Per-frame view description shared by every render pass.

import type { M4, RGB, V3 } from '../core/math.ts';
import { MAX_LENS } from './glsl.ts';
import type { Program } from './gl.ts';

export interface LensInfo {
  pos: V3;
  rs: number;
  /** Screen position (target px) and shadow radius (px). */
  scr: [number, number, number];
  /** Photon-ring glow colour × intensity. */
  ring: RGB;
  /** Ring offset/width in units of b/b_c − 1. */
  ringWidth: number;
  /** Direction of the accretion flow (for Doppler asymmetry of the ring), world space. */
  spin: V3;
}

export interface View {
  w: number;
  h: number;
  camPos: V3;
  right: V3;
  up: V3;
  fwd: V3;
  fovY: number;
  tanHalfX: number;
  tanHalfY: number;
  focalPx: number;
  viewProj: M4;
  pxScale: number;
  near: number;
  far: number;
  lenses: LensInfo[];
  /** Real time (s) — for animated grain etc. */
  time: number;
  simTime: number;
}

const lensPos = new Float32Array(MAX_LENS * 4);
const lensScr = new Float32Array(MAX_LENS * 4);

/** Upload camera + lens uniforms used by CAMERA and LENS GLSL chunks. */
export function setViewUniforms(p: Program, v: View, imageLens = -1) {
  p.m4('uViewProj', v.viewProj)
    .v3('uCamPos', v.camPos)
    .v3('uCamRight', v.right)
    .v3('uCamUp', v.up)
    .v3('uCamFwd', v.fwd)
    .f2('uViewport', v.w, v.h)
    .f1('uFocalPx', v.focalPx)
    .f1('uPxScale', v.pxScale);
  const n = Math.min(v.lenses.length, MAX_LENS);
  lensPos.fill(0);
  lensScr.fill(0);
  for (let i = 0; i < n; i++) {
    const L = v.lenses[i];
    lensPos.set([L.pos[0], L.pos[1], L.pos[2], L.rs], i * 4);
    lensScr.set([L.scr[0], L.scr[1], L.scr[2], 0], i * 4);
  }
  p.i1('uLensN', n).f4v('uLensPos', lensPos).f4v('uLensScr', lensScr).i1('uImageLens', imageLens);
}

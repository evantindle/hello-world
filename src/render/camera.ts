import { TABLE_H, TABLE_W, VIEW_MARGIN } from '../config';
import { damp } from '../core/easing';
import type { Vec } from '../core/vec';

/**
 * Fits the play area to the canvas (rotating 90deg on portrait screens), handles device
 * pixel ratio, cinematic zoom, and screen shake.
 */
export class Camera {
  cssW = 1;
  cssH = 1;
  dpr = 1;
  rotated = false;
  private fitScale = 1;
  /** Cinematic zoom factor (1 = whole play area) and the world point it centres on. */
  zoom = 1;
  focusX = TABLE_W / 2;
  focusY = TABLE_H / 2;
  zoomTarget = 1;
  focusTargetX = TABLE_W / 2;
  focusTargetY = TABLE_H / 2;
  private trauma = 0;
  shakeX = 0;
  shakeY = 0;
  shakeRot = 0;
  /** Extra room reserved for HUD bars, in CSS px. */
  padTop = 0;
  padBottom = 0;

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    // Cap the backing store around 3.6 megapixels: huge high-DPI screens stay smooth, and the
    // cartoon art does not need more.
    const cap = Math.sqrt(3.6e6 / (this.cssW * this.cssH));
    this.dpr = Math.max(1, Math.min(2, dpr, cap));
    this.rotated = this.cssH > this.cssW * 1.15;
    const vw = TABLE_W + 2 * VIEW_MARGIN;
    const vh = TABLE_H + 2 * VIEW_MARGIN;
    const availH = Math.max(1, this.cssH - this.padTop - this.padBottom);
    const w = this.rotated ? vh : vw;
    const h = this.rotated ? vw : vh;
    this.fitScale = Math.min(this.cssW / w, availH / h);
  }

  /** World units -> CSS px. */
  get scale(): number {
    return this.fitScale * this.zoom;
  }

  /** Angle to counter-rotate text and faces so they stay upright on screen. */
  get upright(): number {
    return this.rotated ? -Math.PI / 2 : 0;
  }

  private get centerY(): number {
    return this.padTop + (this.cssH - this.padTop - this.padBottom) / 2;
  }

  addShake(amount: number): void {
    this.trauma = Math.min(1.2, this.trauma + amount);
  }

  update(dt: number, rand: () => number): void {
    this.zoom = damp(this.zoom, this.zoomTarget, 5, dt);
    this.focusX = damp(this.focusX, this.focusTargetX, 5, dt);
    this.focusY = damp(this.focusY, this.focusTargetY, 5, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    const mag = 28 * s;
    this.shakeX = (rand() * 2 - 1) * mag;
    this.shakeY = (rand() * 2 - 1) * mag;
    this.shakeRot = (rand() * 2 - 1) * 0.02 * s;
  }

  /** Apply the world transform (including shake) to a context whose canvas is css*dpr sized. */
  apply(ctx: CanvasRenderingContext2D): void {
    const s = this.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.cssW / 2 + this.shakeX, this.centerY + this.shakeY);
    if (this.rotated) ctx.rotate(Math.PI / 2);
    ctx.rotate(this.shakeRot);
    ctx.scale(s, s);
    ctx.translate(-this.focusX, -this.focusY);
  }

  /** CSS px (relative to the canvas) -> world units. Ignores shake on purpose. */
  screenToWorld(sx: number, sy: number): Vec {
    const s = this.scale;
    let x = (sx - this.cssW / 2) / s;
    let y = (sy - this.centerY) / s;
    if (this.rotated) {
      const t = x;
      x = y;
      y = -t;
    }
    return { x: x + this.focusX, y: y + this.focusY };
  }

  worldToScreen(wx: number, wy: number): Vec {
    const s = this.scale;
    let x = (wx - this.focusX) * s;
    let y = (wy - this.focusY) * s;
    if (this.rotated) {
      const t = x;
      x = -y;
      y = t;
    }
    return { x: x + this.cssW / 2, y: y + this.centerY };
  }
}

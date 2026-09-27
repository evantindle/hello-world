// Title cards, event captions and body labels, drawn into a 2D canvas that is composited
// into the final frame (so they end up in exported videos).

import { smoothstep } from '../core/math.ts';
import type { CaptionCue } from '../scenes/types.ts';

export const FONT_STACK = `'Inter', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif`;

interface ActiveCaption {
  cue: CaptionCue;
  t0: number;
}

export interface LabelDraw {
  x: number;
  y: number;
  text: string;
  alpha: number;
}

export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  private active: ActiveCaption[] = [];
  private fired = new Set<CaptionCue>();
  enabled = true;
  handle = '';
  /** True when the last draw produced visible pixels. */
  visible = false;
  private lastSig = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = this.canvas.width = w;
    this.h = this.canvas.height = h;
    this.lastSig = '';
  }

  reset() {
    this.active = [];
    this.fired.clear();
    this.lastSig = '';
  }

  /** Schedule cues whose time has come. */
  trigger(cues: CaptionCue[], clock: number, eventTimes: Map<string, number>) {
    for (const cue of cues) {
      if (this.fired.has(cue)) continue;
      let t0: number | null = null;
      if (cue.at !== undefined) t0 = cue.at;
      else if (cue.on && eventTimes.has(cue.on)) t0 = eventTimes.get(cue.on)! + (cue.delay ?? 0);
      if (t0 !== null && clock >= t0) {
        this.fired.add(cue);
        this.active.push({ cue, t0 });
      }
    }
    this.active = this.active.filter((a) => clock < a.t0 + a.cue.duration);
  }

  private spaced(text: string, x: number, y: number, spacing: number, align: 'center' | 'left') {
    const ctx = this.ctx;
    const chars = [...text];
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let cx = align === 'center' ? x - total / 2 : x;
    chars.forEach((c, i) => {
      ctx.fillText(c, cx, y);
      cx += widths[i] + spacing;
    });
  }

  /**
   * Redraw if anything changed. Returns true when the texture needs re-uploading.
   */
  draw(clock: number, labels: LabelDraw[]): boolean {
    const { ctx, w, h } = this;
    const s = Math.min(w, h);
    const items: { a: number; c: ActiveCaption; t: number }[] = [];
    if (this.enabled) {
      for (const a of this.active) {
        const t = clock - a.t0;
        const d = a.cue.duration;
        const alpha = smoothstep(0, 0.7, t) * (1 - smoothstep(d - 0.9, d, t));
        if (alpha > 0.002) items.push({ a: alpha, c: a, t });
      }
    }
    const labs = this.enabled ? labels.filter((l) => l.alpha > 0.01) : [];
    const sig =
      items.map((i) => `${i.c.cue.text}:${i.a.toFixed(3)}:${i.t.toFixed(2)}`).join('|') +
      '#' + labs.map((l) => `${l.text}:${l.x.toFixed(0)},${l.y.toFixed(0)}:${l.alpha.toFixed(2)}`).join('|') +
      '#' + (this.enabled ? this.handle : '');
    if (sig === this.lastSig) return false;
    this.lastSig = sig;
    ctx.clearRect(0, 0, w, h);
    this.visible = items.length > 0 || labs.length > 0 || (this.enabled && !!this.handle);
    const portrait = h > w;
    ctx.textBaseline = 'middle';

    for (const { a, c, t } of items) {
      const cue = c.cue;
      const rise = (1 - smoothstep(0, 1.4, t)) * s * 0.012;
      const track = 0.16 + 0.1 * smoothstep(0, cue.duration, t);
      if (cue.kind === 'title') {
        const y = h * (portrait ? 0.2 : 0.17) + rise;
        const size = s * 0.058;
        ctx.font = `600 ${size}px ${FONT_STACK}`;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.shadowColor = `rgba(120,180,255,${0.55 * a})`;
        ctx.shadowBlur = size * 0.6;
        this.spaced(cue.text.toUpperCase(), w / 2, y, size * track, 'center');
        ctx.shadowBlur = 0;
        this.spaced(cue.text.toUpperCase(), w / 2, y, size * track, 'center');
        if (cue.sub) {
          const ss = size * 0.42;
          ctx.font = `400 ${ss}px ${FONT_STACK}`;
          ctx.fillStyle = `rgba(200,220,255,${0.82 * a})`;
          this.spaced(cue.sub, w / 2, y + size * 1.25, ss * 0.12, 'center');
        }
      } else if (cue.kind === 'kicker') {
        const y = h * (portrait ? 0.2 : 0.17) - s * 0.07 + rise;
        const size = s * 0.026;
        ctx.font = `500 ${size}px ${FONT_STACK}`;
        ctx.fillStyle = `rgba(150,200,255,${0.9 * a})`;
        this.spaced(cue.text.toUpperCase(), w / 2, y, size * 0.45, 'center');
      } else {
        const y = h * (portrait ? 0.74 : 0.8) + rise;
        const size = s * 0.044;
        ctx.font = `600 ${size}px ${FONT_STACK}`;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.shadowColor = `rgba(255,170,90,${0.5 * a})`;
        ctx.shadowBlur = size * 0.7;
        this.spaced(cue.text.toUpperCase(), w / 2, y, size * track, 'center');
        ctx.shadowBlur = 0;
        this.spaced(cue.text.toUpperCase(), w / 2, y, size * track, 'center');
        if (cue.sub) {
          const ss = size * 0.48;
          ctx.font = `400 ${ss}px ${FONT_STACK}`;
          ctx.fillStyle = `rgba(220,230,255,${0.8 * a})`;
          this.spaced(cue.sub, w / 2, y + size * 1.2, ss * 0.1, 'center');
        }
      }
    }

    for (const l of labs) {
      const size = s * 0.024;
      ctx.font = `500 ${size}px ${FONT_STACK}`;
      ctx.fillStyle = `rgba(235,240,255,${0.9 * l.alpha})`;
      ctx.shadowColor = `rgba(0,0,0,${0.6 * l.alpha})`;
      ctx.shadowBlur = size * 0.4;
      const ox = size * 1.1, oy = -size * 1.1;
      ctx.strokeStyle = `rgba(235,240,255,${0.45 * l.alpha})`;
      ctx.lineWidth = Math.max(1, s * 0.0012);
      ctx.beginPath();
      ctx.moveTo(l.x + size * 0.35, l.y - size * 0.35);
      ctx.lineTo(l.x + ox * 0.85, l.y + oy * 0.85);
      ctx.stroke();
      this.spaced(l.text, l.x + ox, l.y + oy, size * 0.08, 'left');
      ctx.shadowBlur = 0;
    }

    if (this.enabled && this.handle) {
      const size = s * 0.022;
      ctx.font = `500 ${size}px ${FONT_STACK}`;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      this.spaced(this.handle, w / 2, h * (portrait ? 0.93 : 0.94), size * 0.2, 'center');
    }
    return true;
  }
}

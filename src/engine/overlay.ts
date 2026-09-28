// Title cards, event captions and body labels, drawn into a 2D canvas that is composited
// into the final frame (so they end up in exported videos).

import { smoothstep } from '../core/math.ts';
import type { CaptionCue } from '../scenes/types.ts';

/** Wide display face for titles; clean grotesk for everything else. Both self-hosted (see style.css). */
export const DISPLAY_FONT = `'Syncopate', 'Manrope', 'Helvetica Neue', Arial, sans-serif`;
export const FONT_STACK = `'Manrope', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif`;

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
  /** Resolves once the caption fonts are usable (exports wait for it so frames are identical). */
  readonly fontsReady: Promise<void>;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    const fonts = (document as any).fonts;
    this.fontsReady = fonts
      ? Promise.all([fonts.load(`700 64px Syncopate`), fonts.load(`400 32px Manrope`), fonts.load(`600 32px Manrope`)]).then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
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

  /** Draw letter-spaced text; shrinks the font when the line would not fit in maxW. */
  private spaced(text: string, x: number, y: number, spacingEm: number, align: 'center' | 'left', font: (px: number) => string, sizePx: number, maxW = Infinity) {
    const ctx = this.ctx;
    const chars = [...text];
    const measure = (px: number) => {
      ctx.font = font(px);
      const widths = chars.map((c) => ctx.measureText(c).width);
      return { widths, total: widths.reduce((a, b) => a + b, 0) + spacingEm * px * (chars.length - 1) };
    };
    let px = sizePx;
    let m = measure(px);
    if (m.total > maxW) {
      px = sizePx * (maxW / m.total);
      m = measure(px);
    }
    let cx = align === 'center' ? x - m.total / 2 : x;
    chars.forEach((c, i) => {
      ctx.fillText(c, cx, y);
      cx += m.widths[i] + spacingEm * px;
    });
    return px;
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

    const maxW = w * 0.88;
    const display = (px: number) => `700 ${px}px ${DISPLAY_FONT}`;
    const body = (weight: number) => (px: number) => `${weight} ${px}px ${FONT_STACK}`;
    for (const { a, c, t } of items) {
      const cue = c.cue;
      const rise = (1 - smoothstep(0, 1.4, t)) * s * 0.012;
      const track = 0.1 + 0.08 * smoothstep(0, cue.duration, t);
      if (cue.kind === 'title') {
        const y = h * (portrait ? 0.2 : 0.17) + rise;
        const size = s * 0.05;
        const text = cue.text.toUpperCase();
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.shadowColor = `rgba(120,180,255,${0.55 * a})`;
        ctx.shadowBlur = size * 0.6;
        const px = this.spaced(text, w / 2, y, track, 'center', display, size, maxW);
        ctx.shadowBlur = 0;
        this.spaced(text, w / 2, y, track, 'center', display, size, maxW);
        if (cue.sub) {
          ctx.fillStyle = `rgba(200,220,255,${0.82 * a})`;
          this.spaced(cue.sub, w / 2, y + Math.max(px, size * 0.7) * 1.25, 0.08, 'center', body(500), size * 0.46, maxW);
        }
      } else if (cue.kind === 'equation') {
        const lines = cue.lines ?? [];
        const size = s * 0.036;
        const lead = size * 1.55;
        const y0 = h * (portrait ? 0.72 : 0.7) - (lines.length - 1) * lead * 0.5 + rise;
        ctx.fillStyle = `rgba(150,200,255,${0.9 * a})`;
        this.spaced(cue.text.toUpperCase(), w / 2, y0 - lead * 1.15, 0.42, 'center', body(600), s * 0.024, maxW);
        lines.forEach((line, k) => {
          const la = a * smoothstep(0.35 * k, 0.35 * k + 0.7, t);
          if (la <= 0.002) return;
          ctx.fillStyle = `rgba(255,255,255,${la})`;
          ctx.shadowColor = `rgba(140,190,255,${0.5 * la})`;
          ctx.shadowBlur = size * 0.5;
          this.spaced(line, w / 2, y0 + k * lead + (1 - smoothstep(0.35 * k, 0.35 * k + 0.9, t)) * size * 0.4, 0.02, 'center', body(500), size, maxW);
          ctx.shadowBlur = 0;
        });
      } else if (cue.kind === 'kicker') {
        const y = h * (portrait ? 0.2 : 0.17) - s * 0.07 + rise;
        ctx.fillStyle = `rgba(150,200,255,${0.9 * a})`;
        this.spaced(cue.text.toUpperCase(), w / 2, y, 0.42, 'center', body(600), s * 0.024, maxW);
      } else {
        const y = h * (portrait ? 0.74 : 0.8) + rise;
        const size = s * 0.04;
        const text = cue.text.toUpperCase();
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.shadowColor = `rgba(255,170,90,${0.5 * a})`;
        ctx.shadowBlur = size * 0.7;
        const px = this.spaced(text, w / 2, y, track, 'center', display, size, maxW);
        ctx.shadowBlur = 0;
        this.spaced(text, w / 2, y, track, 'center', display, size, maxW);
        if (cue.sub) {
          ctx.fillStyle = `rgba(220,230,255,${0.82 * a})`;
          this.spaced(cue.sub, w / 2, y + Math.max(px, size * 0.7) * 1.3, 0.06, 'center', body(500), size * 0.55, maxW);
        }
      }
    }

    for (const l of labs) {
      const size = s * 0.024;
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
      this.spaced(l.text, l.x + ox, l.y + oy, 0.06, 'left', body(600), size);
      ctx.shadowBlur = 0;
    }

    if (this.enabled && this.handle) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      this.spaced(this.handle, w / 2, h * (portrait ? 0.93 : 0.94), 0.2, 'center', body(600), s * 0.022, maxW);
    }
    return true;
  }
}

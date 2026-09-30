import { backOut } from '../core/easing';

export interface Pop {
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  rot: number;
  size: number;
  color: string;
  rise: number;
}

export interface PopOptions {
  size?: number;
  color?: string;
  life?: number;
  rot?: number;
  rise?: number;
  /** Ignore the rate limit (for important words). */
  force?: boolean;
}

export const POP_FONT = '"Bangers", "Luckiest Guy", Impact, "Arial Black", sans-serif';

/** Comic-book onomatopoeia that pop, hang, and float away. Rate limited so they stay funny. */
export class WordPops {
  readonly list: Pop[] = [];
  max = 9;
  private cooldown = 0;

  add(text: string, x: number, y: number, rand: () => number, o: PopOptions = {}): boolean {
    if (!o.force && (this.cooldown > 0 || this.list.length >= this.max)) return false;
    if (this.list.length >= this.max) this.list.shift();
    this.cooldown = 0.09;
    this.list.push({
      text,
      x,
      y,
      t: 0,
      life: o.life ?? 0.95,
      rot: o.rot ?? (rand() - 0.5) * 0.45,
      size: o.size ?? 34,
      color: o.color ?? '#ffe45c',
      rise: o.rise ?? 36,
    });
    return true;
  }

  clear(): void {
    this.list.length = 0;
  }

  update(dt: number): void {
    this.cooldown -= dt;
    const l = this.list;
    let w = 0;
    for (const p of l) {
      p.t += dt;
      if (p.t < p.life) l[w++] = p;
    }
    l.length = w;
  }

  draw(ctx: CanvasRenderingContext2D, upright: number): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const p of this.list) {
      const k = p.t / p.life;
      const inT = Math.min(1, p.t / 0.16);
      const scale = backOut(inT) * (k > 0.75 ? 1 + (k - 0.75) * 0.8 : 1);
      const alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      if (alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y - p.rise * Math.min(1, k * 1.4));
      ctx.rotate(upright + p.rot);
      ctx.scale(scale, scale);
      ctx.font = `${p.size}px ${POP_FONT}`;
      ctx.lineWidth = p.size * 0.22;
      ctx.strokeStyle = '#1c1233';
      ctx.fillStyle = '#1c1233';
      ctx.fillText(p.text, 3, 4);
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

import { Scrub, scrubGain } from './scrub';

/**
 * The English widget: a little cue ball (with the real one's googly eyes) and a chalk dot for
 * where the stick will hit it. Drag on it to move the dot by how far you drag (slowly for fine
 * steps; it never jumps to your finger): below centre is draw, above is follow, left/right is side
 * spin. No notches: anywhere on the ball is fair game. Double-tap to reset. Poking it in the eye
 * is possible, and noticed.
 */

export interface SpinHooks {
  get(): { x: number; y: number };
  set(x: number, y: number): void;
  gesture(): void;
  /** The dot landed on an eye. */
  ouch(): void;
}

const EYES = [
  { x: -0.34, y: -0.3 },
  { x: 0.34, y: -0.3 },
];
const EYE_HIT = 0.2;
/** English (in ball radii) per px of drag: slow and careful up to a flick. */
const FINE = 0.004;
const COARSE = 0.022;

export class SpinWidget {
  readonly el: HTMLElement;
  private readonly ball: HTMLElement;
  private readonly dot: HTMLElement;
  private readonly pupils: HTMLElement[] = [];
  private readonly tag: HTMLElement;
  private drag: { id: number; scrub: Scrub; x: number; y: number } | null = null;
  private lastTap = 0;
  private wasOuch = false;
  private shown = '';

  constructor(private readonly hooks: SpinHooks) {
    this.el = document.createElement('div');
    this.el.className = 'spinw';
    this.ball = document.createElement('div');
    this.ball.className = 'spinw-ball';
    this.ball.setAttribute('role', 'slider');
    this.ball.setAttribute('aria-label', 'English: where the stick hits the cue ball');
    for (const e of EYES) {
      const eye = document.createElement('span');
      eye.className = 'spinw-eye';
      eye.style.left = `${50 + e.x * 50}%`;
      eye.style.top = `${50 + e.y * 50}%`;
      const pupil = document.createElement('i');
      eye.append(pupil);
      this.pupils.push(pupil);
      this.ball.append(eye);
    }
    this.dot = document.createElement('span');
    this.dot.className = 'spinw-dot';
    this.ball.append(this.dot);
    this.tag = document.createElement('div');
    this.tag.className = 'spinw-tag';
    this.el.append(this.ball, this.tag);

    this.ball.addEventListener('pointerdown', (e) => {
      this.hooks.gesture();
      const now = performance.now();
      if (now - this.lastTap < 320) {
        this.hooks.set(0, 0);
        this.lastTap = 0;
        return;
      }
      this.lastTap = now;
      const { x, y } = this.hooks.get();
      this.drag = { id: e.pointerId, scrub: new Scrub(e.clientX, e.clientY, e.timeStamp), x, y };
      try {
        this.ball.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events cannot be captured.
      }
      e.preventDefault();
    });
    this.ball.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.drag?.id) this.scrubTo(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.drag?.id) this.drag = null;
    };
    this.ball.addEventListener('pointerup', end);
    this.ball.addEventListener('pointercancel', end);
  }

  private scrubTo(e: PointerEvent): void {
    const d = this.drag!;
    const m = d.scrub.move(e.clientX, e.clientY, e.timeStamp);
    const g = scrubGain(m.speed, FINE, COARSE);
    let x = d.x + m.dx * g;
    let y = d.y + m.dy * g;
    // Held to the ball's face (the dot slides round the rim rather than stopping dead).
    const r = Math.hypot(x, y);
    if (r > 1) {
      x /= r;
      y /= r;
    }
    d.x = x;
    d.y = y;
    this.hooks.set(x, y);
  }

  update(visible: boolean): void {
    this.el.classList.toggle('show', visible);
    if (!visible) return;
    const { x, y } = this.hooks.get();
    const key = `${x.toFixed(3)},${y.toFixed(3)}`;
    if (key === this.shown) return;
    this.shown = key;
    this.dot.style.left = `${50 + x * 39}%`;
    this.dot.style.top = `${50 + y * 39}%`;
    // The eyes watch the chalk dot.
    this.pupils.forEach((p, i) => {
      const e = EYES[i]!;
      const dx = x - e.x;
      const dy = y - e.y;
      const l = Math.hypot(dx, dy) || 1;
      p.style.transform = `translate(${((dx / l) * 2.2).toFixed(2)}px, ${((dy / l) * 2.2).toFixed(2)}px)`;
    });
    const ouch = EYES.some((e) => Math.hypot(x - e.x, y - e.y) < EYE_HIT);
    this.ball.classList.toggle('ouch', ouch);
    if (ouch && !this.wasOuch) this.hooks.ouch();
    this.wasOuch = ouch;
    const m = Math.hypot(x, y);
    let tag = 'STUN';
    if (m > 0.12) {
      const vert = y > 0.25 ? 'DRAW' : y < -0.25 ? 'FOLLOW' : '';
      const side = x > 0.25 ? 'RIGHT' : x < -0.25 ? 'LEFT' : '';
      tag = [vert, side].filter(Boolean).join(' + ') || 'NUDGE';
    }
    this.tag.textContent = ouch ? 'OW!' : tag;
  }
}

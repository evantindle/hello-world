import { inNotch, notched, Scrub, scrubGain, unnotched } from './scrub';

/**
 * The power dial: a 270-degree ring around the SHOOT button. Drag on it (up or right for more,
 * down or left for less; slowly for fine steps), scroll on it, or use the arrow keys; press SHOOT
 * and the stick winds up to that power and strikes. The power clicks into a gentle notch every 5%.
 */

const SVG = 'http://www.w3.org/2000/svg';
const C = 100; // viewBox centre
const RR = 86; // ring radius
const SWEEP = (270 * Math.PI) / 180;
const START = (-135 * Math.PI) / 180; // from 12 o'clock, clockwise
/** Power per px of drag: slow and careful (10 px a percent) up to a flick. */
const FINE = 0.001;
const COARSE = 0.01;
/** CSS px a press may wander before it counts as a drag rather than a tap. */
const SLOP = 6;

/** A short buzz where the phone supports it (Android): the feel of a notch. */
function buzz(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Not allowed here.
  }
}

export interface DialHooks {
  get(): number;
  set(v: number): void;
  shoot(): void;
  gesture(): void;
}

function point(a: number, r = RR): [number, number] {
  return [C + Math.sin(a) * r, C - Math.cos(a) * r];
}

function arcPath(a0: number, a1: number): string {
  const [x0, y0] = point(a0);
  const [x1, y1] = point(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${RR} ${RR} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export class PowerDial {
  readonly el: HTMLElement;
  readonly button: HTMLButtonElement;
  private readonly value: SVGPathElement;
  private readonly knob: SVGCircleElement;
  private readonly pct: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;
  private drag: { id: number; x0: number; y0: number; scrub: Scrub | null; raw: number } | null = null;
  /** The last press turned into a drag (so it was not a tap on SMACK). */
  private dragged = false;
  private shown = -1;
  private notchT = 0;

  constructor(private readonly hooks: DialHooks) {
    this.el = document.createElement('div');
    this.el.className = 'dial';
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.classList.add('dial-ring');
    const outline = document.createElementNS(SVG, 'path');
    outline.setAttribute('d', arcPath(START, START + SWEEP));
    outline.classList.add('dial-outline');
    const track = document.createElementNS(SVG, 'path');
    track.setAttribute('d', arcPath(START, START + SWEEP));
    track.classList.add('dial-track');
    this.value = document.createElementNS(SVG, 'path');
    this.value.classList.add('dial-value');
    // A tick at every notch (5%), longer every 10% and at the ends and middle.
    for (let i = 0; i <= 20; i++) {
      const a = START + (SWEEP * i) / 20;
      const [x0, y0] = point(a, RR - 13);
      const [x1, y1] = point(a, RR - (i % 10 === 0 ? 22 : i % 2 === 0 ? 18 : 16));
      const tick = document.createElementNS(SVG, 'line');
      tick.setAttribute('x1', x0.toFixed(2));
      tick.setAttribute('y1', y0.toFixed(2));
      tick.setAttribute('x2', x1.toFixed(2));
      tick.setAttribute('y2', y1.toFixed(2));
      tick.classList.add('dial-tick');
      svg.append(tick);
    }
    this.knob = document.createElementNS(SVG, 'circle');
    this.knob.setAttribute('r', '13');
    this.knob.classList.add('dial-knob');
    svg.prepend(outline, track);
    svg.append(this.value, this.knob);

    this.button = document.createElement('button');
    this.button.className = 'shoot';
    this.button.setAttribute('aria-label', 'Shoot');
    this.button.title = 'Shoot (Space)';
    this.fill = document.createElement('span');
    this.fill.className = 'shoot-fill';
    this.label = document.createElement('span');
    this.label.className = 'shoot-label';
    this.label.innerHTML = 'SMACK!';
    this.button.append(this.fill, this.label);
    this.button.addEventListener('click', () => {
      // A drag that started on the button set the power; only a tap shoots.
      if (this.dragged) return;
      this.hooks.gesture();
      this.hooks.shoot();
    });
    this.button.addEventListener('contextmenu', (e) => e.preventDefault());

    this.pct = document.createElement('div');
    this.pct.className = 'dial-pct';

    this.el.append(svg, this.button, this.pct);

    // The whole dial, SMACK button and all, is somewhere to drag: phones hand a touch near a button
    // to the button, so the thin ring alone would be hard to catch. Touching changes nothing; past
    // a little slop the drag moves the power by how far the finger travels (and a tap still
    // shoots).
    this.el.addEventListener('pointerdown', (e) => {
      // Only while the shoot controls are out (planning).
      if (this.drag || !this.el.parentElement?.classList.contains('show')) return;
      this.hooks.gesture();
      this.dragged = false;
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, scrub: null, raw: 0 };
      if (e.target !== this.button && !this.button.contains(e.target as Node)) e.preventDefault();
    });
    this.el.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      if (!d.scrub) {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < SLOP) return;
        // It is a drag: follow it anywhere on the screen from here.
        d.scrub = new Scrub(e.clientX, e.clientY, e.timeStamp);
        d.raw = unnotched(this.hooks.get());
        this.dragged = true;
        try {
          this.el.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic events cannot be captured.
        }
        return;
      }
      this.scrubTo(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.drag?.id) this.drag = null;
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.hooks.set(this.hooks.get() + (e.deltaY < 0 ? 0.02 : -0.02));
      },
      { passive: false },
    );
  }

  private scrubTo(e: PointerEvent): void {
    const d = this.drag!;
    const m = d.scrub!.move(e.clientX, e.clientY, e.timeStamp);
    const was = inNotch(d.raw);
    d.raw = Math.max(0, Math.min(1, d.raw + (m.dx - m.dy) * scrubGain(m.speed, FINE, COARSE)));
    this.hooks.set(notched(d.raw));
    if (!was && inNotch(d.raw)) {
      buzz();
      this.notchT = performance.now();
    }
  }

  /** Per frame: the ring shows the dial; during the windup the button fills up. */
  update(dial: number, charging: boolean, power: number): void {
    const q = Math.round(dial * 1000);
    if (q !== this.shown) {
      this.shown = q;
      const a = START + SWEEP * dial;
      this.value.setAttribute('d', dial > 0.001 ? arcPath(START, a) : '');
      const [kx, ky] = point(a);
      this.knob.setAttribute('cx', kx.toFixed(2));
      this.knob.setAttribute('cy', ky.toFixed(2));
      this.pct.textContent = `${Math.round(dial * 100)}%`;
      this.el.dataset.zone = dial < 0.35 ? 'soft' : dial < 0.75 ? 'mid' : 'hard';
    }
    this.fill.style.transform = `scaleY(${charging && dial > 0 ? power / dial : 0})`;
    // The knob flashes as the power clicks into a notch.
    this.el.classList.toggle('notch', performance.now() - this.notchT < 140);
    this.el.classList.toggle('charging', charging);
    const label = charging ? 'WIND<br>UP!' : dial >= 0.99 ? 'MEGA<br>SMACK!' : 'SMACK!';
    if (this.label.innerHTML !== label) this.label.innerHTML = label;
  }
}

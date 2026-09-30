/**
 * The power dial: a 270-degree ring around the SHOOT button. Drag round it, scroll on it, or use
 * the arrow keys; press SHOOT and the stick winds up to that power and strikes.
 */

const SVG = 'http://www.w3.org/2000/svg';
const C = 100; // viewBox centre
const RR = 86; // ring radius
const SWEEP = (270 * Math.PI) / 180;
const START = (-135 * Math.PI) / 180; // from 12 o'clock, clockwise

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
  private dragging: number | null = null;
  private shown = -1;

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
    // Tick marks every 10%.
    for (let i = 0; i <= 10; i++) {
      const a = START + (SWEEP * i) / 10;
      const [x0, y0] = point(a, RR - 13);
      const [x1, y1] = point(a, RR - (i % 5 === 0 ? 22 : 18));
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
      this.hooks.gesture();
      this.hooks.shoot();
    });
    this.button.addEventListener('contextmenu', (e) => e.preventDefault());

    this.pct = document.createElement('div');
    this.pct.className = 'dial-pct';

    this.el.append(svg, this.button, this.pct);

    svg.addEventListener('pointerdown', (e) => {
      this.hooks.gesture();
      this.dragging = e.pointerId;
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events cannot be captured.
      }
      this.fromPointer(svg, e);
      e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.dragging) this.fromPointer(svg, e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.dragging) this.dragging = null;
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    this.el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.hooks.set(this.hooks.get() + (e.deltaY < 0 ? 0.02 : -0.02));
      },
      { passive: false },
    );
  }

  private fromPointer(svg: SVGSVGElement, e: PointerEvent): void {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 200 - C;
    const y = ((e.clientY - r.top) / r.height) * 200 - C;
    let a = Math.atan2(x, -y); // clockwise from 12 o'clock, in (-PI, PI]
    // The gap at the bottom snaps to whichever end is nearer: its right half (from 4:30 round to
    // 6 o'clock) to full power; its left half comes out below zero and clamps to none.
    if (a > -START) a = -START;
    this.hooks.set((a - START) / SWEEP);
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
    this.el.classList.toggle('charging', charging);
    const label = charging ? 'WIND<br>UP!' : dial >= 0.99 ? 'MEGA<br>SMACK!' : 'SMACK!';
    if (this.label.innerHTML !== label) this.label.innerHTML = label;
  }
}

import type { PartPreset, TrayItem } from '../../game/placement';

/** What a toy is called on its tray button. */
export function toyName(p: PartPreset): string {
  switch (p.kind) {
    case 'stub':
      return 'WALL';
    case 'arc':
      return 'CURVE';
    case 'bumper':
      return 'BUMPER';
    case 'glass':
      return 'GLASS';
    case 'gate':
      return 'GATE';
    case 'booster':
      return 'ZOOM PAD';
    case 'felt':
      return { ice: 'ICE', mud: 'MUD', sand: 'SAND', conveyor: 'BELT', fan: 'FAN' }[p.felt];
    case 'magnet':
      return p.polarity > 0 ? 'MAGNET' : 'PUSHER';
    case 'blackhole':
      return 'BLACK HOLE';
    case 'portal':
      return 'PORTALS';
    case 'bullseye':
      return 'TARGET';
  }
}

const INK = '#1c1233';

/** A little picture of each toy (40 x 40). */
export function toyIcon(p: PartPreset): string {
  const svg = (body: string) =>
    `<svg viewBox="0 0 40 40" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  switch (p.kind) {
    case 'stub':
      return svg(
        `<line x1="7" y1="28" x2="33" y2="12" stroke="${INK}" stroke-width="10"/><line x1="7" y1="28" x2="33" y2="12" stroke="#c86b2c" stroke-width="6"/><line x1="7" y1="28" x2="33" y2="12" stroke="#f09a55" stroke-width="2"/>`,
      );
    case 'arc':
      return svg(
        `<path d="M8 30 A16 16 0 0 1 32 14" fill="none" stroke="${INK}" stroke-width="10"/><path d="M8 30 A16 16 0 0 1 32 14" fill="none" stroke="#c86b2c" stroke-width="6"/>`,
      );
    case 'bumper':
      return svg(
        `<circle cx="20" cy="20" r="14" fill="#ff5d8f" stroke="${INK}" stroke-width="3"/><circle cx="20" cy="20" r="9" fill="#ff8fb3"/><circle cx="16" cy="18" r="2.6" fill="#fff" stroke="${INK}" stroke-width="1.2"/><circle cx="24" cy="18" r="2.6" fill="#fff" stroke="${INK}" stroke-width="1.2"/><path d="M16 24 Q20 27 24 24" fill="none" stroke="${INK}" stroke-width="1.6"/>`,
      );
    case 'glass':
      return svg(
        `<line x1="7" y1="30" x2="33" y2="10" stroke="${INK}" stroke-width="9"/><line x1="7" y1="30" x2="33" y2="10" stroke="#a0ecff" stroke-width="5"/><line x1="17" y1="22" x2="22" y2="18" stroke="#fff" stroke-width="2"/>`,
      );
    case 'gate':
      return svg(
        `<line x1="20" y1="6" x2="20" y2="34" stroke="${INK}" stroke-width="9"/><line x1="20" y1="6" x2="20" y2="34" stroke="#b388ff" stroke-width="5"/><path d="M15 15 L22 20 L15 25" fill="none" stroke="#fff8e7" stroke-width="2.6"/>`,
      );
    case 'booster':
      return svg(
        `<rect x="4" y="11" width="32" height="18" rx="6" fill="#ff9f1c" stroke="${INK}" stroke-width="3"/><path d="M11 15 L16 20 L11 25 M20 15 L25 20 L20 25" fill="none" stroke="#fff8e7" stroke-width="3"/>`,
      );
    case 'felt': {
      const look = {
        ice: `<rect x="5" y="8" width="30" height="24" rx="5" fill="#cef2ff" stroke="#fff" stroke-width="3"/><path d="M27 13 L28.5 16.5 L32 18 L28.5 19.5 L27 23 L25.5 19.5 L22 18 L25.5 16.5 Z" fill="#fff"/>`,
        mud: `<rect x="5" y="8" width="30" height="24" rx="10" fill="#7a4b2a" stroke="#3d2210" stroke-width="3"/><circle cx="15" cy="18" r="3" fill="#a87449"/><circle cx="25" cy="24" r="2" fill="#a87449"/>`,
        sand: `<rect x="5" y="8" width="30" height="24" rx="7" fill="#ecd28f" stroke="#c9a35a" stroke-width="3"/><path d="M9 17 Q14 15 19 17 T31 17 M9 24 Q14 22 19 24 T31 24" fill="none" stroke="#b8934d" stroke-width="1.6"/>`,
        conveyor: `<rect x="4" y="10" width="32" height="20" rx="4" fill="#363a4f" stroke="${INK}" stroke-width="3"/><path d="M11 13 V27 M17 13 V27 M23 13 V27 M29 13 V27" stroke="#555c7c" stroke-width="3"/><path d="M15 15 L21 20 L15 25" fill="none" stroke="#ffd23f" stroke-width="3"/>`,
        fan: `<rect x="5" y="8" width="30" height="24" rx="7" fill="rgba(170,255,230,0.35)" stroke="#fff" stroke-width="2" stroke-dasharray="4 3"/><circle cx="13" cy="20" r="6" fill="#e8f7ff" stroke="${INK}" stroke-width="2"/><path d="M22 16 H32 M24 20 H34 M22 24 H31" stroke="#fff" stroke-width="2"/>`,
      }[p.felt];
      return svg(look);
    }
    case 'magnet':
      return p.polarity > 0
        ? svg(
            `<path d="M10 8 V22 A10 10 0 0 0 30 22 V8" fill="none" stroke="${INK}" stroke-width="11"/><path d="M10 8 V22 A10 10 0 0 0 30 22 V8" fill="none" stroke="#ff4d6d" stroke-width="6.5"/><rect x="5" y="5" width="10" height="7" fill="#e6ecf7" stroke="${INK}" stroke-width="2"/><rect x="25" y="5" width="10" height="7" fill="#e6ecf7" stroke="${INK}" stroke-width="2"/>`,
          )
        : svg(
            `<circle cx="20" cy="20" r="9" fill="#2ec4b6" stroke="${INK}" stroke-width="3"/><path d="M33 20 L28 16 V24 Z M7 20 L12 16 V24 Z M20 7 L16 12 H24 Z M20 33 L16 28 H24 Z" fill="#2ec4b6" stroke="${INK}" stroke-width="1.5"/>`,
          );
    case 'blackhole':
      return svg(
        `<circle cx="20" cy="20" r="16" fill="#3a1866"/><path d="M20 6 A14 14 0 0 1 34 20 M6 20 A14 14 0 0 1 20 6 M20 34 A14 14 0 0 1 6 20" fill="none" stroke="#ff9640" stroke-width="2.5"/><circle cx="20" cy="20" r="7" fill="#05020c" stroke="#ff7b00" stroke-width="2"/>`,
      );
    case 'portal':
      return svg(
        `<circle cx="13" cy="15" r="8" fill="#05020c" stroke="#ff9f1c" stroke-width="3.5"/><circle cx="27" cy="25" r="8" fill="#05020c" stroke="#4cc9f0" stroke-width="3.5"/>`,
      );
    case 'bullseye':
      return svg(
        `<circle cx="20" cy="20" r="14" fill="#ff4d6d"/><circle cx="20" cy="20" r="9" fill="#fff8e7"/><circle cx="20" cy="20" r="4" fill="#ff4d6d"/>`,
      );
  }
}

export interface TrayHooks {
  items: () => readonly TrayItem[];
  /** A toy was pressed: start carrying it. */
  begin: (item: number, e: PointerEvent) => void;
}

/**
 * The toy tray: one button per kind of toy, with how many are left. Press and drag one onto the
 * table to put it down; drop a toy back on the tray (or off the table) to put it away.
 */
export class TrayWidget {
  readonly el: HTMLElement;
  private kinds = '';

  constructor(private readonly hooks: TrayHooks) {
    this.el = document.createElement('div');
    this.el.className = 'tray';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Toys');
  }

  update(show: boolean): void {
    const items = this.hooks.items();
    const kinds = items.map((t) => JSON.stringify(t.preset)).join('|');
    if (kinds !== this.kinds) {
      this.build(items);
      this.kinds = kinds;
    }
    items.forEach((t, i) => {
      const b = this.el.children[i] as HTMLButtonElement | undefined;
      if (!b) return;
      const n = b.querySelector('.tray-n')!;
      const text = `×${t.count}`;
      if (n.textContent !== text) n.textContent = text;
      b.disabled = t.count <= 0;
    });
    // The tray keeps its place on screen for the whole game (the table does not jump about), and
    // only shows while there is bending to do.
    this.el.classList.toggle('has', items.length > 0);
    this.el.classList.toggle('show', show && items.length > 0);
  }

  private build(items: readonly TrayItem[]): void {
    this.el.replaceChildren(
      ...items.map((t, i) => {
        const b = document.createElement('button');
        b.className = 'tray-item';
        b.type = 'button';
        b.title = `${toyName(t.preset)}: drag it onto the table`;
        b.setAttribute('aria-label', toyName(t.preset));
        b.innerHTML = `${toyIcon(t.preset)}<span class="tray-name">${toyName(t.preset)}</span><span class="tray-n"></span>`;
        b.addEventListener('pointerdown', (e) => {
          if (b.disabled) return;
          e.preventDefault();
          this.hooks.begin(i, e);
        });
        return b;
      }),
    );
  }

  /** Whether a screen point (client px) is over the tray. */
  contains(cx: number, cy: number): boolean {
    if (!this.el.classList.contains('show')) return false;
    const r = this.el.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }
}

import { REC_ROOM } from '../../game/levels/rec-room';
import type { LevelDef } from '../../game/levels/types';
import type { Progress } from '../../game/progress';
import { button, el, escapeHtml, setShown, starRow } from '../dom';

export interface LevelsHooks {
  open: (def: LevelDef) => void;
  back: () => void;
}

/** A level is open once the one before it has been won (or always, with ?dev=1). */
export function unlocked(def: LevelDef, p: Progress, dev: boolean): boolean {
  if (dev || def.n === 1) return true;
  const prev = REC_ROOM.find((l) => l.n === def.n - 1);
  return !prev || (p.levels[prev.id]?.stars ?? 0) > 0;
}

export function starsEarned(p: Progress): number {
  return REC_ROOM.reduce((a, l) => a + (p.levels[l.id]?.stars ?? 0), 0);
}

/** Level select: a card per table, with its stars; locked until the one before is won. */
export class LevelsScreen {
  readonly el: HTMLElement;
  private grid: HTMLElement;
  private total: HTMLElement;

  constructor(
    private readonly hooks: LevelsHooks,
    private readonly dev: boolean,
  ) {
    this.el = el('div', 'overlay levels hidden');
    const card = el('div', 'levels-card');
    const head = el('div', 'levels-head');
    const back = button('btn back', '◀ BACK', 'Back', hooks.back);
    const title = el('h2', 'levels-title', 'THE REC ROOM');
    this.total = el('div', 'levels-total');
    head.append(back, title, this.total);
    this.grid = el('div', 'level-grid');
    card.append(head, this.grid);
    this.el.append(card);
  }

  /** Rebuilds the cards from the player's progress. */
  render(p: Progress): void {
    this.total.textContent = `★ ${starsEarned(p)}/${REC_ROOM.length * 3}`;
    this.grid.replaceChildren(
      ...REC_ROOM.map((def) => {
        const open = unlocked(def, p, this.dev);
        const got = p.levels[def.id]?.stars ?? 0;
        const tile = button(
          `level-tile${open ? '' : ' locked'}${got > 0 ? ' done' : ''}`,
          `<span class="lt-n">${def.n}</span>
           <span class="lt-name">${escapeHtml(def.name)}</span>
           <span class="lt-teach">${open ? escapeHtml(def.teaches) : 'LOCKED'}</span>
           <span class="lt-stars">${open ? starRow(got) : '🔒'}</span>`,
          open ? `Level ${def.n}: ${def.name}` : `Level ${def.n} (locked)`,
          () => {
            if (open) this.hooks.open(def);
          },
        );
        tile.disabled = !open;
        tile.style.setProperty('--tilt', `${((def.n * 37) % 7) - 3}deg`);
        return tile;
      }),
    );
  }

  show(on: boolean): void {
    setShown(this.el, on);
  }
}

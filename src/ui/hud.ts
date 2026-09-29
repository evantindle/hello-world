import { BALL_COLORS, BUDGET, GAME_TITLE } from '../config';
import type { Game, GameOverInfo } from '../game/game';

const ICON_SOUND =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5c1.2 1 1.8 2.2 1.8 3.5s-.6 2.5-1.8 3.5M18.5 6c2 1.6 3 3.6 3 6s-1 4.4-3 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_MUTED =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICON_RESTART =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.1-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M4 3.5v5h5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface HudHooks {
  start: () => void;
  restart: () => void;
  toggleMute: () => boolean;
  isMuted: () => boolean;
  gesture: () => void;
  press: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function wobbleTitle(text: string): string {
  return [...text]
    .map((ch, i) =>
      ch === ' '
        ? '<span class="sp"> </span>'
        : `<span class="wl" style="--i:${i};--r:${((i * 37) % 11) - 5}deg">${ch}</span>`,
    )
    .join('');
}

/** The DOM overlay: counters, meters, buttons, toasts, title and score cards. */
export class Hud {
  private strokes: HTMLElement;
  private best: HTMLElement;
  private balls: HTMLElement[] = [];
  private stretch: HTMLElement;
  private stretchFill: HTMLElement;
  private stretchNum: HTMLElement;
  private undo: HTMLButtonElement;
  private shoot: HTMLButtonElement;
  private shootFill: HTMLElement;
  private shootLabel: HTMLElement;
  private hint: HTMLElement;
  private hunger: HTMLElement;
  private banner: HTMLElement;
  private toasts: HTMLElement;
  private mute: HTMLButtonElement;
  private title: HTMLElement;
  private over: HTMLElement;
  private lastScore = -1;
  private lastBest: number | null = -1;
  private shootPointer: number | null = null;
  private lastHint = '';

  constructor(
    root: HTMLElement,
    private readonly game: Game,
    private readonly hooks: HudHooks,
  ) {
    root.innerHTML = '';
    const top = el('div', 'hud-top');
    const sc = el('div', 'card score');
    sc.append(el('div', 'label', 'STROKES'));
    this.strokes = el('div', 'value', '0');
    sc.append(this.strokes, el('div', 'sub', `PAR ${game.par}`));
    const rack = el('div', 'rack');
    for (let n = 1; n <= 10; n++) {
      const d = el('div', `pip${n >= 9 ? ' dotty' : ''}`, `<span>${n}</span>`);
      d.style.setProperty('--c', BALL_COLORS[n - 1]!);
      rack.append(d);
      this.balls.push(d);
    }
    const right = el('div', 'top-right');
    const bc = el('div', 'card best');
    bc.append(el('div', 'label', 'BEST'));
    this.best = el('div', 'value', '–');
    bc.append(this.best);
    this.mute = el('button', 'icon-btn') as HTMLButtonElement;
    this.mute.title = 'Mute (M)';
    this.mute.setAttribute('aria-label', 'Toggle sound');
    this.mute.addEventListener('click', () => {
      this.hooks.gesture();
      this.hooks.toggleMute();
      this.syncMute();
    });
    const restart = el('button', 'icon-btn', ICON_RESTART) as HTMLButtonElement;
    restart.title = 'New game';
    restart.setAttribute('aria-label', 'New game');
    restart.addEventListener('click', () => {
      this.hooks.gesture();
      this.hooks.press();
      this.hooks.restart();
    });
    right.append(bc, this.mute, restart);
    top.append(sc, rack, right);

    this.hunger = el('div', 'hunger');
    this.banner = el('div', 'banner');
    this.toasts = el('div', 'toasts');

    const bottom = el('div', 'hud-bottom');
    this.stretch = el('div', 'stretch');
    this.undo = el('button', 'btn undo', 'UNDO') as HTMLButtonElement;
    this.undo.title = 'Undo this turn’s bending (Z)';
    this.undo.addEventListener('click', () => {
      this.hooks.gesture();
      this.game.undo();
    });
    const meter = el('div', 'meter');
    this.stretchFill = el('div', 'meter-fill');
    this.stretchNum = el('div', 'meter-num', '');
    meter.append(this.stretchFill, el('div', 'meter-label', 'STRETCH'), this.stretchNum);
    this.stretch.append(this.undo, meter);
    this.hint = el('div', 'hint');
    this.shoot = el('button', 'shoot') as HTMLButtonElement;
    this.shootFill = el('span', 'shoot-fill');
    this.shootLabel = el('span', 'shoot-label', 'HOLD TO<br>SMACK');
    this.shoot.append(this.shootFill, this.shootLabel);
    this.shoot.setAttribute('aria-label', 'Hold to charge, release to shoot');
    this.shoot.addEventListener('pointerdown', (e) => {
      this.hooks.gesture();
      if (this.game.beginCharge()) {
        this.shootPointer = e.pointerId;
        e.preventDefault();
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerId === this.shootPointer) {
        this.shootPointer = null;
        this.game.releaseCharge();
      }
    });
    window.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.shootPointer) {
        this.shootPointer = null;
        this.game.cancelCharge();
      }
    });
    this.shoot.addEventListener('contextmenu', (e) => e.preventDefault());
    bottom.append(this.stretch, this.hint, this.shoot);

    this.title = this.buildTitle();
    this.over = el('div', 'overlay over hidden');

    root.append(top, this.hunger, this.banner, this.toasts, bottom, this.title, this.over);
    this.syncMute();
  }

  private buildTitle(): HTMLElement {
    const o = el('div', 'overlay title');
    const card = el('div', 'title-card');
    card.innerHTML = `
      <h1 class="logo" aria-label="${GAME_TITLE}"><span class="w1">${wobbleTitle('BENDY')}</span><br><span class="w2">${wobbleTitle('BILLIARDS')}</span></h1>
      <p class="tagline">You can't aim. <b>Bend the table instead.</b></p>
      <ol class="steps">
        <li><span class="step-n">1</span><span><b>The cue spins</b> and lands wherever it likes.</span></li>
        <li><span class="step-n">2</span><span><b>Drag the knobs</b> to bend the table. Grab a <b>＋</b> to add a new bend.</span></li>
        <li><span class="step-n">3</span><span><b>Hold SMACK</b> to charge, let go to shoot. Clear all 10 balls in as few strokes as you can.</span></li>
      </ol>
      <p class="fine">Miss, and the pockets get <b>hungry</b>. Scratch, and the cue ball gets spat back out (+1 stroke).</p>`;
    const play = el('button', 'btn big play', 'PLAY!') as HTMLButtonElement;
    play.addEventListener('click', () => {
      this.hooks.gesture();
      this.hooks.press();
      this.hooks.start();
    });
    card.append(play);
    o.append(card);
    return o;
  }

  refreshMute(): void {
    this.syncMute();
  }

  private syncMute(): void {
    const m = this.hooks.isMuted();
    this.mute.innerHTML = m ? ICON_MUTED : ICON_SOUND;
    this.mute.classList.toggle('off', m);
  }

  /** Per-frame sync with the game state. Cheap: only touches the DOM on change. */
  update(): void {
    const g = this.game;
    this.title.classList.toggle('hidden', g.phase !== 'title');
    if (g.phase !== 'over') this.over.classList.add('hidden');
    const score = g.score;
    if (score !== this.lastScore) {
      this.strokes.textContent = String(score);
      if (this.lastScore >= 0) this.punch(this.strokes);
      this.lastScore = score;
    }
    if (g.best !== this.lastBest) {
      this.best.textContent = g.best === null ? '–' : String(g.best);
      this.lastBest = g.best;
    }
    for (const b of g.balls) {
      if (b.kind !== 'object') continue;
      const pip = this.balls[b.num - 1];
      if (pip) pip.classList.toggle('gone', !b.active);
    }
    const planning = g.phase === 'plan';
    this.stretch.classList.toggle('show', planning);
    const frac = Math.max(0, Math.min(1, g.budget / BUDGET));
    this.stretchFill.style.transform = `scaleX(${frac})`;
    this.stretchFill.classList.toggle('low', frac < 0.25);
    this.stretchNum.textContent = planning ? String(Math.round(g.budget)) : '';
    this.undo.disabled = !g.canUndo;
    this.shoot.classList.toggle('show', planning);
    this.shoot.classList.toggle('charging', g.charging);
    this.shoot.classList.toggle('max', g.charging && g.power >= 1);
    this.shootFill.style.transform = `scaleY(${g.charging ? g.power : 0})`;
    const label = g.charging ? (g.power >= 1 ? 'LET<br>GO!!' : 'LET GO<br>TO SMACK') : 'HOLD TO<br>SMACK';
    if (this.shootLabel.innerHTML !== label) this.shootLabel.innerHTML = label;
    this.hunger.classList.toggle('show', g.hunger > 0 && g.phase !== 'title' && g.phase !== 'over');
    this.hunger.dataset.level = String(g.hunger);
    const hungerText = ['', 'POCKETS: PECKISH', 'POCKETS: HUNGRY', 'POCKETS: RAVENOUS'][g.hunger] ?? '';
    if (this.hunger.textContent !== hungerText) this.hunger.textContent = hungerText;
    let hint = '';
    if (g.phase === 'spin') hint = 'Spinning… tap to skip';
    else if (planning && g.charging) hint = g.power >= 1 ? 'MAXIMUM SMACK. Let go!' : 'Let go to smack it!';
    else if (planning)
      hint =
        g.table.verts.length < 12
          ? 'Drag the knobs to bend the table · grab a ＋ to add a bend · hold SMACK'
          : 'Drag the knobs to bend the table · hold SMACK';
    else if (g.phase === 'respawn') hint = 'The pocket did not like the taste of that.';
    if (hint !== this.lastHint) {
      this.hint.textContent = hint;
      this.lastHint = hint;
    }
  }

  private punch(e: HTMLElement): void {
    e.classList.remove('punch');
    void e.offsetWidth;
    e.classList.add('punch');
  }

  popPip(num: number): void {
    const pip = this.balls[num - 1];
    if (pip) this.punch(pip);
  }

  showBanner(text: string, tone: 'spin' | 'bend' | 'smack' = 'spin'): void {
    const b = el('div', `banner-text ${tone}`, text);
    this.banner.replaceChildren(b);
  }

  toast(text: string, tone: 'good' | 'bad' | 'meh' | 'wow' = 'good'): void {
    const t = el('div', `toast ${tone}`, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => t.remove(), 2100);
  }

  showOver(info: GameOverInfo): void {
    const extra =
      info.penalties > 0
        ? `<span class="pen">(${info.shots} shots + ${info.penalties} scratch${info.penalties > 1 ? 'es' : ''})</span>`
        : '';
    const vsPar = info.score - info.par;
    const parText = vsPar === 0 ? 'right on par' : vsPar < 0 ? `${-vsPar} under par` : `${vsPar} over par`;
    this.over.innerHTML = `
      <div class="over-card">
        <div class="over-kicker">TABLE CLEARED!</div>
        <div class="over-score"><span class="big">${info.score}</span><span class="unit">strokes</span></div>
        <div class="over-par">${parText} ${extra}</div>
        <div class="over-rank">${info.rank.title}</div>
        <div class="over-blurb">${info.rank.blurb}</div>
        <div class="over-best">${info.isBest ? '★ NEW BEST! ★' : `Best: ${info.best}`}${info.bestStreak > 1 ? ` · longest streak ${info.bestStreak}` : ''}</div>
      </div>`;
    const again = el('button', 'btn big play', 'PLAY AGAIN') as HTMLButtonElement;
    again.addEventListener('click', () => {
      this.hooks.gesture();
      this.hooks.press();
      this.hooks.restart();
    });
    this.over.querySelector('.over-card')!.append(again);
    this.over.classList.remove('hidden');
  }
}

import { BALL_COLORS, GAME_TITLE } from '../config';
import type { Game, GameOverInfo } from '../game/game';
import { PowerDial } from './widgets/dial';
import { SpinWidget } from './widgets/spin';

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
  /** The English dot was dragged onto the cue ball's eye. */
  ouch: () => void;
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
  private cluster: HTMLElement;
  private dial: PowerDial;
  private spin: SpinWidget;
  private hint: HTMLElement;
  private hunger: HTMLElement;
  private banner: HTMLElement;
  private toasts: HTMLElement;
  private mute: HTMLButtonElement;
  private title: HTMLElement;
  private over: HTMLElement;
  private lastScore = -1;
  private lastBest: number | null = -1;
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
    this.dial = new PowerDial({
      get: () => this.game.dial,
      set: (v) => this.game.setDial(v),
      shoot: () => this.game.shoot(),
      gesture: () => this.hooks.gesture(),
    });
    this.spin = new SpinWidget({
      get: () => ({ x: this.game.englishX, y: this.game.englishY }),
      set: (x, y) => this.game.setEnglish(x, y),
      gesture: () => this.hooks.gesture(),
      ouch: () => this.hooks.ouch(),
    });
    this.cluster = el('div', 'shoot-cluster');
    this.cluster.append(this.spin.el, this.dial.el);
    bottom.append(this.stretch, this.hint, this.cluster);

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
        <li><span class="step-n">3</span><span><b>Set the power dial</b> and hit <b>SMACK</b>. Clear all 10 balls in as few strokes as you can.</span></li>
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

  /** CSS px the top and bottom HUD bars take up (the camera keeps the table clear of them). */
  bands(): { top: number; bottom: number } {
    const root = this.hint.parentElement!.parentElement!;
    const top = root.querySelector('.hud-top')!.getBoundingClientRect();
    const bottom = root.querySelector('.hud-bottom')!.getBoundingClientRect();
    return { top: top.bottom, bottom: Math.max(0, window.innerHeight - bottom.top) };
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
    const lim = g.rules.reshape;
    const budgeted = lim.kind === 'budget';
    const frac = budgeted ? Math.max(0, Math.min(1, g.budget / lim.perTurn)) : 1;
    this.stretch.classList.toggle('unlimited', !budgeted);
    this.stretchFill.style.transform = `scaleX(${frac})`;
    this.stretchFill.classList.toggle('low', frac < 0.25);
    this.stretchNum.textContent = planning && budgeted ? String(Math.round(g.budget)) : '';
    this.undo.disabled = !g.canUndo;
    this.cluster.classList.toggle('show', planning);
    this.dial.button.classList.toggle('show', planning);
    this.dial.update(g.dial, g.charging, g.power);
    this.spin.update(planning && g.rules.english);
    this.hunger.classList.toggle('show', g.hunger > 0 && g.phase !== 'title' && g.phase !== 'over');
    this.hunger.dataset.level = String(g.hunger);
    const hungerText = ['', 'POCKETS: PECKISH', 'POCKETS: HUNGRY', 'POCKETS: RAVENOUS'][g.hunger] ?? '';
    if (this.hunger.textContent !== hungerText) this.hunger.textContent = hungerText;
    let hint = '';
    if (g.phase === 'spin') hint = 'Spinning… tap to skip';
    else if (planning && g.charging) hint = 'Winding up…';
    else if (planning)
      hint =
        g.table.verts.length < 12
          ? 'Drag the knobs to bend the table · grab a ＋ to add a bend · set the power · SMACK!'
          : 'Drag the knobs to bend the table · set the power · SMACK!';
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

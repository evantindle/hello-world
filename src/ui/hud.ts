import { BALL_COLORS, VARIANT_COLORS } from '../config';
import type { Game, GameOverInfo } from '../game/game';
import { goalText } from '../game/goals';
import { levelById, REC_ROOM } from '../game/levels/rec-room';
import type { LevelDef } from '../game/levels/types';
import { loadProgress } from '../game/progress';
import { button, el, setShown, starRow } from './dom';
import { failCard, introCard, TABLE_FLIP, winCard } from './screens/cards';
import { HomeScreen } from './screens/home';
import { LevelsScreen, starsEarned, unlocked } from './screens/levels';
import { PowerDial } from './widgets/dial';
import { SpinWidget } from './widgets/spin';
import { TrayWidget } from './widgets/tray';

const ICON_SOUND =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5c1.2 1 1.8 2.2 1.8 3.5s-.6 2.5-1.8 3.5M18.5 6c2 1.6 3 3.6 3 6s-1 4.4-3 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_MUTED =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICON_UNDO =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
const ICON_REDO =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
const ICON_RESET =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M4 4v5h5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_FF =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5l9 7-9 7zM12 5l9 7-9 7z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const ICON_HOME =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11.5 12 4l8.5 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10v9.5h4.5v-5h3v5H18V10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>';
const ICON_RESTART =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.1-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M4 3.5v5h5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface HudHooks {
  /** Start (or deal) a Free Play game. */
  freePlay: () => void;
  /** Set a Classic level up behind its intro card. */
  prepareLevel: (def: LevelDef) => void;
  /** The intro card's PLAY: on to the first spin. */
  start: () => void;
  restart: () => void;
  /** Leave the game for the menus. */
  quit: () => void;
  /** How far the camera turns the table on screen (a quarter turn on tall screens). */
  screenTurn: () => number;
  /** Every level open (?dev=1). */
  dev: boolean;
  toggleMute: () => boolean;
  isMuted: () => boolean;
  gesture: () => void;
  press: () => void;
  /** The English dot was dragged onto the cue ball's eye. */
  ouch: () => void;
  /** A toy was pressed in the tray: start carrying it over the table. */
  beginPlace: (item: number, e: PointerEvent) => void;
}

type Screen = 'home' | 'levels' | 'intro' | 'play';

/** The DOM overlay: counters, meters, buttons, toasts, the menu screens and the end cards. */
export class Hud {
  private strokes: HTMLElement;
  private strokesSub: HTMLElement;
  private styleNum: HTMLElement;
  private lastStyle = -1;
  private ff: HTMLButtonElement;
  private bestLabel: HTMLElement;
  private best: HTMLElement;
  private rack: HTMLElement;
  private rackKey = '';
  private pips = new Map<number, HTMLElement>();
  private next: HTMLElement;
  private nextArrow: SVGGElement;
  private tableName: HTMLElement;
  private lastName: string | null = null;
  private goal: HTMLElement;
  private stretch: HTMLElement;
  private stretchFill: HTMLElement;
  private stretchNum: HTMLElement;
  private undo: HTMLButtonElement;
  private redo: HTMLButtonElement;
  private reset: HTMLButtonElement;
  private restartBtn: HTMLButtonElement;
  private tokens: HTMLElement;
  private lastTokens = '';
  readonly tray: TrayWidget;
  private cluster: HTMLElement;
  private dial: PowerDial;
  private spin: SpinWidget;
  private hint: HTMLElement;
  private hunger: HTMLElement;
  private banner: HTMLElement;
  private toasts: HTMLElement;
  private mute: HTMLButtonElement;
  private home: HomeScreen;
  private levels: LevelsScreen;
  private intro: HTMLElement;
  private over: HTMLElement;
  private screen: Screen = 'home';
  private readonly root: HTMLElement;
  private lastScore = '';
  private lastBest = '';
  private lastHint = '';

  constructor(
    root: HTMLElement,
    private readonly game: Game,
    private readonly hooks: HudHooks,
  ) {
    root.innerHTML = '';
    const top = el('div', 'hud-top');
    const left = el('div', 'top-left');
    const sc = el('div', 'card score');
    sc.append(el('div', 'label', 'STROKES'));
    this.strokes = el('div', 'value', '0');
    this.strokesSub = el('div', 'sub', '');
    this.styleNum = el('div', 'sub style', '');
    sc.append(this.strokes, this.strokesSub, this.styleNum);
    // Classic: which way the cue will point on the next stroke.
    this.next = el(
      'div',
      'next-angle',
      `<svg viewBox="-20 -20 40 40" aria-hidden="true"><circle r="16.5"/><g class="na-arrow"><path d="M-10 0H9"/><path d="M3 -6 10 0 3 6"/></g></svg><span>NEXT</span>`,
    );
    this.next.title = 'Where the cue will point on your next stroke';
    this.nextArrow = this.next.querySelector('.na-arrow')!;
    left.append(sc, this.next);
    // The middle: the rack, and a Classic level's goal under it.
    const mid = el('div', 'top-mid');
    this.rack = el('div', 'rack');
    this.goal = el('div', 'goal-chip');
    mid.append(this.rack, this.goal);
    const right = el('div', 'top-right');
    const bc = el('div', 'card best');
    this.bestLabel = el('div', 'label', 'BEST');
    this.best = el('div', 'value', '–');
    bc.append(this.bestLabel, this.best);
    this.mute = el('button', 'icon-btn') as HTMLButtonElement;
    this.mute.title = 'Mute (M)';
    this.mute.setAttribute('aria-label', 'Toggle sound');
    this.mute.addEventListener('click', () => {
      this.hooks.gesture();
      this.hooks.toggleMute();
      this.syncMute();
    });
    const menu = button('icon-btn game', ICON_HOME, 'Menu', () => {
      this.hooks.gesture();
      this.hooks.press();
      this.toMenu();
    });
    menu.title = 'Back to the menu';
    this.restartBtn = button('icon-btn game', ICON_RESTART, 'New game', () => {
      this.hooks.gesture();
      this.hooks.press();
      this.hooks.restart();
    });
    this.restartBtn.title = 'New game';
    right.append(bc, this.mute, menu, this.restartBtn);
    top.append(left, mid, right);
    this.tableName = el('div', 'table-name');

    this.hunger = el('div', 'hunger');
    this.banner = el('div', 'banner');
    this.toasts = el('div', 'toasts');

    const bottom = el('div', 'hud-bottom');
    this.stretch = el('div', 'stretch');
    const editBtn = (cls: string, icon: string, label: string, title: string, act: () => void) => {
      const b = button(`btn edit ${cls}`, `${icon}<span>${label}</span>`, label, () => {
        this.hooks.gesture();
        act();
      });
      b.title = title;
      return b;
    };
    this.undo = editBtn('undo', ICON_UNDO, 'UNDO', 'Undo (Z)', () => this.game.undo());
    this.redo = editBtn('redo', ICON_REDO, 'REDO', 'Redo (Y)', () => this.game.redo());
    this.reset = editBtn('reset', ICON_RESET, 'RESET', 'Put the table back how this turn began (R)', () =>
      this.game.reset(),
    );
    const edits = el('div', 'edits');
    edits.append(this.undo, this.redo, this.reset);
    const meter = el('div', 'meter');
    this.stretchFill = el('div', 'meter-fill');
    this.stretchNum = el('div', 'meter-num', '');
    meter.append(this.stretchFill, el('div', 'meter-label', 'STRETCH'), this.stretchNum);
    this.tokens = el('div', 'tokens');
    this.stretch.append(edits, meter, this.tokens);
    this.tray = new TrayWidget({
      items: () => this.game.tray,
      begin: (item, e) => this.hooks.beginPlace(item, e),
    });
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
    // Hold to fast-forward a shot.
    this.ff = el('button', 'btn ff', `${ICON_FF}<span>HOLD</span>`) as HTMLButtonElement;
    this.ff.title = 'Hold to fast-forward (F)';
    this.ff.setAttribute('aria-label', 'Fast-forward');
    const ffOff = () => (this.game.ff = false);
    this.ff.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.hooks.gesture();
      this.game.ff = true;
      try {
        this.ff.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointers cannot be captured.
      }
    });
    this.ff.addEventListener('pointerup', ffOff);
    this.ff.addEventListener('pointercancel', ffOff);
    this.ff.addEventListener('lostpointercapture', ffOff);
    bottom.append(this.stretch, this.hint, this.cluster, this.ff);

    const tap = (fn: () => void) => () => {
      this.hooks.gesture();
      this.hooks.press();
      fn();
    };
    this.home = new HomeScreen({
      freePlay: tap(() => this.hooks.freePlay()),
      classic: tap(() => this.showLevels()),
    });
    this.levels = new LevelsScreen(
      {
        open: (def) => {
          this.hooks.gesture();
          this.hooks.press();
          this.openLevel(def);
        },
        back: tap(() => this.showHome()),
      },
      hooks.dev,
    );
    this.intro = el('div', 'overlay intro hidden');
    this.over = el('div', 'overlay over hidden');

    root.append(
      top,
      this.tableName,
      this.hunger,
      this.banner,
      this.toasts,
      this.tray.el,
      bottom,
      this.home.el,
      this.levels.el,
      this.intro,
      this.over,
    );
    this.root = root;
    this.syncMute();
    this.showHome();
  }

  // ------------------------------------------------------------------ menus

  showHome(): void {
    this.screen = 'home';
    this.home.setStars(starsEarned(loadProgress()), REC_ROOM.length * 3);
  }

  showLevels(): void {
    this.screen = 'levels';
    this.levels.render(loadProgress());
  }

  /** A level's intro card, with the level set up behind it. */
  openLevel(def: LevelDef): void {
    this.hooks.prepareLevel(def);
    this.screen = 'intro';
    const tap = (fn: () => void) => () => {
      this.hooks.gesture();
      this.hooks.press();
      fn();
    };
    this.intro.replaceChildren(
      introCard(def, loadProgress().levels[def.id], {
        play: tap(() => this.hooks.start()),
        levels: tap(() => this.showLevels()),
      }),
    );
  }

  /** Leaves the game: Classic goes back to the level select, Free Play to the front door. */
  toMenu(): void {
    const classic = this.game.rules.mode === 'classic';
    this.hooks.quit();
    if (classic) this.showLevels();
    else this.showHome();
  }

  /**
   * CSS px the HUD takes up along each edge (the camera keeps the table clear of them): the top
   * and bottom bars, the toy tray (a column on the left, or a row along the bottom), and the
   * shoot controls' box in the bottom-right corner. `mid` is the bottom of what sits over the middle
   * of the table's top edge (the rack, a level's goal).
   */
  bands(): { top: number; mid: number; bottom: number; left: number; cluster: DOMRect } {
    const root = this.hint.parentElement!.parentElement!;
    const top = root.querySelector('.hud-top')!.getBoundingClientRect();
    const bottom = root.querySelector('.hud-bottom')!.getBoundingClientRect();
    // On narrow screens a level's goal hangs below the top bar.
    const goal = this.goal.textContent ? this.goal.getBoundingClientRect().bottom : 0;
    const rack = this.rack.getBoundingClientRect();
    let left = 0;
    let low = Math.max(0, window.innerHeight - bottom.top);
    if (this.tray.el.classList.contains('has')) {
      const t = this.tray.el.getBoundingClientRect();
      if (t.height > t.width) left = t.right;
      else low = Math.max(low, window.innerHeight - t.top);
    }
    return {
      top: Math.max(top.bottom, goal),
      mid: Math.max(goal, rack.width > 0 ? rack.bottom : 0),
      bottom: low,
      left,
      cluster: this.cluster.getBoundingClientRect(),
    };
  }

  refreshMute(): void {
    this.syncMute();
  }

  private syncMute(): void {
    const m = this.hooks.isMuted();
    this.mute.innerHTML = m ? ICON_MUTED : ICON_SOUND;
    this.mute.classList.toggle('off', m);
  }

  /** The rack: one pip per object ball this game has (a level may have just two). */
  private syncRack(): void {
    const objects = this.game.balls.filter((b) => b.kind === 'object').sort((a, b) => a.num - b.num);
    const key = objects.map((b) => `${b.num}${b.variant}`).join(',');
    if (key === this.rackKey) return;
    this.rackKey = key;
    this.pips.clear();
    this.rack.replaceChildren(
      ...objects.map((b) => {
        const d = el('div', `pip${b.num >= 9 ? ' dotty' : ''} v-${b.variant}`, `<span>${b.num}</span>`);
        d.style.setProperty(
          '--c',
          VARIANT_COLORS[b.variant] ?? BALL_COLORS[(b.num - 1) % BALL_COLORS.length]!,
        );
        this.pips.set(b.num, d);
        return d;
      }),
    );
  }

  /** Per-frame sync with the game state. Cheap: only touches the DOM on change. */
  update(): void {
    const g = this.game;
    const menu = g.phase === 'title';
    if (!menu) this.screen = 'play';
    else if (this.screen === 'play') this.showHome();
    this.home.show(menu && this.screen === 'home');
    this.levels.show(menu && this.screen === 'levels');
    setShown(this.intro, menu && this.screen === 'intro');
    if (g.phase !== 'over') setShown(this.over, false);
    const classic = g.rules.mode === 'classic';
    const def = classic && g.levelId ? levelById(g.levelId) : undefined;
    this.root.classList.toggle('menu', menu);
    this.root.classList.toggle('classic', classic);
    const limit = g.rules.shotLimit;
    const scoreText = classic && limit !== null ? `${g.score}/${limit}` : String(g.score);
    if (scoreText !== this.lastScore) {
      this.strokes.textContent = scoreText;
      if (this.lastScore !== '') this.punch(this.strokes);
      this.lastScore = scoreText;
    }
    const sub = classic ? '' : `PAR ${g.par}`;
    if (this.strokesSub.textContent !== sub) this.strokesSub.textContent = sub;
    const style = classic ? 0 : g.style;
    if (style !== this.lastStyle) {
      this.styleNum.textContent = style > 0 ? `STYLE ${style.toLocaleString('en-US')}` : '';
      if (this.lastStyle >= 0 && style > this.lastStyle) this.punch(this.styleNum);
      this.lastStyle = style;
    }
    // A level's name is on its intro card; during play the goal takes its place.
    const name = classic ? null : g.tableName;
    if (name !== this.lastName) {
      this.lastName = name;
      this.tableName.textContent = name ?? '';
    }
    const inPlay = !menu && g.phase !== 'over';
    this.tableName.classList.toggle('show', !!name && inPlay);
    const goal = classic && g.rules.goal ? `GOAL: ${goalText(g.rules.goal)}` : '';
    if (this.goal.textContent !== goal) this.goal.textContent = goal;
    this.goal.classList.toggle('show', goal !== '' && inPlay);
    // Classic: the next stroke's angle, while there is a next stroke.
    const nextA = classic ? g.nextAngle : null;
    const showNext =
      nextA !== null && (g.phase === 'spin' || g.phase === 'plan') && limit !== null && g.score + 1 < limit;
    this.next.hidden = !classic;
    this.next.classList.toggle('show', showNext);
    if (showNext) {
      const deg = ((nextA + this.hooks.screenTurn()) * 180) / Math.PI;
      this.nextArrow.setAttribute('transform', `rotate(${deg.toFixed(1)})`);
    }
    this.restartBtn.title = classic ? 'Start the level again' : 'New game';
    const simming = g.phase === 'sim';
    this.ff.classList.toggle('show', simming);
    this.ff.classList.toggle('on', simming && g.ff);
    const rec = def ? loadProgress().levels[def.id] : undefined;
    const bestText = classic ? (rec ? starRow(rec.stars) : '☆☆☆') : g.best === null ? '–' : String(g.best);
    if (bestText !== this.lastBest) {
      this.best.textContent = bestText;
      this.best.classList.toggle('stars', classic);
      this.lastBest = bestText;
    }
    this.syncRack();
    for (const b of g.balls) {
      if (b.kind !== 'object') continue;
      // A ball lost in a black hole for a moment is not gone.
      this.pips.get(b.num)?.classList.toggle('gone', b.gone !== null);
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
    this.redo.disabled = !g.canRedo;
    this.reset.disabled = !g.canReset;
    // Grab tokens: one pip per token the level gives, filled while unspent.
    const tokenText = lim.kind === 'tokens' ? `${g.tokens}/${lim.tokens}` : '';
    if (tokenText !== this.lastTokens) {
      this.lastTokens = tokenText;
      if (lim.kind === 'tokens') {
        const pips = Array.from(
          { length: lim.tokens },
          (_, i) => `<i class="${i < g.tokens ? 'on' : ''}"></i>`,
        ).join('');
        this.tokens.innerHTML = `<span class="tokens-label">GRABS</span><span class="tokens-pips">${pips}</span>`;
        this.tokens.title = `${g.tokens} of ${lim.tokens} grabs left`;
      } else this.tokens.innerHTML = '';
    }
    this.stretch.classList.toggle('tokened', lim.kind === 'tokens');
    this.tray.update(planning);
    this.cluster.classList.toggle('show', planning);
    this.dial.button.classList.toggle('show', planning);
    this.dial.update(g.dial, g.charging, g.power);
    this.spin.update(planning && g.rules.english);
    this.hunger.classList.toggle('show', g.hunger > 0 && inPlay);
    this.hunger.dataset.level = String(g.hunger);
    const hungerText = ['', 'POCKETS: PECKISH', 'POCKETS: HUNGRY', 'POCKETS: RAVENOUS'][g.hunger] ?? '';
    if (this.hunger.textContent !== hungerText) this.hunger.textContent = hungerText;
    let hint = '';
    if (g.phase === 'spin') hint = 'Spinning… tap to skip';
    else if (planning && g.charging) hint = 'Winding up…';
    else if (planning && g.tray.some((t) => t.count > 0))
      hint = 'Drag toys out of the box onto the table · bend the table · set the power · SMACK!';
    else if (planning && g.tokenMode && g.tokens === 0) hint = 'Out of grabs · set the power · SMACK!';
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
    const pip = this.pips.get(num);
    if (pip) this.punch(pip);
  }

  showBanner(text: string, tone: 'spin' | 'bend' | 'smack' | 'flip' = 'spin'): void {
    const b = el('div', `banner-text ${tone}`, text);
    this.banner.replaceChildren(b);
  }

  /** The table-flip kaomoji, for a lost level. */
  flipBanner(): void {
    this.showBanner(TABLE_FLIP, 'flip');
  }

  toast(text: string, tone: 'good' | 'bad' | 'meh' | 'wow' = 'good'): void {
    const t = el('div', `toast ${tone}`, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => t.remove(), 2100);
  }

  showOver(info: GameOverInfo): void {
    const def = info.levelId ? levelById(info.levelId) : undefined;
    if (def) this.showLevelOver(def, info);
    else this.showFreeOver(info);
    setShown(this.over, true);
  }

  private showLevelOver(def: LevelDef, info: GameOverInfo): void {
    const tap = (fn: () => void) => () => {
      this.hooks.gesture();
      this.hooks.press();
      fn();
    };
    const levels = tap(() => this.toMenu());
    const retry = tap(() => this.hooks.restart());
    if (info.result === 'fail') {
      this.over.replaceChildren(failCard(def, info, { retry, levels }));
      return;
    }
    const next = REC_ROOM.find((l) => l.n === def.n + 1);
    const canNext = !!next && unlocked(next, loadProgress(), this.hooks.dev);
    this.over.replaceChildren(
      winCard(def, info, { next: canNext ? tap(() => this.openLevel(next!)) : null, replay: retry, levels }),
    );
  }

  private showFreeOver(info: GameOverInfo): void {
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
        ${info.style > 0 ? `<div class="over-style">STYLE ${info.style.toLocaleString('en-US')}</div>` : ''}
        <div class="over-best">${info.isBest ? '★ NEW BEST! ★' : `Best: ${info.best}`}${info.bestStreak > 1 ? ` · longest streak ${info.bestStreak}` : ''}</div>
      </div>`;
    const again = el('button', 'btn big play', 'PLAY AGAIN') as HTMLButtonElement;
    again.addEventListener('click', () => {
      this.hooks.gesture();
      this.hooks.press();
      this.hooks.restart();
    });
    this.over.querySelector('.over-card')!.append(again);
  }
}

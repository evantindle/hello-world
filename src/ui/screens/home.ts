import { GAME_TITLE } from '../../config';
import { button, el, setShown, wobbleTitle } from '../dom';

export interface HomeHooks {
  freePlay: () => void;
  classic: () => void;
  toyBox: () => void;
}

/** The front door: the logo, how to play, and the two ways in (Free Play and Classic). */
export class HomeScreen {
  readonly el: HTMLElement;
  private stars: HTMLElement;

  constructor(hooks: HomeHooks) {
    this.el = el('div', 'overlay title');
    const card = el('div', 'title-card');
    card.innerHTML = `
      <h1 class="logo" aria-label="${GAME_TITLE}"><span class="w1">${wobbleTitle('BENDY')}</span><br><span class="w2">${wobbleTitle('BILLIARDS')}</span></h1>
      <p class="tagline">You can't aim. <b>Bend the table instead.</b></p>
      <ol class="steps">
        <li><span class="step-n">1</span><span><b>The cue spins</b> and lands wherever it likes.</span></li>
        <li><span class="step-n">2</span><span><b>Drag the knobs</b> to bend the table. Grab a <b>＋</b> to add a new bend.</span></li>
        <li><span class="step-n">3</span><span><b>Set the power dial</b> and hit <b>SMACK</b>.</span></li>
      </ol>`;
    const modes = el('div', 'modes');
    const free = button(
      'btn big play mode',
      '<span class="mode-name">FREE PLAY</span><span class="mode-sub">Clear 10 balls in as few strokes as you can. A new table every game.</span>',
      'Free Play',
      hooks.freePlay,
    );
    const classic = button(
      'btn big mode classic',
      '<span class="mode-name">CLASSIC</span><span class="mode-sub">Puzzle tables: one goal, a few grabs, a few strokes. <b class="mode-stars"></b></span>',
      'Classic',
      hooks.classic,
    );
    this.stars = classic.querySelector('.mode-stars')!;
    const toys = button(
      'btn big mode toybox',
      '<span class="mode-name">TOY BOX</span><span class="mode-sub">Every toy, no limits. Build silly tables, rewind shots, share them.</span>',
      'Toy Box',
      hooks.toyBox,
    );
    modes.append(free, classic, toys);
    card.append(modes);
    this.el.append(card);
  }

  /** Stars earned so far, shown on the Classic button. */
  setStars(got: number, of: number): void {
    this.stars.textContent = got > 0 ? `★ ${got}/${of}` : '';
  }

  show(on: boolean): void {
    setShown(this.el, on);
  }
}

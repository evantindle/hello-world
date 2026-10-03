import type { GameOverInfo } from '../../game/game';
import { goalText, meets, starText } from '../../game/goals';
import type { LevelDef } from '../../game/levels/types';
import type { LevelRecord } from '../../game/progress';
import { button, el, escapeHtml, starRow } from '../dom';

/** The kaomoji for a lost level (drawn in a system font: the display font has no such glyphs). */
export const TABLE_FLIP = '(╯°□°)╯︵ ┻━┻';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Before a level: what it teaches, the goal, the limits, what the stars ask for, and a hint. */
export function introCard(
  def: LevelDef,
  rec: LevelRecord | undefined,
  hooks: { play: () => void; levels: () => void },
): HTMLElement {
  const card = el('div', 'over-card intro-card');
  const limits = [
    `<span><b>${def.shots}</b> ${def.shots === 1 ? 'stroke' : 'strokes'}</span>`,
    `<span><b>${def.tokens}</b> ${def.tokens === 1 ? 'grab' : 'grabs'}</span>`,
    def.english ? '<span><b>English</b> on</span>' : '',
  ].join('');
  card.innerHTML = `
    <div class="intro-kicker">LEVEL ${def.n}${rec ? ` <span class="intro-got">${starRow(rec.stars)}</span>` : ''}</div>
    <h2 class="intro-name">${escapeHtml(def.name)}</h2>
    <div class="intro-teach">NEW: ${escapeHtml(def.teaches)}</div>
    <p class="intro-blurb">${escapeHtml(def.blurb)}</p>
    <div class="intro-goal">${escapeHtml(goalText(def.goal))}</div>
    <div class="intro-limits">${limits}</div>
    <ul class="intro-stars">
      <li><span class="st">★★★</span> ${escapeHtml(starText(def.stars.three))}</li>
      <li><span class="st">★★</span> ${escapeHtml(starText(def.stars.two))}</li>
      <li><span class="st">★</span> just do it</li>
    </ul>
    ${def.hint ? `<details class="intro-hint"><summary>HINT</summary><p>${escapeHtml(def.hint)}</p></details>` : ''}`;
  const row = el('div', 'card-btns');
  row.append(
    button('btn back', 'LEVELS', 'Levels', hooks.levels),
    button('btn big play', 'PLAY!', 'Play', hooks.play),
  );
  card.append(row);
  return card;
}

/** After a win: the stars (popping in one by one), how it went, and where next. */
export function winCard(
  def: LevelDef,
  info: GameOverInfo,
  hooks: { next: (() => void) | null; again: () => void; levels: () => void; watch: () => void },
): HTMLElement {
  const card = el('div', 'over-card win-card');
  const stars = [0, 1, 2]
    .map(
      (i) => `<span class="win-star${i < info.stars ? ' on' : ''}" style="--d:${0.35 + i * 0.3}s">★</span>`,
    )
    .join('');
  const facts = {
    score: info.score,
    tokensSpent: info.tokensSpent,
    scratched: info.penalties > 0,
    eggIntact: true,
  };
  const cond = (c: LevelDef['stars']['three'], label: string) => {
    const ok = meets(c, facts);
    return `<li class="${ok ? 'ok' : 'no'}"><span class="st">${label}</span> ${escapeHtml(starText(c))} <b>${ok ? '✓' : '✗'}</b></li>`;
  };
  card.innerHTML = `
    <div class="over-kicker">LEVEL CLEARED!</div>
    <div class="win-stars" aria-label="${plural(info.stars, 'star')}">${stars}</div>
    <div class="win-name">${def.n}. ${escapeHtml(def.name)}</div>
    <div class="win-line">${plural(info.score, 'stroke')} · ${plural(info.tokensSpent, 'grab')}${info.penalties > 0 ? ` <span class="pen">(${plural(info.penalties, 'scratch', 'scratches')})</span>` : ''}</div>
    <ul class="intro-stars win-conds">${cond(def.stars.three, '★★★')}${cond(def.stars.two, '★★')}</ul>
    ${info.isBest ? '<div class="over-best">★ NEW BEST! ★</div>' : ''}`;
  const row = el('div', 'card-btns');
  row.append(
    button('btn back', 'LEVELS', 'Levels', hooks.levels),
    button('btn back', 'AGAIN', 'Play again', hooks.again),
  );
  if (hooks.next) row.append(button('btn big play', 'NEXT ▶', 'Next level', hooks.next));
  card.append(row, watchButton(hooks.watch));
  return card;
}

/** After a loss: the table got flipped, and why. */
export function failCard(
  def: LevelDef,
  info: GameOverInfo,
  hooks: { retry: () => void; levels: () => void; watch: () => void },
): HTMLElement {
  const card = el('div', 'over-card fail-card');
  card.innerHTML = `
    <div class="fail-flip" aria-hidden="true">${TABLE_FLIP}</div>
    <div class="over-kicker">${escapeHtml(info.reason ?? 'NOPE')}</div>
    <div class="win-name">${def.n}. ${escapeHtml(def.name)}</div>
    <div class="fail-goal">${escapeHtml(goalText(def.goal))}</div>`;
  const row = el('div', 'card-btns');
  row.append(
    button('btn back', 'LEVELS', 'Levels', hooks.levels),
    button('btn big play', 'TRY AGAIN', 'Try again', hooks.retry),
  );
  card.append(row, watchButton(hooks.watch));
  return card;
}

/** Under an end card: watch the last shot again. */
export function watchButton(watch: () => void): HTMLButtonElement {
  return button('watch-link', '▶ watch that shot again', 'Watch that shot again', watch);
}

/** Tiny DOM helpers shared by the HUD and the menu screens. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** A button that runs `act` on click. */
export function button(cls: string, html: string, label: string, act: () => void): HTMLButtonElement {
  const b = el('button', cls, html);
  b.setAttribute('aria-label', label);
  b.addEventListener('click', act);
  return b;
}

/** Shows or hides an overlay; a hidden one is also out of reach of focus and screen readers. */
export function setShown(e: HTMLElement, on: boolean): void {
  if (e.classList.contains('hidden') === !on && e.inert === !on) return;
  e.classList.toggle('hidden', !on);
  e.inert = !on;
  if (on) e.removeAttribute('aria-hidden');
  else e.setAttribute('aria-hidden', 'true');
}

/** Letters that wobble on their own (the logo). */
export function wobbleTitle(text: string): string {
  return [...text]
    .map((ch, i) =>
      ch === ' '
        ? '<span class="sp"> </span>'
        : `<span class="wl" style="--i:${i};--r:${((i * 37) % 11) - 5}deg">${ch}</span>`,
    )
    .join('');
}

/** Stars as text: filled then empty, out of three. */
export function starRow(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

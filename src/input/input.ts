import { R } from '../config';
import type { Vec } from '../core/vec';
import type { Game } from '../game/game';
import { partTurn, type PartHandle } from '../game/placement';
import type { Handle } from '../game/reshape';
import { pointInPolygon } from '../geom/polygon';
import type { Camera } from '../render/camera';
import type { HandleView } from '../render/draw_table';

export interface InputHooks {
  /** First gesture: unlock audio. */
  gesture: () => void;
  toggleMute: () => void;
  /** Whether a screen point (client px) is over the tray: drop a toy there to put it back. */
  overTray?: (cx: number, cy: number) => boolean;
}

/**
 * Pointer + keyboard. One active pointer at a time. In the plan phase: grab knobs and "+"
 * handles to bend the table (double-tap a bend to remove it), drag toys around, turn them by their
 * knob, carry new ones out of the tray (and drop them back in it). Tapping bare felt pokes it.
 * The mouse wheel over a toy (or Q / E for the selected one) turns it too.
 * Keys: Space/Enter shoots, arrows turn the power dial (Shift for big steps), Esc cancels a
 * windup, Z/Backspace undoes, Y or Shift+Z redoes, R resets the turn's edits, Q/E turn the selected
 * toy (Shift for fine steps), hold F to fast-forward a shot, M mutes.
 */
export class Input {
  hover: Handle | null = null;
  /** The toy (or turning knob) under the pointer. */
  partHover: PartHandle | null = null;
  /** The toy last touched: it keeps showing its turning knob. */
  selected: number | null = null;
  pointer: Vec | null = null;
  private active: number | null = null;
  private mode: 'none' | 'drag' | 'part' | 'place' = 'none';
  private lastTap = { t: 0, vid: -1 };
  /** Until the player bends something, the first plan phase shows a "DRAG ME!" tag. */
  private tutorial = true;
  /** The tray item being carried, and where its ghost is (none while over the tray itself). */
  private placing: number | null = null;
  private ghost: { item: number; x: number; y: number; ok: boolean } | null = null;
  private stowing = false;
  /** A toy being turned by the wheel or Q/E: the turn stays one edit until things go quiet. */
  private nudge: { id: number; timer: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cam: Camera,
    private readonly game: Game,
    private readonly hooks: InputHooks,
  ) {
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerleave', () => {
      if (this.mode === 'none') {
        this.hover = null;
        this.partHover = null;
        this.pointer = null;
      }
    });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyF') this.game.ff = false;
    });
    window.addEventListener('blur', () => (this.game.ff = false));
    game.events.on('phase', ({ to }) => {
      if (to !== 'plan') this.selected = null;
    });
  }

  endTutorial(): void {
    this.tutorial = false;
  }

  view(): HandleView {
    const h = this.hover;
    const ph = this.partHover;
    return {
      hoverKind: this.mode === 'none' && h ? h.kind : null,
      hoverIndex: h ? h.index : -1,
      dragVid: this.game.drag ? this.game.drag.vid : null,
      tutorial: this.tutorial,
      partHover: this.mode === 'none' && ph ? ph.id : null,
      partSelected: this.game.canReshape ? this.selected : null,
      knobHover: this.mode === 'none' && ph?.kind === 'part-rot' ? ph.id : null,
      ghost: this.ghost,
      stowing: this.stowing,
    };
  }

  private toWorld(e: PointerEvent): Vec {
    const r = this.canvas.getBoundingClientRect();
    return this.cam.screenToWorld(e.clientX - r.left, e.clientY - r.top);
  }

  private hitRadius(touch: boolean): number {
    return Math.max(R * 1.15, (touch ? 30 : 20) / this.cam.scale);
  }

  /** Turning knobs show (and can be grabbed) on the hovered and the selected toy. */
  private knobs(): number[] {
    const show = [this.selected, this.partHover?.id ?? null];
    return this.game.turnable().filter((id) => show.includes(id));
  }

  /** The tray started a drag: carry the toy over the table. */
  beginPlace(item: number, e: PointerEvent): void {
    this.hooks.gesture();
    const g = this.game;
    if (this.active !== null || !g.canReshape || (g.tray[item]?.count ?? 0) <= 0) return;
    this.active = e.pointerId;
    this.mode = 'place';
    this.placing = item;
    this.hover = null;
    this.partHover = null;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) cannot be captured; window listeners still see the release.
    }
    this.canvas.style.cursor = 'grabbing';
    this.updateGhost(e);
  }

  private updateGhost(e: PointerEvent): void {
    const item = this.placing;
    if (item === null) return;
    const p = this.toWorld(e);
    this.pointer = p;
    const over = this.hooks.overTray?.(e.clientX, e.clientY) ?? false;
    this.ghost = over ? null : { item, x: p.x, y: p.y, ok: this.game.canPlace(item, p.x, p.y) };
  }

  private readonly down = (e: PointerEvent): void => {
    this.hooks.gesture();
    if (this.active !== null) return;
    this.endNudge();
    const g = this.game;
    const p = this.toWorld(e);
    this.pointer = p;
    if (g.phase === 'spin') {
      g.skipSpin();
      return;
    }
    // A tap ends a replay (the shared-shot viewer just keeps playing).
    if (g.phase === 'replay' && g.rules.mode !== 'viewer') {
      g.stopReplay();
      return;
    }
    if (g.phase !== 'plan' || g.charging) return;
    const r = this.hitRadius(e.pointerType !== 'mouse');
    const ph = g.hitPart(p.x, p.y, r, this.knobs());
    if (ph?.kind === 'part-rot') {
      this.selected = ph.id;
      if (g.beginPartDrag(ph.id, p.x, p.y, true)) this.capture(e, 'part');
      return;
    }
    const h = g.hitHandle(p.x, p.y, r);
    if (h) {
      if (h.kind === 'vertex' && !h.pocket) {
        const vid = g.table.verts[h.index]!.id;
        const now = performance.now();
        if (now - this.lastTap.t < 380 && this.lastTap.vid === vid) {
          this.lastTap.t = 0;
          g.removeBendAt(vid);
          return;
        }
        this.lastTap = { t: now, vid };
      }
      if (g.beginDrag(h, p.x, p.y)) this.capture(e, 'drag');
      return;
    }
    if (ph) {
      this.selected = ph.id;
      if (g.beginPartDrag(ph.id, p.x, p.y, false)) this.capture(e, 'part');
      return;
    }
    this.selected = null;
    g.poke(p.x, p.y);
  };

  private capture(e: PointerEvent, mode: 'drag' | 'part') {
    this.active = e.pointerId;
    this.mode = mode;
    this.hover = null;
    this.partHover = null;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) cannot be captured; window listeners still see the release.
    }
    this.canvas.style.cursor = 'grabbing';
  }

  /** Letting go of the dragged toy here would put it back in the tray. */
  private wouldStow(e: PointerEvent, p: Vec): boolean {
    const s = this.game.partDrag;
    if (!s || s.turn) return false;
    const part = this.game.table.parts.find((q) => q.id === s.id);
    if (!part || part.placed === undefined) return false;
    return (
      !pointInPolygon(p.x, p.y, this.game.geom.poly) || (this.hooks.overTray?.(e.clientX, e.clientY) ?? false)
    );
  }

  private readonly move = (e: PointerEvent): void => {
    const p = this.toWorld(e);
    this.pointer = p;
    if (e.pointerId === this.active) {
      if (this.mode === 'drag') this.game.dragTo(p.x, p.y);
      else if (this.mode === 'part') {
        this.game.partDragTo(p.x, p.y);
        this.stowing = this.wouldStow(e, p);
      } else if (this.mode === 'place') this.updateGhost(e);
      return;
    }
    if (this.mode !== 'none') return;
    const g = this.game;
    const r = this.hitRadius(e.pointerType !== 'mouse');
    this.hover = g.hitHandle(p.x, p.y, r);
    const ph = g.hitPart(p.x, p.y, r, this.knobs());
    // A turning knob beats a table knob; a table knob beats a toy's body.
    this.partHover = ph && (ph.kind === 'part-rot' || !this.hover) ? ph : null;
    if (this.partHover?.kind === 'part-rot') this.hover = null;
    this.canvas.style.cursor =
      this.hover || this.partHover ? 'grab' : g.phase === 'spin' ? 'pointer' : 'default';
  };

  private readonly up = (e: PointerEvent): void => {
    if (e.pointerId !== this.active) return;
    const g = this.game;
    if (this.mode === 'drag') g.endDrag();
    else if (this.mode === 'part') g.endPartDrag(this.wouldStow(e, this.toWorld(e)));
    else if (this.mode === 'place' && this.ghost) {
      const n = g.table.parts.length;
      if (this.ghost.ok && g.placeFromTray(this.ghost.item, this.ghost.x, this.ghost.y)) {
        this.selected = g.table.parts[n]?.id ?? null;
      } else if (!this.ghost.ok) {
        // Let the game say why.
        g.placeFromTray(this.ghost.item, this.ghost.x, this.ghost.y);
      }
    }
    this.release();
  };

  private readonly cancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.active) return;
    if (this.mode === 'drag') this.game.endDrag();
    else if (this.mode === 'part') this.game.endPartDrag();
    this.release();
  };

  /** The wheel over a toy that can turn: 5 degrees a notch. */
  private readonly wheel = (e: WheelEvent): void => {
    const g = this.game;
    if (!g.canReshape || this.active !== null) return;
    const p = this.toWorld(e as unknown as PointerEvent);
    const ph = g.hitPart(p.x, p.y, this.hitRadius(false), this.knobs());
    const id = this.nudge?.id ?? ph?.id ?? null;
    if (id === null || !g.turnable().includes(id)) return;
    e.preventDefault();
    if (e.deltaY === 0) return;
    this.selected = id;
    this.turnBy(id, e.deltaY > 0 ? 1 : -1);
  };

  /** Turn toy `id` by `steps` 5-degree steps, as part of one ongoing nudge. */
  private turnBy(id: number, steps: number): void {
    const g = this.game;
    if (this.nudge && this.nudge.id !== id) this.endNudge();
    if (!this.nudge) {
      const part = g.table.parts.find((q) => q.id === id);
      if (!part || !g.beginPartDrag(id, part.x, part.y, true)) return;
      this.nudge = { id, timer: 0 };
    }
    const part = g.table.parts.find((q) => q.id === id);
    if (part) g.turnPartTo(partTurn(part) + steps);
    window.clearTimeout(this.nudge.timer);
    this.nudge.timer = window.setTimeout(() => this.endNudge(), 500);
  }

  private endNudge(): void {
    if (!this.nudge) return;
    window.clearTimeout(this.nudge.timer);
    this.nudge = null;
    this.game.endPartDrag();
  }

  private release() {
    this.active = null;
    this.mode = 'none';
    this.placing = null;
    this.ghost = null;
    this.stowing = false;
    this.canvas.style.cursor = 'default';
  }

  private readonly keydown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    this.hooks.gesture();
    const g = this.game;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      if (g.phase === 'title') g.start();
      else if (g.phase === 'over' && g.phaseT > 1.5) g.restart();
      else if (g.phase === 'spin') g.skipSpin();
      else if (g.phase === 'replay' && g.rules.mode !== 'viewer') g.stopReplay();
      else if (g.phase === 'plan') g.shoot();
    } else if (e.code === 'Escape') {
      g.cancelShot();
    } else if (e.code === 'ArrowUp' || e.code === 'ArrowRight') {
      e.preventDefault();
      if (g.phase === 'plan' && !g.charging) g.nudgeDial(e.shiftKey ? 0.1 : 0.02);
    } else if (e.code === 'ArrowDown' || e.code === 'ArrowLeft') {
      e.preventDefault();
      if (g.phase === 'plan' && !g.charging) g.nudgeDial(e.shiftKey ? -0.1 : -0.02);
    } else if ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY') {
      this.endNudge();
      if (g.redo()) e.preventDefault();
    } else if (e.code === 'KeyZ' || e.code === 'Backspace') {
      this.endNudge();
      if (g.undo()) e.preventDefault();
    } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
      this.endNudge();
      if (g.reset()) e.preventDefault();
    } else if ((e.code === 'KeyQ' || e.code === 'KeyE') && !e.ctrlKey && !e.metaKey) {
      const id = this.selected ?? this.partHover?.id ?? null;
      if (id !== null && g.canReshape && g.turnable().includes(id)) {
        e.preventDefault();
        this.turnBy(id, (e.code === 'KeyE' ? 1 : -1) * (e.shiftKey ? 1 : 3));
      }
    } else if (e.code === 'KeyF') {
      // Hold to fast-forward the shot.
      this.game.ff = true;
    } else if (e.code === 'KeyM') {
      this.hooks.toggleMute();
    }
  };
}

import { R } from '../config';
import type { Vec } from '../core/vec';
import type { Game } from '../game/game';
import type { Handle } from '../game/reshape';
import type { Camera } from '../render/camera';
import type { HandleView } from '../render/draw_table';

export interface InputHooks {
  /** First gesture: unlock audio. */
  gesture: () => void;
  toggleMute: () => void;
}

/**
 * Pointer + keyboard. One active pointer at a time. In the plan phase: grab knobs and "+"
 * handles to bend the table, double-tap a bend to remove it, hold the cue ball (or SHOOT, or
 * Space) to charge. Tapping bare felt pokes it.
 */
export class Input {
  hover: Handle | null = null;
  pointer: Vec | null = null;
  private active: number | null = null;
  private mode: 'none' | 'drag' | 'charge' = 'none';
  private lastTap = { t: 0, vid: -1 };
  private keyCharging = false;
  /** Until the player bends something, the first plan phase shows a "DRAG ME!" tag. */
  private tutorial = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cam: Camera,
    private readonly game: Game,
    private readonly hooks: InputHooks,
  ) {
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerleave', () => {
      if (this.mode === 'none') {
        this.hover = null;
        this.pointer = null;
      }
    });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', () => {
      if (this.keyCharging) this.game.cancelCharge();
      this.keyCharging = false;
    });
  }

  endTutorial(): void {
    this.tutorial = false;
  }

  view(): HandleView {
    const h = this.hover;
    return {
      hoverKind: this.mode === 'none' && h ? h.kind : null,
      hoverIndex: h ? h.index : -1,
      dragVid: this.game.drag ? this.game.drag.vid : null,
      tutorial: this.tutorial,
    };
  }

  private toWorld(e: PointerEvent): Vec {
    const r = this.canvas.getBoundingClientRect();
    return this.cam.screenToWorld(e.clientX - r.left, e.clientY - r.top);
  }

  private hitRadius(touch: boolean): number {
    return Math.max(R * 1.15, (touch ? 30 : 20) / this.cam.scale);
  }

  private readonly down = (e: PointerEvent): void => {
    this.hooks.gesture();
    if (this.active !== null) return;
    const g = this.game;
    const p = this.toWorld(e);
    this.pointer = p;
    if (g.phase === 'spin') {
      g.skipSpin();
      return;
    }
    if (g.phase !== 'plan' || g.charging) return;
    const h = g.hitHandle(p.x, p.y, this.hitRadius(e.pointerType !== 'mouse'));
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
    const cue = g.cue;
    if (Math.hypot(p.x - cue.x, p.y - cue.y) < R * 1.9) {
      if (g.beginCharge()) this.capture(e, 'charge');
      return;
    }
    g.poke(p.x, p.y);
  };

  private capture(e: PointerEvent, mode: 'drag' | 'charge') {
    this.active = e.pointerId;
    this.mode = mode;
    this.hover = null;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) cannot be captured; window listeners still see the release.
    }
    this.canvas.style.cursor = mode === 'drag' ? 'grabbing' : 'default';
  }

  private readonly move = (e: PointerEvent): void => {
    const p = this.toWorld(e);
    this.pointer = p;
    if (this.mode === 'drag' && e.pointerId === this.active) {
      this.game.dragTo(p.x, p.y);
      return;
    }
    if (this.mode !== 'none') return;
    const g = this.game;
    this.hover = g.hitHandle(p.x, p.y, this.hitRadius(e.pointerType !== 'mouse'));
    const nearCue = g.phase === 'plan' && !g.charging && Math.hypot(p.x - g.cue.x, p.y - g.cue.y) < R * 1.9;
    this.canvas.style.cursor = this.hover
      ? 'grab'
      : nearCue
        ? 'pointer'
        : g.phase === 'spin'
          ? 'pointer'
          : 'default';
  };

  private readonly up = (e: PointerEvent): void => {
    if (e.pointerId !== this.active) return;
    if (this.mode === 'drag') this.game.endDrag();
    else if (this.mode === 'charge') this.game.releaseCharge();
    this.release();
  };

  private readonly cancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.active) return;
    if (this.mode === 'drag') this.game.endDrag();
    else if (this.mode === 'charge') this.game.cancelCharge();
    this.release();
  };

  private release() {
    this.active = null;
    this.mode = 'none';
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
      else if (g.phase === 'plan' && g.beginCharge()) this.keyCharging = true;
    } else if (e.code === 'KeyZ' || e.code === 'Backspace') {
      if (g.undo()) e.preventDefault();
    } else if (e.code === 'KeyM') {
      this.hooks.toggleMute();
    }
  };

  private readonly keyup = (e: KeyboardEvent): void => {
    if ((e.code === 'Space' || e.code === 'Enter') && this.keyCharging) {
      this.keyCharging = false;
      this.game.releaseCharge();
    }
  };
}

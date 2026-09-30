import type { Game, Phase } from '../game/game';
import type { Camera } from '../render/camera';
import type { Handle, MoveResult } from '../game/reshape';
import { listHandles } from '../game/reshape';

export interface DebugDeps {
  game: Game;
  cam: Camera;
  /** Anything else worth poking at from the console (sfx, fx...). */
  extras?: Record<string, unknown>;
  /** Advance everything (game, fx, camera, HUD) by dt seconds of real time. */
  step: (dt: number) => void;
  draw: () => void;
  setManual: (on: boolean) => void;
}

/**
 * window.__bendy: a small, stable surface for automated tests and curious humans.
 * With manual(true) the render loop keeps drawing but time only moves when you tick().
 */
export function installDebugApi(d: DebugDeps): void {
  const { game } = d;
  const stepUntil = (pred: () => boolean, maxSeconds: number, dt = 1 / 60) => {
    let t = 0;
    while (!pred() && t < maxSeconds) {
      d.step(dt);
      t += dt;
    }
    d.draw();
    return pred();
  };
  const api = {
    ready: true,
    game,
    ...d.extras,
    phase: (): Phase => game.phase,
    manual(on = true) {
      d.setManual(on);
    },
    tick(dt = 1 / 60, n = 1) {
      for (let i = 0; i < n; i++) d.step(dt);
      d.draw();
    },
    stepSeconds(seconds: number, dt = 1 / 60) {
      stepUntil(() => false, seconds, dt);
    },
    untilPhase(phase: Phase, maxSeconds = 30) {
      return stepUntil(() => game.phase === phase, maxSeconds);
    },
    start() {
      game.start();
    },
    restart(seed?: number) {
      game.restart(seed);
    },
    forceAngle(rad: number) {
      game.forcedAngle = rad;
    },
    skipSpin() {
      game.skipSpin();
      return stepUntil(() => game.phase !== 'spin', 5);
    },
    /** Sets the dial and presses SHOOT (the windup then plays out as time is stepped). */
    shoot(power: number) {
      return game.shoot(power);
    },
    setDial(v: number) {
      game.setDial(v);
    },
    setEnglish(x: number, y: number) {
      game.setEnglish(x, y);
    },
    dragVertex(index: number, x: number, y: number): MoveResult | null {
      const v = game.table.verts[index];
      if (!v) return null;
      const h: Handle = { kind: 'vertex', index, x: v.x, y: v.y, pocket: v.pocket };
      if (!game.beginDrag(h, v.x, v.y)) return null;
      const r = game.dragTo(x, y);
      game.endDrag();
      d.draw();
      return r;
    },
    insertBend(edge: number, x: number, y: number): MoveResult | null {
      const h = listHandles(game.table).find((q) => q.kind === 'edge' && q.index === edge);
      if (!h || !game.beginDrag(h, h.x, h.y)) return null;
      const r = game.dragTo(x, y);
      game.endDrag();
      d.draw();
      return r;
    },
    undo() {
      return game.undo();
    },
    /** World -> CSS px relative to the canvas, using the live camera. */
    toScreen(x: number, y: number) {
      return d.cam.worldToScreen(x, y);
    },
    cameraSettled() {
      return (
        Math.abs(d.cam.zoom - d.cam.zoomTarget) < 0.002 && Math.abs(d.cam.focusX - d.cam.focusTargetX) < 0.5
      );
    },
    state() {
      return {
        phase: game.phase,
        shots: game.shots,
        penalties: game.penalties,
        score: game.score,
        left: game.objectsLeft,
        budget: game.budget,
        hunger: game.hunger,
        aim: game.aim,
        verts: game.table.verts.map((v) => ({ id: v.id, x: v.x, y: v.y, pocket: v.pocket })),
        balls: game.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, active: b.active })),
      };
    },
  };
  (window as unknown as { __bendy: typeof api }).__bendy = api;
}

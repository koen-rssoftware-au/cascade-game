// Single-finger drag-and-drop + tap-to-rotate.
// Tap vs drag is discriminated by DISTANCE only: touching a tray piece arms a
// "pending" gesture with zero side effects; moving ≥ PROMOTE_DIST promotes it
// to a real drag (ghost, pickup cue, landing preview). Releasing unpromoted —
// however long the press — rotates. A slow or jittery tap can therefore never
// accidentally place a piece, and rotation produces no pickup flicker.
import type { PieceDef } from '../engine/types';
import type { Renderer } from './renderer';

export interface InputCallbacks {
  getTraySlot(i: number): { piece: PieceDef; color: number } | null;
  canPlace(trayIndex: number, col: number, row: number): boolean;
  wouldClear(trayIndex: number, col: number, row: number): { rows: number[]; cols: number[] };
  onDrop(trayIndex: number, col: number, row: number): void;
  onPickup(): void;
  onCancelDrag(): void;
  /** A tap (press without real movement) on a tray piece — rotate it. */
  onTapTraySlot(trayIndex: number): void;
  enabled(): boolean;
}

/** Movement (CSS px) that turns a press into a drag — above touch jitter. */
const PROMOTE_DIST = 14;

export class InputHandler {
  private activePointer: number | null = null;
  private trayIndex = -1;
  private downX = 0;
  private downY = 0;
  private pendingSlot: { piece: PieceDef; color: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private renderer: Renderer, private cb: InputCallbacks) {
    canvas.addEventListener('pointerdown', this.onDown, { passive: false });
    canvas.addEventListener('pointermove', this.onMove, { passive: false });
    canvas.addEventListener('pointerup', this.onUp, { passive: false });
    canvas.addEventListener('pointercancel', this.onCancel, { passive: false });
  }

  private pos(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.cb.enabled() || this.activePointer !== null) return;
    const { x, y } = this.pos(e);
    const rects = this.renderer.trayRects();
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (!rect) continue;
      // generous hit area: the whole tray slot (≥44px, spec §6)
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y - 14 && y <= rect.y + rect.h) {
        const slot = this.cb.getTraySlot(i);
        if (!slot) continue;
        e.preventDefault();
        this.activePointer = e.pointerId;
        this.trayIndex = i;
        this.downX = x;
        this.downY = y;
        this.pendingSlot = slot; // no ghost, no pickup cue, no preview yet
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch {
          /* not critical */
        }
        return;
      }
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    e.preventDefault();
    const { x, y } = this.pos(e);
    if (this.pendingSlot) {
      if (Math.hypot(x - this.downX, y - this.downY) < PROMOTE_DIST) return;
      // promote the press to a real drag
      this.renderer.drag = {
        piece: this.pendingSlot.piece,
        color: this.pendingSlot.color,
        x,
        y,
        trayIndexDrawSkip: this.trayIndex,
        target: null,
      };
      this.pendingSlot = null;
      this.cb.onPickup();
    }
    const drag = this.renderer.drag;
    if (!drag) return;
    drag.x = x;
    drag.y = y;
    this.updateTarget();
  };

  private updateTarget(): void {
    const drag = this.renderer.drag;
    if (!drag) return;
    const origin = this.renderer.dragOriginCell();
    if (origin && this.cb.canPlace(this.trayIndex, origin.col, origin.row)) {
      // only recompute the would-clear simulation when the target cell changed
      if (drag.target === null || drag.target.col !== origin.col || drag.target.row !== origin.row) {
        drag.target = {
          col: origin.col,
          row: origin.row,
          wouldClear: this.cb.wouldClear(this.trayIndex, origin.col, origin.row),
        };
      }
    } else {
      drag.target = null; // illegal = no highlight (spec §3.1)
    }
  }

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    e.preventDefault();
    const trayIndex = this.trayIndex;
    const wasPending = this.pendingSlot !== null;
    const drag = this.renderer.drag;
    this.activePointer = null;
    this.trayIndex = -1;
    this.pendingSlot = null;
    if (wasPending) {
      this.cb.onTapTraySlot(trayIndex); // unpromoted press = rotate, any duration
      return;
    }
    if (!drag) return;
    const target = drag.target;
    this.renderer.drag = null;
    if (target) {
      this.cb.onDrop(trayIndex, target.col, target.row);
    } else {
      this.cb.onCancelDrag(); // piece returns to tray, board unchanged (§7.3)
    }
  };

  private onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    const hadDrag = this.renderer.drag !== null;
    this.activePointer = null;
    this.trayIndex = -1;
    this.pendingSlot = null;
    this.renderer.drag = null;
    if (hadDrag) this.cb.onCancelDrag();
  };

  cancelActive(): void {
    this.activePointer = null;
    this.trayIndex = -1;
    this.pendingSlot = null;
    this.renderer.drag = null;
  }
}

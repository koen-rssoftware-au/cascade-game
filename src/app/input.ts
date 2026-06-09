// Single-finger drag-and-drop (spec §1: no taps required mid-game except buttons).
import type { PieceDef } from '../engine/types';
import type { Renderer } from './renderer';

export interface InputCallbacks {
  getTraySlot(i: number): { piece: PieceDef; color: number } | null;
  canPlace(trayIndex: number, col: number, row: number): boolean;
  wouldClear(trayIndex: number, col: number, row: number): { rows: number[]; cols: number[] };
  onDrop(trayIndex: number, col: number, row: number): void;
  onPickup(): void;
  onCancelDrag(): void;
  enabled(): boolean;
}

export class InputHandler {
  private activePointer: number | null = null;
  private trayIndex = -1;

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
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch {
          /* not critical */
        }
        this.renderer.drag = {
          piece: slot.piece,
          color: slot.color,
          x,
          y,
          trayIndexDrawSkip: i,
          target: null,
        };
        this.updateTarget();
        this.cb.onPickup();
        return;
      }
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer || !this.renderer.drag) return;
    e.preventDefault();
    const { x, y } = this.pos(e);
    this.renderer.drag.x = x;
    this.renderer.drag.y = y;
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
    const drag = this.renderer.drag;
    const trayIndex = this.trayIndex;
    this.activePointer = null;
    this.trayIndex = -1;
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
    this.activePointer = null;
    this.trayIndex = -1;
    this.renderer.drag = null;
    this.cb.onCancelDrag();
  };

  cancelActive(): void {
    this.activePointer = null;
    this.trayIndex = -1;
    this.renderer.drag = null;
  }
}

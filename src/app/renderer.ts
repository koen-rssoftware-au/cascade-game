// Canvas renderer + cascade animation timeline (spec §3).
// The engine resolves everything instantly; this module replays ChainSteps as cosmetics.
// Animations NEVER block input (spec §3.3) — a new drop fast-forwards what is left.

import { COLS, ROWS, idx, type Board, type ChainStep, type PieceDef } from '../engine/types';
import { FxSystem, calloutFor } from './fx';
import { STR } from '../strings';

export const BLOCK_COLORS: ReadonlyArray<{ main: string; light: string; dark: string }> = [
  { main: '#000', light: '#000', dark: '#000' }, // index 0 unused (empty)
  { main: '#ff5d73', light: '#ff8da0', dark: '#c23049' }, // red
  { main: '#ffa94d', light: '#ffc78a', dark: '#d97f1f' }, // orange
  { main: '#ffd43b', light: '#ffe680', dark: '#d9a900' }, // yellow
  { main: '#51cf66', light: '#8ce99a', dark: '#2f9e44' }, // green
  { main: '#3bc9db', light: '#7fdff0', dark: '#1098ad' }, // cyan
  { main: '#5c7cfa', light: '#91a7ff', dark: '#3b5bdb' }, // blue
  { main: '#9775fa', light: '#b197fc', dark: '#7048e8' }, // purple
  { main: '#f783ac', light: '#faa2c1', dark: '#d6336c' }, // pink
];

const CLEAR_DUR = 230;
const FALL_DUR = 150; // spec §3.4
const SNAP_DUR = 100; // spec §3.2: 80–120ms

export interface Layout {
  w: number;
  h: number;
  boardX: number;
  boardY: number;
  cell: number;
  trayY: number;
  trayH: number;
  slotW: number;
}

interface FallSprite {
  col: number;
  fromRow: number;
  toRow: number;
  color: number;
  start: number;
}

interface TimelineEvent {
  at: number;
  run: (fastForward: boolean) => void;
}

export interface DragView {
  piece: PieceDef;
  color: number;
  x: number; // CSS px, finger position
  y: number;
  trayIndexDrawSkip: number; // tray slot hidden while its piece is being dragged
  // Target placement (origin cell) or null when illegal/off-board:
  target: { col: number; row: number; wouldClear: { rows: number[]; cols: number[] } } | null;
}

export interface RendererCallbacks {
  onStepFx(step: ChainStep): void; // sound + haptics per chain step
  onAllClearFx(): void;
  onTimelineDone(): void;
}

export class Renderer {
  readonly fx = new FxSystem();
  private ctx: CanvasRenderingContext2D;
  layout: Layout;
  private displayBoard: Board = new Array<number>(64).fill(0);
  private sprites: FallSprite[] = [];
  private timeline: TimelineEvent[] = [];
  private timelineStart = 0;
  private placedCells: Array<{ col: number; row: number; born: number }> = [];
  drag: DragView | null = null;
  tray: Array<{ piece: PieceDef; color: number; placeable: boolean } | null> = [null, null, null];
  private cb: RendererCallbacks;
  private allClearPending = false;

  constructor(private canvas: HTMLCanvasElement, cb: RendererCallbacks) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.cb = cb;
    this.layout = this.computeLayout();
  }

  resize(): void {
    this.layout = this.computeLayout();
  }

  private computeLayout(): Layout {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const trayH = Math.max(104, Math.min(150, h * 0.24));
    const pad = 10;
    const side = Math.min(w - pad * 2, h - trayH - pad * 3);
    const cell = Math.floor(side / COLS);
    const boardW = cell * COLS;
    const boardX = (w - boardW) / 2;
    const boardY = Math.max(pad, (h - trayH - boardW) / 2);
    return { w, h, boardX, boardY, cell, trayY: boardY + boardW + pad, trayH, slotW: boardW / 3 };
  }

  setBoard(board: Board): void {
    this.displayBoard = board.slice();
  }

  cellCenter(col: number, row: number): { x: number; y: number } {
    const { boardX, boardY, cell } = this.layout;
    return { x: boardX + col * cell + cell / 2, y: boardY + row * cell + cell / 2 };
  }

  get animating(): boolean {
    return this.timeline.length > 0 || this.sprites.length > 0;
  }

  /** Drop the pending timeline WITHOUT firing callbacks — for entering a fresh run. */
  reset(): void {
    this.timeline = [];
    this.sprites = [];
    this.placedCells = [];
    this.allClearPending = false;
    this.drag = null;
  }

  /**
   * Build the cosmetic timeline for one resolved placement (or continue reward).
   * `boardBeforeClear` = board right after the piece landed (before any clear).
   * `streakMultiplier` scales the flown "+N" so it matches points actually awarded;
   * `showPointFlyers=false` suppresses them (continue reward awards zero points).
   */
  startSteps(
    boardBeforeClear: Board,
    steps: ChainStep[],
    placed: Array<{ col: number; row: number }>,
    allClear: boolean,
    streakMultiplier = 1,
    showPointFlyers = true,
  ): void {
    this.fastForward(); // a new drop finishes whatever was left (spec §3.3 non-blocking)
    const now = performance.now();
    this.timelineStart = now;
    this.displayBoard = boardBeforeClear.slice();
    for (const c of placed) this.placedCells.push({ ...c, born: now });
    this.allClearPending = allClear;

    let t = 60; // let the snap ease read before the first pop
    let prevBoard = boardBeforeClear;
    for (const step of steps) {
      const stepRef = step;
      const preFall = prevBoard.slice();
      for (const c of stepRef.clearedCells) preFall[idx(c.col, c.row)] = 0;
      this.timeline.push({
        at: t,
        run: (ff) => {
          this.displayBoard = preFall.slice();
          if (!ff) {
            const now2 = performance.now();
            for (const c of stepRef.clearedCells) {
              const ctr = this.cellCenter(c.col, c.row);
              const col = BLOCK_COLORS[c.color] ?? BLOCK_COLORS[6];
              if (col) this.fx.burst(ctr.x, ctr.y, col.main, now2);
            }
            this.fx.shake(stepRef.step, now2);
            const callout = calloutFor(stepRef.linesCleared, stepRef.step, STR.callouts);
            if (callout) this.fx.showCallout(callout.text, callout.priority, now2);
            // points fly from the cleared lines toward the score counter (top center)
            const first = stepRef.clearedCells[0];
            if (first && showPointFlyers) {
              const ctr = this.cellCenter(first.col, first.row);
              this.fx.fly(ctr.x, ctr.y, this.layout.w / 2, -30, stepRef.pointsAfterChain * streakMultiplier, now2);
            }
            this.cb.onStepFx(stepRef);
          }
        },
      });
      this.timeline.push({
        at: t + CLEAR_DUR,
        run: (ff) => {
          if (!ff && stepRef.fallMoves.length > 0) {
            const now2 = performance.now();
            // remove falling cells from the static display; they render as sprites
            const b = this.displayBoard.slice();
            for (const m of stepRef.fallMoves) b[idx(m.col, m.fromRow)] = 0;
            this.displayBoard = b;
            for (const m of stepRef.fallMoves) {
              this.sprites.push({ col: m.col, fromRow: m.fromRow, toRow: m.toRow, color: m.color, start: now2 });
            }
          }
        },
      });
      this.timeline.push({
        at: t + CLEAR_DUR + FALL_DUR,
        run: () => {
          this.sprites = [];
          this.displayBoard = stepRef.boardAfter.slice();
        },
      });
      prevBoard = stepRef.boardAfter;
      t += CLEAR_DUR + FALL_DUR + 30;
    }
    this.timeline.push({
      at: t,
      // the PERFECT! payoff fires even when fast-forwarded by an eager next drop —
      // an all-clear must never be silently swallowed (it is the rarest jackpot)
      run: () => {
        if (this.allClearPending) {
          const now2 = performance.now();
          this.fx.showCallout(STR.callouts.perfect, 5, now2);
          this.cb.onAllClearFx();
        }
        this.allClearPending = false;
        this.cb.onTimelineDone();
      },
    });
  }

  fastForward(): void {
    if (this.timeline.length === 0 && this.sprites.length === 0) return;
    for (const ev of this.timeline) ev.run(true);
    this.timeline = [];
    this.sprites = [];
  }

  setTray(slots: Array<{ piece: PieceDef; color: number; placeable: boolean } | null>): void {
    this.tray = slots;
  }

  frame(now: number, dt: number): void {
    // run due timeline events
    while (this.timeline.length > 0) {
      const ev = this.timeline[0];
      if (!ev || now - this.timelineStart < ev.at) break;
      this.timeline.shift();
      ev.run(false);
    }
    this.fx.update(now, dt);
    this.draw(now);
  }

  // ---------------- drawing ----------------

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private drawBlock(px: number, py: number, size: number, color: number, alpha = 1, scale = 1): void {
    const c = BLOCK_COLORS[color];
    if (!c || color === 0) return;
    const ctx = this.ctx;
    const inset = size * 0.06 + (size * (1 - scale)) / 2;
    const s = size - inset * 2;
    const x = px + inset;
    const y = py + inset;
    const r = s * 0.24;
    ctx.globalAlpha = alpha;
    const grad = ctx.createLinearGradient(0, y, 0, y + s);
    grad.addColorStop(0, c.light);
    grad.addColorStop(0.35, c.main);
    grad.addColorStop(1, c.dark);
    ctx.fillStyle = grad;
    this.roundRect(x, y, s, s, r);
    ctx.fill();
    // subtle top highlight (spec §3.8)
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    this.roundRect(x + s * 0.14, y + s * 0.08, s * 0.72, s * 0.18, s * 0.09);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    const { w, h, boardX, boardY, cell } = this.layout;
    ctx.clearRect(0, 0, w, h);

    const shake = this.fx.shakeOffset(now);
    ctx.save();
    ctx.translate(shake.x, shake.y);

    // board background + grid
    const boardW = cell * COLS;
    ctx.fillStyle = 'rgba(21, 27, 58, 0.65)';
    this.roundRect(boardX - 6, boardY - 6, boardW + 12, boardW + 12, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(154, 163, 199, 0.10)';
    ctx.lineWidth = 1;
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(boardX, boardY + r * cell);
      ctx.lineTo(boardX + boardW, boardY + r * cell);
      ctx.stroke();
    }
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(boardX + c * cell, boardY);
      ctx.lineTo(boardX + c * cell, boardY + boardW);
      ctx.stroke();
    }

    // drag preview highlights (spec §3.1) — under the blocks
    const target = this.drag?.target ?? null;
    if (this.drag && target) {
      const pc = BLOCK_COLORS[this.drag.color] ?? BLOCK_COLORS[6];
      // pre-highlight rows/cols that would complete ("about to pop" tease) — brighter
      if (pc) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        for (const r of target.wouldClear.rows) ctx.fillRect(boardX, boardY + r * cell, boardW, cell);
        for (const c of target.wouldClear.cols) ctx.fillRect(boardX + c * cell, boardY, cell, boardW);
        // landing cells: soft glow in piece color
        ctx.fillStyle = pc.main;
        ctx.globalAlpha = 0.32;
        for (const [dx, dy] of this.drag.piece.cells) {
          const cc = target.col + dx;
          const rr = target.row + dy;
          this.roundRect(boardX + cc * cell + cell * 0.08, boardY + rr * cell + cell * 0.08, cell * 0.84, cell * 0.84, cell * 0.2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    // static blocks
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = this.displayBoard[idx(c, r)] ?? 0;
        if (v === 0) continue;
        let scale = 1;
        const placed = this.placedCells.find((p) => p.col === c && p.row === r);
        if (placed) {
          const t = Math.min((now - placed.born) / SNAP_DUR, 1);
          scale = 0.75 + 0.25 * (1 - Math.pow(1 - t, 2)); // 80–120ms snap ease (spec §3.2)
        }
        this.drawBlock(boardX + c * cell, boardY + r * cell, cell, v, 1, scale);
      }
    }
    this.placedCells = this.placedCells.filter((p) => now - p.born < SNAP_DUR + 50);

    // falling sprites with slight bounce (spec §3.4)
    for (const s of this.sprites) {
      const t = Math.min((now - s.start) / FALL_DUR, 1);
      // ease-in fall with a tiny landing bounce
      const eased = t < 0.85 ? (t / 0.85) * (t / 0.85) : 1 - Math.sin(((t - 0.85) / 0.15) * Math.PI) * 0.06;
      const y = s.fromRow + (s.toRow - s.fromRow) * eased;
      this.drawBlock(boardX + s.col * cell, boardY + y * cell, cell, s.color);
    }

    this.drawTray(now);
    this.fx.draw(ctx, now, boardX + boardW / 2, boardY + boardW * 0.42);
    ctx.restore();

    // dragged piece above and larger than the finger (spec §6) — drawn last, unshaken
    if (this.drag) {
      const d = this.drag;
      const size = cell * 1.08;
      const pw = d.piece.w * size;
      const ph = d.piece.h * size;
      const gx = d.x - pw / 2;
      const gy = d.y - 60 - ph; // ~60px above the finger
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 10;
      for (const [dx, dy] of d.piece.cells) {
        this.drawBlock(gx + dx * size, gy + dy * size, size, d.color);
      }
      ctx.restore();
    }
  }

  /** Where the dragged piece's origin cell visually sits, in board coords (used by input). */
  dragOriginCell(): { col: number; row: number } | null {
    if (!this.drag) return null;
    const { boardX, boardY, cell } = this.layout;
    const size = cell * 1.08;
    const pw = this.drag.piece.w * size;
    const ph = this.drag.piece.h * size;
    const gx = this.drag.x - pw / 2;
    const gy = this.drag.y - 60 - ph;
    const col = Math.round((gx + (size - cell) / 2 - boardX) / cell);
    const row = Math.round((gy + (size - cell) / 2 - boardY) / cell);
    return { col, row };
  }

  trayRects(): Array<{ x: number; y: number; w: number; h: number }> {
    const { boardX, trayY, trayH, slotW, cell } = this.layout;
    const boardW = cell * COLS;
    void boardW;
    return [0, 1, 2].map((i) => ({ x: boardX + i * slotW, y: trayY, w: slotW, h: trayH }));
  }

  private drawTray(now: number): void {
    void now;
    const rects = this.trayRects();
    for (let i = 0; i < 3; i++) {
      const slot = this.tray[i];
      const rect = rects[i];
      if (!rect) continue;
      if (!slot) continue;
      if (this.drag && this.drag.trayIndexDrawSkip === i) continue;
      const mini = Math.min((rect.w - 18) / slot.piece.w, (rect.h - 18) / slot.piece.h, this.layout.cell * 0.6);
      const pw = slot.piece.w * mini;
      const ph = slot.piece.h * mini;
      const ox = rect.x + (rect.w - pw) / 2;
      const oy = rect.y + (rect.h - ph) / 2;
      const alpha = slot.placeable ? 1 : 0.35;
      for (const [dx, dy] of slot.piece.cells) {
        this.drawBlock(ox + dx * mini, oy + dy * mini, mini, slot.color, alpha);
      }
    }
  }
}

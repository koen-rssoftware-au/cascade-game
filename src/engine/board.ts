// Board primitives — all pure; inputs are never mutated.
import { COLS, ROWS, idx } from './types';
import type { Board, FallMove, PieceDef } from './types';

/** Bounds-checked cell read (board indices are always engine-computed). */
function cellAt(board: Board, i: number): number {
  const v = board[i];
  if (v === undefined) throw new Error(`Board index out of range: ${i}`);
  return v;
}

export function emptyBoard(): Board {
  return new Array<number>(COLS * ROWS).fill(0);
}

export function canPlace(board: Board, piece: PieceDef, col: number, row: number): boolean {
  for (const [dc, dr] of piece.cells) {
    const c = col + dc;
    const r = row + dr;
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    if (cellAt(board, idx(c, r)) !== 0) return false;
  }
  return true;
}

export function anyLegalPlacement(board: Board, piece: PieceDef): boolean {
  for (let row = 0; row + piece.h <= ROWS; row++) {
    for (let col = 0; col + piece.w <= COLS; col++) {
      if (canPlace(board, piece, col, row)) return true;
    }
  }
  return false;
}

export function findFullLines(board: Board): { rows: number[]; cols: number[] } {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    let full = true;
    for (let c = 0; c < COLS; c++) {
      if (cellAt(board, idx(c, r)) === 0) {
        full = false;
        break;
      }
    }
    if (full) rows.push(r);
  }
  for (let c = 0; c < COLS; c++) {
    let full = true;
    for (let r = 0; r < ROWS; r++) {
      if (cellAt(board, idx(c, r)) === 0) {
        full = false;
        break;
      }
    }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

/**
 * Clear the given rows and columns simultaneously; a cell at a row/column
 * intersection clears exactly once (spec §2.4.2). Only filled cells are
 * reported (relevant for the continue reward, which may clear partial rows).
 */
export function clearLines(
  board: Board,
  rows: number[],
  cols: number[],
): { board: Board; cleared: Array<{ col: number; row: number; color: number }> } {
  const next = board.slice();
  const cleared: Array<{ col: number; row: number; color: number }> = [];
  const rowSet = new Set(rows);
  const colSet = new Set(cols);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!rowSet.has(r) && !colSet.has(c)) continue;
      const i = idx(c, r);
      const color = cellAt(next, i);
      if (color !== 0) {
        cleared.push({ col: c, row: r, color });
        next[i] = 0;
      }
    }
  }
  return { board: next, cleared };
}

/**
 * Gravity (spec §2.4.3): every remaining filled cell falls straight down within
 * its column until it rests on the bottom wall or another filled cell —
 * standard per-column compaction; no floating blocks survive.
 */
export function applyGravity(board: Board): { board: Board; moves: FallMove[] } {
  const next = board.slice();
  const moves: FallMove[] = [];
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const color = cellAt(next, idx(c, r));
      if (color === 0) continue;
      if (write !== r) {
        next[idx(c, write)] = color;
        next[idx(c, r)] = 0;
        moves.push({ col: c, fromRow: r, toRow: write, color });
      }
      write--;
    }
  }
  return { board: next, moves };
}

// Spec §7.1.1 (placement legality), §7.1.2 (clear detection), §7.1.3 (gravity).
import { describe, expect, it } from 'vitest';
import {
  anyLegalPlacement,
  applyGravity,
  canPlace,
  clearLines,
  emptyBoard,
  findFullLines,
} from '../../src/engine/board';
import { PIECES, getPiece } from '../../src/engine/pieces';
import { idx } from '../../src/engine/types';
import { createRng } from '../../src/engine/rng';
import type { Board } from '../../src/engine/types';

/** Build a board from 8 strings of 8 chars; '.' = empty, '1'..'8' = color. */
function b(rows: string[]): Board {
  expect(rows.length).toBe(8);
  const out: number[] = [];
  for (const row of rows) {
    expect(row.length).toBe(8);
    for (const ch of row) out.push(ch === '.' ? 0 : parseInt(ch, 10));
  }
  return out;
}

describe('placement legality (spec §7.1.1)', () => {
  it('every catalog piece at every position on an empty board: legal iff fully in-bounds', () => {
    const board = emptyBoard();
    for (const piece of PIECES) {
      // Independent expectation: piece fits iff bounding box inside the 8×8 grid.
      let maxC = 0;
      let maxR = 0;
      for (const cell of piece.cells) {
        if (cell[0] > maxC) maxC = cell[0];
        if (cell[1] > maxR) maxR = cell[1];
      }
      const w = maxC + 1;
      const h = maxR + 1;
      for (let col = 0; col < 8; col++) {
        for (let row = 0; row < 8; row++) {
          const expected = col + w <= 8 && row + h <= 8;
          expect(canPlace(board, piece, col, row), `${piece.id}@(${col},${row})`).toBe(expected);
        }
      }
    }
  });

  it('rejects any overlap with a filled cell', () => {
    const board = emptyBoard();
    board[idx(3, 3)] = 5;
    // P10 (2×2) covering (3,3) from any of its 4 anchor positions → illegal.
    const p10 = getPiece('P10');
    expect(canPlace(board, p10, 3, 3)).toBe(false);
    expect(canPlace(board, p10, 2, 3)).toBe(false);
    expect(canPlace(board, p10, 3, 2)).toBe(false);
    expect(canPlace(board, p10, 2, 2)).toBe(false);
    // Just beside the filled cell → legal.
    expect(canPlace(board, p10, 4, 3)).toBe(true);
    expect(canPlace(board, p10, 1, 3)).toBe(true);
    // P1 exactly on the filled cell → illegal; one cell over → legal.
    expect(canPlace(board, getPiece('P1'), 3, 3)).toBe(false);
    expect(canPlace(board, getPiece('P1'), 4, 3)).toBe(true);
  });

  it('legality checks never mutate the board', () => {
    const board = b([
      '1.2.3.4.',
      '........',
      '..555...',
      '........',
      '....6...',
      '77......',
      '........',
      '8......8',
    ]);
    const snapshot = board.slice();
    for (const piece of PIECES) {
      for (let col = 0; col < 8; col++) {
        for (let row = 0; row < 8; row++) {
          canPlace(board, piece, col, row);
        }
      }
      anyLegalPlacement(board, piece);
    }
    expect(board).toEqual(snapshot);
  });

  it('anyLegalPlacement agrees with exhaustive canPlace scan', () => {
    const board = b([
      '11111111',
      '11111110',      // note: '0' parses to 0? use '.' instead
      '11111111',
      '11111111',
      '11111111',
      '11111111',
      '11111111',
      '11111111',
    ].map((r) => r.replace('0', '.')));
    // Only (7,1) is empty → only P1 fits.
    expect(anyLegalPlacement(board, getPiece('P1'))).toBe(true);
    expect(anyLegalPlacement(board, getPiece('P2'))).toBe(false);
    expect(anyLegalPlacement(board, getPiece('P3'))).toBe(false);
    expect(anyLegalPlacement(board, getPiece('P11'))).toBe(false);
  });
});

describe('clear detection (spec §7.1.2)', () => {
  it('detects a single full row', () => {
    const board = emptyBoard();
    for (let c = 0; c < 8; c++) board[idx(c, 3)] = 2;
    expect(findFullLines(board)).toEqual({ rows: [3], cols: [] });
  });

  it('detects a single full column', () => {
    const board = emptyBoard();
    for (let r = 0; r < 8; r++) board[idx(5, r)] = 4;
    expect(findFullLines(board)).toEqual({ rows: [], cols: [5] });
  });

  it('row+column cross clears exactly 15 cells (intersection once), not 16', () => {
    const board = emptyBoard();
    for (let c = 0; c < 8; c++) board[idx(c, 2)] = 1; // full row 2
    for (let r = 0; r < 8; r++) board[idx(4, r)] = 3; // full col 4 (overwrites intersection)
    const { rows, cols } = findFullLines(board);
    expect(rows).toEqual([2]);
    expect(cols).toEqual([4]);
    const { board: after, cleared } = clearLines(board, rows, cols);
    expect(cleared.length).toBe(15); // 8 + 8 − 1 intersection
    // Every cleared cell is unique.
    const keys = new Set(cleared.map((c) => `${c.col},${c.row}`));
    expect(keys.size).toBe(15);
    expect(after.every((c) => c === 0)).toBe(true);
  });

  it('detects multiple simultaneous full rows', () => {
    const board = emptyBoard();
    for (const r of [1, 4, 6]) for (let c = 0; c < 8; c++) board[idx(c, r)] = 7;
    expect(findFullLines(board)).toEqual({ rows: [1, 4, 6], cols: [] });
    const { cleared } = clearLines(board, [1, 4, 6], []);
    expect(cleared.length).toBe(24);
  });

  it('full board: all 16 lines detected, 64 cells cleared', () => {
    const board: Board = new Array(64).fill(1);
    const { rows, cols } = findFullLines(board);
    expect(rows).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(cols).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const { board: after, cleared } = clearLines(board, rows, cols);
    expect(cleared.length).toBe(64);
    expect(after.every((c) => c === 0)).toBe(true);
  });

  it('clearLines does not mutate its input and reports colors', () => {
    const board = emptyBoard();
    for (let c = 0; c < 8; c++) board[idx(c, 7)] = c + 1;
    const snapshot = board.slice();
    const { cleared } = clearLines(board, [7], []);
    expect(board).toEqual(snapshot);
    expect(cleared.map((c) => c.color).sort((a, z) => a - z)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('gravity (spec §7.1.3)', () => {
  it('column with multiple gaps compacts to the bottom, preserving order', () => {
    const board = b([
      '........',
      '..1.....',
      '........',
      '..2.....',
      '........',
      '........',
      '..3..4..',
      '.....5..',
    ]);
    const { board: after, moves } = applyGravity(board);
    expect(after).toEqual(b([
      '........',
      '........',
      '........',
      '........',
      '........',
      '..1.....',
      '..2..4..',
      '..3..5..',
    ]));
    // Exact fall moves for col 2; col 5 was already grounded (no moves).
    const sorted = [...moves].sort((a, z) => a.col - z.col || a.fromRow - z.fromRow);
    expect(sorted).toEqual([
      { col: 2, fromRow: 1, toRow: 5, color: 1 },
      { col: 2, fromRow: 3, toRow: 6, color: 2 },
      { col: 2, fromRow: 6, toRow: 7, color: 3 },
    ]);
  });

  it('untouched/grounded columns are a no-op', () => {
    const board = b([
      '........',
      '........',
      '........',
      '........',
      '........',
      '......7.',
      '1.....7.',
      '12....7.',
    ]);
    const { board: after, moves } = applyGravity(board);
    expect(after).toEqual(board);
    expect(moves).toEqual([]);
  });

  it('mixed fixture: exact post-gravity board', () => {
    const board = b([
      '4......8',
      '.5......',
      '4....6..',
      '........',
      '.5...6..',
      '........',
      '.....6..',
      '3.2.....',
    ]);
    const { board: after } = applyGravity(board);
    expect(after).toEqual(b([
      '........',
      '........',
      '........',
      '........',
      '........',
      '4....6..',
      '45...6..',
      '352..6.8',
    ]));
  });

  it('does not mutate its input', () => {
    const board = b([
      '1.......',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '.......2',
    ]);
    const snapshot = board.slice();
    applyGravity(board);
    expect(board).toEqual(snapshot);
  });

  it('property: per-column filled-cell sequence preserved (200 seeded random boards)', () => {
    const rng = createRng(20260610);
    for (let trial = 0; trial < 200; trial++) {
      const board: Board = new Array(64).fill(0);
      const fillP = 0.15 + rng.next() * 0.7;
      for (let i = 0; i < 64; i++) {
        if (rng.next() < fillP) board[i] = 1 + Math.floor(rng.next() * 8);
      }
      const { board: after } = applyGravity(board);
      for (let c = 0; c < 8; c++) {
        const beforeCol: number[] = [];
        const afterCol: number[] = [];
        for (let r = 0; r < 8; r++) {
          const vb = board[idx(c, r)];
          const va = after[idx(c, r)];
          if (vb !== 0 && vb !== undefined) beforeCol.push(vb);
          if (va !== 0 && va !== undefined) afterCol.push(va);
        }
        // Same filled cells, same top-to-bottom order…
        expect(afterCol).toEqual(beforeCol);
        // …and compacted: bottom-aligned solid stack (no floating blocks).
        for (let r = 0; r < 8; r++) {
          const expected = r >= 8 - afterCol.length ? afterCol[r - (8 - afterCol.length)] : 0;
          expect(after[idx(c, r)]).toBe(expected);
        }
      }
    }
  });
});

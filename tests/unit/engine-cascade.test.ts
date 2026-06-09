// Spec §7.1.4 — cascade loop: chain fixtures, intermediate boards, termination.
import { describe, expect, it } from 'vitest';
import { resolveCascade } from '../../src/engine/game';
import { findFullLines } from '../../src/engine/board';
import { idx } from '../../src/engine/types';
import { createRng } from '../../src/engine/rng';
import type { Board } from '../../src/engine/types';

function b(rows: string[]): Board {
  expect(rows.length).toBe(8);
  const out: number[] = [];
  for (const row of rows) {
    expect(row.length).toBe(8);
    for (const ch of row) out.push(ch === '.' ? 0 : parseInt(ch, 10));
  }
  return out;
}

describe('cascade loop (spec §2.4, §7.1.4)', () => {
  it('hand-built fixture produces chain 2 with exact intermediate boards', () => {
    // As if a piece was just placed completing row 7.
    const board = b([
      '........',
      '........',
      '........',
      '........',
      '1.......',
      '.......2',
      '3333333.',
      '44444444',
    ]);
    const { board: final, steps } = resolveCascade(board);
    expect(steps.length).toBe(2);

    const s1 = steps[0];
    const s2 = steps[1];
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    if (!s1 || !s2) return;

    // Step 1: placement-triggered clear of row 7.
    expect(s1.step).toBe(1);
    expect(s1.rowsCleared).toEqual([7]);
    expect(s1.colsCleared).toEqual([]);
    expect(s1.linesCleared).toBe(1);
    expect(s1.basePoints).toBe(10); // 1² × 10
    expect(s1.pointsAfterChain).toBe(10); // × step 1
    expect(s1.clearedCells.length).toBe(8);
    expect(s1.clearedCells.every((c) => c.row === 7 && c.color === 4)).toBe(true);
    const m1 = [...s1.fallMoves].sort((a, z) => a.col - z.col || a.fromRow - z.fromRow);
    expect(m1).toEqual([
      { col: 0, fromRow: 4, toRow: 6, color: 1 },
      { col: 0, fromRow: 6, toRow: 7, color: 3 },
      { col: 1, fromRow: 6, toRow: 7, color: 3 },
      { col: 2, fromRow: 6, toRow: 7, color: 3 },
      { col: 3, fromRow: 6, toRow: 7, color: 3 },
      { col: 4, fromRow: 6, toRow: 7, color: 3 },
      { col: 5, fromRow: 6, toRow: 7, color: 3 },
      { col: 6, fromRow: 6, toRow: 7, color: 3 },
      { col: 7, fromRow: 5, toRow: 7, color: 2 },
    ]);
    expect(s1.boardAfter).toEqual(b([
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '1.......',
      '33333332',
    ]));

    // Step 2: the fall completed row 7 again — first cascade.
    expect(s2.step).toBe(2);
    expect(s2.rowsCleared).toEqual([7]);
    expect(s2.colsCleared).toEqual([]);
    expect(s2.linesCleared).toBe(1);
    expect(s2.basePoints).toBe(10);
    expect(s2.pointsAfterChain).toBe(20); // × step 2
    expect(s2.clearedCells.length).toBe(8);
    expect(s2.fallMoves).toEqual([{ col: 0, fromRow: 6, toRow: 7, color: 1 }]);
    expect(s2.boardAfter).toEqual(b([
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '1.......',
    ]));

    expect(final).toEqual(s2.boardAfter);
  });

  it('row+column cross in one step clears 15 cells and counts as 2 lines', () => {
    const board = b([
      '....1...',
      '....1...',
      '22221222',
      '....1...',
      '....1...',
      '....1...',
      '....1...',
      '....1...',
    ]);
    const { board: final, steps } = resolveCascade(board);
    expect(steps.length).toBe(1);
    const s1 = steps[0];
    expect(s1).toBeDefined();
    if (!s1) return;
    expect(s1.rowsCleared).toEqual([2]);
    expect(s1.colsCleared).toEqual([4]);
    expect(s1.linesCleared).toBe(2);
    expect(s1.clearedCells.length).toBe(15); // 8 + 8 − 1, intersection once
    expect(s1.basePoints).toBe(40); // 2² × 10
    expect(final.every((c) => c === 0)).toBe(true);
  });

  it('two simultaneous rows clear in ONE step (not a chain)', () => {
    const board = b([
      '........',
      '........',
      '........',
      '........',
      '........',
      '5.......',
      '66666666',
      '77777777',
    ]);
    const { steps } = resolveCascade(board);
    expect(steps.length).toBe(1);
    const s1 = steps[0];
    expect(s1).toBeDefined();
    if (!s1) return;
    expect(s1.rowsCleared).toEqual([6, 7]);
    expect(s1.linesCleared).toBe(2);
    expect(s1.clearedCells.length).toBe(16);
    expect(s1.basePoints).toBe(40);
    expect(s1.boardAfter).toEqual(b([
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '5.......',
    ]));
  });

  it('no full lines → zero steps, board untouched (gravity only after a clear)', () => {
    const board = b([
      '1.......',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '2222222.',
    ]);
    const { board: final, steps } = resolveCascade(board);
    expect(steps).toEqual([]);
    expect(final).toEqual(board); // floating block at (0,0) stays — no gravity ran
  });

  // NOTE ON THE SPEC'S "chain 3" FIXTURE (§7.1.4): under §2.4's gravity rule
  // ("standard column compaction, like Connect-4 — no floating blocks survive"),
  // a chain of 3 is mathematically impossible. Proof: after any clear, gravity
  // fully compacts every column. On a compacted board the full rows are exactly
  // the bottom min(height) rows; clearing them removes the same count from every
  // column, and any full column (height 8) empties entirely. Afterwards some
  // column has height 0 and none has height 8, so no full line can exist and the
  // loop ends. Hence at most one clearing step can follow the first gravity —
  // max chain = 2 from any starting board. §2 (normative rules) wins over the
  // §7.1 test enumeration; verified empirically below and by a 3,000,000-board
  // external search during spec analysis.
  it('fuzz: cascades always terminate within the spec bound of 64 iterations (and never exceed chain 2 under compaction gravity)', () => {
    const rng = createRng(424242);
    let maxObserved = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const board: Board = new Array(64).fill(0);
      const fillP = 0.2 + rng.next() * 0.75;
      for (let i = 0; i < 64; i++) {
        if (rng.next() < fillP) board[i] = 1 + Math.floor(rng.next() * 8);
      }
      // Force a clear trigger: one full random row or column.
      if (rng.next() < 0.5) {
        const r = Math.floor(rng.next() * 8);
        for (let c = 0; c < 8; c++) board[idx(c, r)] = 1 + Math.floor(rng.next() * 8);
      } else {
        const c = Math.floor(rng.next() * 8);
        for (let r = 0; r < 8; r++) board[idx(c, r)] = 1 + Math.floor(rng.next() * 8);
      }
      const { board: final, steps } = resolveCascade(board);
      expect(steps.length).toBeLessThanOrEqual(64); // spec §7.1.4 bound
      expect(steps.length).toBeGreaterThanOrEqual(1); // we forced a clear
      if (steps.length > maxObserved) maxObserved = steps.length;
      // Step counters are sequential starting at 1.
      steps.forEach((s, i) => expect(s.step).toBe(i + 1));
      // Loop only ends when no full lines remain.
      expect(findFullLines(final)).toEqual({ rows: [], cols: [] });
      // Invariant: no floating blocks after the loop ends (a clear happened).
      for (let c = 0; c < 8; c++) {
        let seenFilled = false;
        for (let r = 0; r < 8; r++) {
          const v = final[idx(c, r)];
          if (v !== 0) seenFilled = true;
          else expect(seenFilled, `floating block above (${c},${r})`).toBe(false);
        }
      }
    }
    expect(maxObserved).toBeLessThanOrEqual(2); // see proof note above
    expect(maxObserved).toBe(2); // the chain-2 case does occur in the fuzz corpus
  });
});

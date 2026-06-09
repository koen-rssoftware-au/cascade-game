// Spec §7.1.5 — end-to-end scripted game with a known seed asserting the exact
// final score. The expected score is computed MANUALLY here as an independent
// re-implementation of ONLY the scoring formula (§2.5) applied to the engine's
// reported ChainSteps, cross-checking the engine's bookkeeping every placement.
// The resulting totals are additionally frozen as literals below.
import { describe, expect, it } from 'vitest';
import { Game } from '../../src/engine/game';
import { idx } from '../../src/engine/types';

// Piece cell counts straight from spec §2.3 (id → cells).
const SPEC_CELLS: Record<string, number> = {
  P1: 1, P2: 2, P3: 2, P4: 3, P5: 3, P6: 4, P7: 4, P8: 5, P9: 5, P10: 4,
  P11: 9, P12: 3, P13: 3, P14: 3, P15: 3, P16: 5, P17: 5, P18: 4, P19: 4, P20: 4,
};

/** FNV-1a 32-bit over the 64 board cell values (test-local, independent). */
function boardHash(board: ReadonlyArray<number>): number {
  let h = 0x811c9dc5;
  for (const cell of board) {
    h ^= cell;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// FROZEN golden values for seed 12345, mode 'normal', 15 first-legal placements
// (scan order: tray slot 0..2, col 0..7, row 0..7). Derived once from the
// engine run below — every component is cross-checked against the §2.5 formula
// inside the loop, so these literals pin the engine's exact behavior over time.
const GOLDEN = {
  finalScore: 115, // frozen from the cross-checked run (clears occurred: see maxChain assert)
  finalBoardHash: 3946954091, // FNV-1a over the 64 final cell values
  placements: 15,
};

describe('golden game (spec §7.1.5 end-to-end)', () => {
  it('seed 12345, 15 deterministic placements → exact final score and board hash', () => {
    const game = Game.create(12345, 'normal');

    let expectedScore = 0; // independent accumulator
    let expectedStreak = 0;
    let expectedMaxChain = 0;

    for (let n = 0; n < GOLDEN.placements; n++) {
      expect(game.state.over).toBe(false);

      // Deterministic move rule: first legal (slot 0..2, col 0..7, row 0..7).
      let move: { slot: number; col: number; row: number; pieceId: string } | null = null;
      outer: for (let slot = 0; slot < 3; slot++) {
        const traySlot = game.state.tray[slot];
        if (!traySlot) continue;
        for (let col = 0; col < 8; col++) {
          for (let row = 0; row < 8; row++) {
            if (game.canPlace(slot, col, row)) {
              move = { slot, col, row, pieceId: traySlot.pieceId };
              break outer;
            }
          }
        }
      }
      expect(move, `placement ${n + 1} has a legal move`).not.toBeNull();
      if (!move) return;

      const res = game.place(move.slot, move.col, move.row);

      // ── Independent re-implementation of the §2.5 scoring formula ──
      const placementPoints = SPEC_CELLS[move.pieceId];
      expect(placementPoints).toBeDefined();
      expect(res.placementPoints).toBe(placementPoints);

      expectedStreak = res.steps.length > 0 ? expectedStreak + 1 : 0;
      expect(res.streakAfter).toBe(expectedStreak);
      const mult = expectedStreak >= 2 ? Math.min(expectedStreak, 5) : 1;
      expect(res.streakMultiplier).toBe(mult);

      let linePoints = 0;
      res.steps.forEach((s, i) => {
        const lines = s.rowsCleared.length + s.colsCleared.length; // independent count
        expect(s.linesCleared).toBe(lines);
        expect(s.step).toBe(i + 1);
        expect(s.basePoints).toBe(lines * lines * 10);
        expect(s.pointsAfterChain).toBe(lines * lines * 10 * (i + 1));
        linePoints += lines * lines * 10 * (i + 1) * mult;
      });
      expect(res.linePoints).toBe(linePoints);

      const boardEmpty = game.state.board.every((c) => c === 0);
      const allClear = res.steps.length > 0 && boardEmpty ? 300 : 0;
      expect(res.allClearBonus).toBe(allClear);

      expect(res.totalPoints).toBe((placementPoints ?? 0) + linePoints + allClear);
      expectedScore += (placementPoints ?? 0) + linePoints + allClear;
      expect(res.scoreAfter).toBe(expectedScore);
      expect(game.state.score).toBe(expectedScore);

      if (res.steps.length > expectedMaxChain) expectedMaxChain = res.steps.length;
      expect(res.maxChain).toBe(expectedMaxChain);

      // Board sanity: cells stay in range after every turn.
      for (let i = 0; i < 64; i++) {
        const v = game.state.board[idx(i % 8, Math.floor(i / 8))];
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(8);
      }
    }

    expect(game.state.placements).toBe(GOLDEN.placements);

    // The run must have exercised the clear path (not a trivial no-clear game).
    expect(game.state.maxChain).toBeGreaterThanOrEqual(1);

    // ── Frozen golden assertions ──
    expect(game.state.score).toBe(GOLDEN.finalScore);
    expect(boardHash(game.state.board)).toBe(GOLDEN.finalBoardHash);
  });

  it('the golden run is fully reproducible (two fresh games, identical traces)', () => {
    const trace = (g: Game): string => {
      const parts: string[] = [];
      for (let n = 0; n < 15; n++) {
        let done = false;
        outer: for (let slot = 0; slot < 3; slot++) {
          for (let col = 0; col < 8; col++) {
            for (let row = 0; row < 8; row++) {
              if (g.canPlace(slot, col, row)) {
                const r = g.place(slot, col, row);
                parts.push(`${slot}:${col}:${row}=${r.totalPoints}`);
                done = true;
                break outer;
              }
            }
          }
        }
        if (!done) break;
      }
      return parts.join('|') + `#${g.state.score}`;
    };
    expect(trace(Game.create(12345, 'normal'))).toBe(trace(Game.create(12345, 'normal')));
  });
});

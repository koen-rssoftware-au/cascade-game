// Spec §7.1.7 — game over fires iff no remaining tray piece has a legal
// placement; checked after every placement (and after refill — pinned rule 8).
import { describe, expect, it } from 'vitest';
import { Game } from '../../src/engine/game';
import { anyLegalPlacement } from '../../src/engine/board';
import { getPiece } from '../../src/engine/pieces';
import { idx } from '../../src/engine/types';
import type { Board, GameState, TraySlot } from '../../src/engine/types';

/**
 * Checkerboard: (col+row) even → filled. No row/col ever exceeds 4 filled in a
 * line, so nothing clears; every empty cell is isolated, so ONLY P1 can be
 * placed. Ideal for forcing game over deterministically.
 */
function checkerboard(): Board {
  const board: Board = new Array(64).fill(0);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((c + r) % 2 === 0) board[idx(c, r)] = 1;
    }
  }
  return board;
}

function slot(pieceId: string, color = 2): TraySlot {
  return { pieceId, color };
}

function gameFrom(
  board: Board,
  tray: (TraySlot | null)[],
  extra: Partial<GameState> = {},
): Game {
  const state: GameState = {
    board,
    tray,
    score: 0,
    streak: 0,
    maxChain: 0,
    placements: 0,
    continueUsed: false,
    rngState: 13579,
    mode: 'normal',
    dailyDate: null,
    over: false,
    ...extra,
  };
  return Game.deserialize(JSON.stringify(state));
}

describe('game over (spec §2.7, §7.1.7)', () => {
  it('fires when no remaining tray piece has any legal placement', () => {
    const game = gameFrom(checkerboard(), [slot('P1'), slot('P3'), slot('P10')]);
    const res = game.place(0, 1, 0); // (1,0) is an isolated empty cell — no clear
    expect(res.steps).toEqual([]);
    expect(res.gameOver).toBe(true); // P3 and P10 cannot fit anywhere
    expect(game.state.over).toBe(true);
    // A finished game accepts no further moves.
    expect(game.canPlace(1, 0, 1)).toBe(false);
    expect(() => game.place(1, 0, 1)).toThrow();
  });

  it('does NOT fire when a P1 still fits an empty cell', () => {
    const game = gameFrom(checkerboard(), [slot('P1'), slot('P1'), slot('P3')]);
    const res = game.place(0, 1, 0);
    expect(res.gameOver).toBe(false); // the second P1 still fits (e.g. (3,0))
    expect(game.state.over).toBe(false);
    expect(game.canPlace(1, 3, 0)).toBe(true);
  });

  it('considers only non-null tray slots', () => {
    const game = gameFrom(checkerboard(), [slot('P1'), slot('P10'), null]);
    const res = game.place(0, 1, 0);
    // Remaining: [null, P10, null] — the nulls are ignored, P10 decides.
    expect(res.gameOver).toBe(true);
  });

  it('runs AFTER the refill: survivability keeps the game alive on a tight board', () => {
    const game = gameFrom(checkerboard(), [slot('P1'), null, null]);
    const res = game.place(0, 1, 0); // consumes the last piece → tray refills
    expect(res.trayRefilled).toBe(true);
    const tray = game.state.tray;
    expect(tray.every((s) => s !== null)).toBe(true);
    // §2.6.4 guarantees a placeable piece exists whenever P1 fits somewhere,
    // so the refill can never strand the player here.
    const board = game.state.board;
    const anyPlayable = tray.some(
      (s) => s !== null && anyLegalPlacement(board, getPiece(s.pieceId)),
    );
    expect(anyPlayable).toBe(true);
    expect(res.gameOver).toBe(false);
  });

  it('a normal mid-game placement does not end the game', () => {
    const game = Game.create(2026, 'normal');
    // Fresh board: place tray slot 0 at its first legal position.
    let placed = false;
    outer: for (let col = 0; col < 8; col++) {
      for (let row = 0; row < 8; row++) {
        if (game.canPlace(0, col, row)) {
          const res = game.place(0, col, row);
          expect(res.gameOver).toBe(false);
          placed = true;
          break outer;
        }
      }
    }
    expect(placed).toBe(true);
  });
});

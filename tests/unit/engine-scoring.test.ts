// Spec §7.1.5 — exact scoring values (§2.5), plus the continue reward (§9.3.1,
// plan pinned rule 5: zero points, no stat changes).
import { describe, expect, it } from 'vitest';
import { Game } from '../../src/engine/game';
import type { Board, GameState, TraySlot } from '../../src/engine/types';

function b(rows: string[]): Board {
  expect(rows.length).toBe(8);
  const out: number[] = [];
  for (const row of rows) {
    expect(row.length).toBe(8);
    for (const ch of row) out.push(ch === '.' ? 0 : parseInt(ch, 10));
  }
  return out;
}

const E8 = '........';

function slot(pieceId: string, color = 1): TraySlot {
  return { pieceId, color, rot: 0 };
}

/** Craft a mid-run game from an exact state (board/tray/counters fully pinned). */
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
    rngState: 987654321,
    mode: 'normal',
    dailyDate: null,
    over: false,
    ...extra,
  };
  return Game.deserialize(JSON.stringify(state));
}

describe('scoring (spec §2.5, §7.1.5)', () => {
  it('5-cell piece, no clear → +5 total (placement points only)', () => {
    const game = gameFrom(b([E8, E8, E8, E8, E8, E8, E8, E8]), [slot('P8', 3), slot('P1'), null]);
    const res = game.place(0, 0, 0);
    expect(res.placementPoints).toBe(5);
    expect(res.steps).toEqual([]);
    expect(res.linePoints).toBe(0);
    expect(res.allClearBonus).toBe(0);
    expect(res.totalPoints).toBe(5);
    expect(res.scoreAfter).toBe(5);
    expect(res.streakAfter).toBe(0); // no clear → streak resets/stays 0
    expect(res.streakMultiplier).toBe(1);
    expect(res.maxChain).toBe(0);
    expect(res.trayRefilled).toBe(false);
    expect(res.gameOver).toBe(false);
  });

  it('single line clear → placement + 10', () => {
    const game = gameFrom(
      b([E8, E8, E8, E8, E8, E8, '2.......', '1111111.']),
      [slot('P1', 5), slot('P1'), null],
    );
    const res = game.place(0, 7, 7);
    expect(res.placementPoints).toBe(1);
    expect(res.steps.length).toBe(1);
    expect(res.steps[0]?.rowsCleared).toEqual([7]);
    expect(res.steps[0]?.clearedCells.length).toBe(8);
    expect(res.linePoints).toBe(10); // 1² × 10 × step 1 × mult 1
    expect(res.allClearBonus).toBe(0); // stabilizer block at (0,6) remains
    expect(res.totalPoints).toBe(11);
    expect(res.scoreAfter).toBe(11);
    expect(res.streakAfter).toBe(1);
    expect(res.streakMultiplier).toBe(1);
    // Stabilizer fell from (0,6) to (0,7) after the clear.
    expect(res.steps[0]?.boardAfter).toEqual(b([E8, E8, E8, E8, E8, E8, E8, '2.......']));
  });

  it('2 lines in the same step → placement + 40', () => {
    const game = gameFrom(
      b(['2.......', E8, E8, E8, E8, E8, '3333333.', '3333333.']),
      [slot('P3', 4), slot('P1'), null],
    );
    const res = game.place(0, 7, 6); // P3 vertical fills (7,6) and (7,7)
    expect(res.placementPoints).toBe(2);
    expect(res.steps.length).toBe(1);
    expect(res.steps[0]?.rowsCleared).toEqual([6, 7]);
    expect(res.steps[0]?.linesCleared).toBe(2);
    expect(res.steps[0]?.clearedCells.length).toBe(16);
    expect(res.linePoints).toBe(40); // 2² × 10 = 40, × step 1 × mult 1
    expect(res.totalPoints).toBe(42);
    expect(res.scoreAfter).toBe(42);
    expect(res.maxChain).toBe(1);
  });

  it('chain-2 with a single line each step → 10×1 + 10×2 = 30 line points', () => {
    const game = gameFrom(
      b([E8, E8, E8, E8, '1.......', '.......2', '3333333.', '4444444.']),
      [slot('P1', 6), slot('P1'), null],
    );
    const res = game.place(0, 7, 7);
    expect(res.placementPoints).toBe(1);
    expect(res.steps.length).toBe(2);
    expect(res.steps[0]?.pointsAfterChain).toBe(10); // step 1: 10 × 1
    expect(res.steps[1]?.pointsAfterChain).toBe(20); // step 2: 10 × 2
    expect(res.linePoints).toBe(30); // spec-pinned value
    expect(res.allClearBonus).toBe(0);
    expect(res.totalPoints).toBe(31);
    expect(res.scoreAfter).toBe(31);
    expect(res.maxChain).toBe(2);
    expect(res.streakAfter).toBe(1);
    expect(res.streakMultiplier).toBe(1); // streak 1 → no multiplier yet
  });

  it('streak ×3 scenario: three consecutive clearing placements, third gets ×3', () => {
    const game = gameFrom(
      b(['1.......', E8, E8, E8, E8, '2222222.', '2222222.', '2222222.']),
      [slot('P1', 3), slot('P1', 4), slot('P1', 5)],
    );

    const r1 = game.place(0, 7, 7);
    expect(r1.steps.length).toBe(1);
    expect(r1.streakAfter).toBe(1);
    expect(r1.streakMultiplier).toBe(1);
    expect(r1.linePoints).toBe(10);
    expect(r1.totalPoints).toBe(11);

    const r2 = game.place(1, 7, 7);
    expect(r2.steps.length).toBe(1);
    expect(r2.streakAfter).toBe(2);
    expect(r2.streakMultiplier).toBe(2); // pinned rule 1: counts current placement
    expect(r2.linePoints).toBe(20); // 10 × 1 × ×2
    expect(r2.totalPoints).toBe(21);

    const r3 = game.place(2, 7, 7);
    expect(r3.steps.length).toBe(1);
    expect(r3.streakAfter).toBe(3);
    expect(r3.streakMultiplier).toBe(3);
    expect(r3.linePoints).toBe(30); // 10 × 1 × ×3 — the spec's "streak ×3 scenario"
    expect(r3.allClearBonus).toBe(0); // stabilizer block survives at (0,7)
    expect(r3.totalPoints).toBe(31);
    expect(r3.scoreAfter).toBe(11 + 21 + 31);
    expect(r3.trayRefilled).toBe(true); // all 3 consumed
    expect(r3.gameOver).toBe(false);
  });

  it('streak resets to 0 on a placement with no clear', () => {
    const game = gameFrom(
      b([E8, E8, E8, E8, E8, E8, E8, '1111111.']),
      [slot('P1'), slot('P1'), null],
      { streak: 4 },
    );
    const res = game.place(0, 0, 0); // harmless placement, no clear
    expect(res.steps).toEqual([]);
    expect(res.streakAfter).toBe(0);
    expect(res.streakMultiplier).toBe(1);
  });

  it('streak multiplier caps at ×5 (min(streak, 5))', () => {
    const game = gameFrom(
      b([E8, E8, E8, E8, E8, E8, '2.......', '1111111.']),
      [slot('P1'), slot('P1'), null],
      { streak: 9 },
    );
    const res = game.place(0, 7, 7);
    expect(res.streakAfter).toBe(10);
    expect(res.streakMultiplier).toBe(5);
    expect(res.linePoints).toBe(50); // 10 × 1 × ×5
  });

  it('all-clear bonus: board empty after the cascade loop → +300', () => {
    const game = gameFrom(
      b([E8, E8, E8, E8, E8, E8, E8, '1111111.']),
      [slot('P1', 2), slot('P1'), null],
    );
    const res = game.place(0, 7, 7);
    expect(res.steps.length).toBe(1);
    expect(res.allClearBonus).toBe(300);
    expect(res.totalPoints).toBe(1 + 10 + 300);
    expect(res.scoreAfter).toBe(311);
    expect(game.state.board.every((c) => c === 0)).toBe(true);
  });

  it('illegal placements throw and change nothing', () => {
    const board = b([E8, E8, E8, E8, E8, E8, E8, '1.......']);
    const game = gameFrom(board, [slot('P2'), null, slot('P1')]);
    const before = game.state;
    expect(() => game.place(0, 7, 7)).toThrow(); // P2 out of bounds at col 7
    expect(() => game.place(0, 0, 7)).toThrow(); // overlaps (0,7)
    expect(() => game.place(1, 0, 0)).toThrow(); // empty tray slot
    expect(() => game.place(5, 0, 0)).toThrow(); // invalid slot index
    expect(game.state).toEqual(before);
  });
});

describe('continue reward (spec §9.3.1, plan pinned rule 5)', () => {
  it('clears the 2 fullest rows, runs the cascade loop, awards ZERO points', () => {
    const game = gameFrom(
      b([E8, '11111...', '222.....', '33333...', E8, '4444....', '666666..', '7777777.']),
      [slot('P1'), null, null],
      { score: 1234, streak: 3, maxChain: 2, over: true },
    );
    const res = game.applyContinueReward();
    expect(res.steps.length).toBe(1);
    const s1 = res.steps[0];
    expect(s1).toBeDefined();
    if (!s1) return;
    expect(s1.step).toBe(1); // chain counter starts at 1
    expect(s1.rowsCleared).toEqual([6, 7]); // counts 6 and 7 are the fullest
    expect(s1.colsCleared).toEqual([]);
    expect(s1.linesCleared).toBe(2);
    expect(s1.clearedCells.length).toBe(13); // only the filled cells (6 + 7)
    expect(res.boardAfter).toEqual(b([
      E8,
      E8,
      E8,
      E8,
      '111.....',
      '2221....',
      '33331...',
      '44443...',
    ]));
    // ZERO points, no stat changes — survival only.
    const st = game.state;
    expect(st.score).toBe(1234);
    expect(st.streak).toBe(3);
    expect(st.maxChain).toBe(2);
    expect(st.continueUsed).toBe(true);
    expect(st.over).toBe(false); // resumes with the current tray (P1 fits)
  });

  it('tie on filled count → lower row index wins', () => {
    const game = gameFrom(
      b([E8, '11111...', E8, '22222...', E8, '333.....', E8, E8]),
      [slot('P1'), null, null],
    );
    const res = game.applyContinueReward();
    expect(res.steps[0]?.rowsCleared).toEqual([1, 3]); // both count 5; rows 1 and 3 beat row 5
    expect(res.steps[0]?.clearedCells.length).toBe(10);
    expect(res.boardAfter).toEqual(b([E8, E8, E8, E8, E8, E8, E8, '333.....']));
  });

  it('reward clears can cascade (chain step 2) and still award zero points — even on an all-clear', () => {
    const game = gameFrom(
      b([E8, E8, E8, E8, '.......8', '5555555.', '6666666.', '7777777.']),
      [slot('P1'), null, null],
      { score: 777, streak: 1, maxChain: 1, over: true },
    );
    const res = game.applyContinueReward();
    expect(res.steps.length).toBe(2);
    expect(res.steps[0]?.rowsCleared).toEqual([5, 6]); // tie 7-7-7 → lowest two indices
    expect(res.steps[1]?.step).toBe(2);
    expect(res.steps[1]?.rowsCleared).toEqual([7]); // the 8 fell from (7,4) and completed row 7
    expect(res.boardAfter.every((c) => c === 0)).toBe(true);
    const st = game.state;
    expect(st.score).toBe(777); // no line points, no all-clear bonus
    expect(st.streak).toBe(1);
    expect(st.maxChain).toBe(1); // untouched even though the reward chained to 2
    expect(st.continueUsed).toBe(true);
  });

  it('throws if the continue was already used this run', () => {
    const game = gameFrom(
      b([E8, E8, E8, E8, E8, E8, E8, '1111....']),
      [slot('P1'), null, null],
      { continueUsed: true },
    );
    expect(() => game.applyContinueReward()).toThrow();
  });
});

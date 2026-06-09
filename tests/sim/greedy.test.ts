// Agent harness tests + greedy-vs-random sanity (spec §7.2, plan Task 3).
// - Enumeration: ALL legal (trayIndex, col, row) triples in deterministic order
//   (trayIndex asc, row asc, col asc).
// - RandomAgent: uniform pick via an injected Rng (separate from the game rng).
// - GreedyAgent: max cells cleared this placement, tie → max totalPoints,
//   tie → first in enumeration order; never mutates the real game.
// - Sanity (§7.2): greedy mean score strictly > random mean score over 300
//   games per agent on the same seeds.
import { describe, expect, it } from 'vitest';
import { Game } from '../../src/engine/game';
import { shapeFor, uniqueRotations } from '../../src/engine/pieces';
import { createRng } from '../../src/engine/rng';
import type { Rng } from '../../src/engine/rng';
import { COLS, ROWS, idx } from '../../src/engine/types';
import type { Board, GameState, TraySlot } from '../../src/engine/types';
import {
  GreedyAgent,
  RandomAgent,
  applyMove,
  enumerateLegalMoves,
  evaluatePlacement,
  playGame,
} from '../../src/sim/agents';
import type { Move } from '../../src/sim/agents';

/** Bounds-checked index helper (noUncheckedIndexedAccess). */
function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`Index ${i} out of range (length ${arr.length})`);
  return v;
}

/** Rng stub yielding a fixed sequence (implements the full engine Rng interface). */
function sequenceRng(values: number[]): Rng {
  let i = 0;
  return {
    next(): number {
      const v = values[i];
      if (v === undefined) throw new Error('sequenceRng exhausted');
      i++;
      return v;
    },
    getState(): number {
      return i;
    },
    setState(): void {
      throw new Error('not supported');
    },
  };
}

/** Build a Game with a hand-crafted board/tray via the public serialize contract. */
function craftGame(board: Board, tray: (TraySlot | null)[]): Game {
  const state: GameState = {
    board,
    tray,
    score: 0,
    streak: 0,
    maxChain: 0,
    placements: 0,
    continueUsed: false,
    rngState: 123456789,
    mode: 'normal',
    dailyDate: null,
    over: false,
  };
  return Game.deserialize(JSON.stringify(state));
}

function boardWithRow7Filled(throughCol: number): Board {
  const board: Board = new Array<number>(COLS * ROWS).fill(0);
  for (let c = 0; c <= throughCol; c++) board[idx(c, 7)] = 1;
  return board;
}

function cellsClearedOf(steps: ReadonlyArray<{ clearedCells: ReadonlyArray<unknown> }>): number {
  let n = 0;
  for (const s of steps) n += s.clearedCells.length;
  return n;
}

describe('enumerateLegalMoves', () => {
  it('on an empty board lists exactly (9-w)*(9-h) placements per tray piece (spec §7.1.1: legal iff fully in-bounds)', () => {
    const game = Game.create(7, 'normal');
    const moves = enumerateLegalMoves(game);
    let expected = 0;
    for (const slot of game.state.tray) {
      if (!slot) continue;
      for (const rot of uniqueRotations(slot.pieceId)) {
        const p = shapeFor(slot.pieceId, rot);
        expected += (COLS - p.w + 1) * (ROWS - p.h + 1);
      }
    }
    expect(moves.length).toBe(expected);
  });

  it('orders tuples by trayIndex asc, unique-rot asc, row asc, col asc', () => {
    const game = Game.create(7, 'normal');
    const moves = enumerateLegalMoves(game);
    expect(moves.length).toBeGreaterThan(1);
    for (let i = 1; i < moves.length; i++) {
      const a = at(moves, i - 1);
      const b = at(moves, i);
      const aKey = a.trayIndex * 1_000_000 + a.rot * 10_000 + a.row * 100 + a.col;
      const bKey = b.trayIndex * 1_000_000 + b.rot * 10_000 + b.row * 100 + b.col;
      expect(bKey).toBeGreaterThan(aKey);
    }
    // On an empty board the very first legal triple is slot 0 at (col 0, row 0).
    expect(at(moves, 0)).toEqual({ trayIndex: 0, rot: 0, col: 0, row: 0 });
  });

  it('skips consumed (null) tray slots and respects filled cells', () => {
    // Board: only (0,0) free in row 0..6 region is irrelevant — craft a board
    // where everything except (7,7) is filled; tray = [P1, null, P1].
    const board: Board = new Array<number>(COLS * ROWS).fill(2);
    board[idx(7, 7)] = 0;
    const game = craftGame(board, [
      { pieceId: 'P1', color: 1, rot: 0 },
      null,
      { pieceId: 'P1', color: 2, rot: 0 },
    ]);
    const moves = enumerateLegalMoves(game);
    expect(moves).toEqual([
      { trayIndex: 0, rot: 0, col: 7, row: 7 },
      { trayIndex: 2, rot: 0, col: 7, row: 7 },
    ]);
  });
});

describe('RandomAgent', () => {
  it('picks moves[floor(rng.next() * count)] from the injected rng (uniform pick)', () => {
    const game = Game.create(7, 'normal');
    const moves = enumerateLegalMoves(game);
    const n = moves.length;

    // next() → 0 picks the first triple in enumeration order.
    expect(new RandomAgent(sequenceRng([0])).chooseMove(game)).toEqual(at(moves, 0));
    // next() → just under 1 picks the last triple.
    expect(new RandomAgent(sequenceRng([1 - 1e-12])).chooseMove(game)).toEqual(at(moves, n - 1));
    // next() → k/n (+ tiny epsilon) picks moves[k].
    const k = Math.floor(n / 2);
    expect(new RandomAgent(sequenceRng([(k + 0.5) / n])).chooseMove(game)).toEqual(at(moves, k));
  });

  it('is deterministic for a fixed agent seed and never touches the game rng', () => {
    const before = Game.create(11, 'normal').serialize();
    const game = Game.deserialize(before);
    const a = new RandomAgent(createRng(99));
    const b = new RandomAgent(createRng(99));
    const moveA = a.chooseMove(game);
    const moveB = b.chooseMove(game);
    expect(moveA).toEqual(moveB);
    expect(game.serialize()).toBe(before); // choosing must not mutate the game
  });

  it('returns null when no legal move exists', () => {
    const board: Board = new Array<number>(COLS * ROWS).fill(3);
    board[idx(0, 0)] = 0; // one free cell, but tray needs 2 cells
    const game = craftGame(board, [{ pieceId: 'P2', color: 1, rot: 0 }, null, null]);
    expect(new RandomAgent(sequenceRng([0.5])).chooseMove(game)).toBeNull();
  });
});

describe('GreedyAgent', () => {
  it('maximizes cells cleared this placement (spec §2.4.2: a full row clears 8 cells)', () => {
    // Row 7 filled cols 0..5; P2 at (6,7) completes the row → 8 cells cleared.
    // P1 can never clear anything this turn.
    const game = craftGame(boardWithRow7Filled(5), [
      { pieceId: 'P1', color: 1, rot: 0 },
      { pieceId: 'P2', color: 2, rot: 0 },
      null,
    ]);
    const move = new GreedyAgent().chooseMove(game);
    expect(move).toEqual({ trayIndex: 1, rot: 0, col: 6, row: 7 });
  });

  it('breaks cells-cleared ties by max totalPoints (placement points differ: 13 vs 11, spec §2.5)', () => {
    // Row 7 filled cols 0..6, plus a ballast block at (0,0) so neither
    // candidate empties the board (no all-clear bonus in play, spec §2.5).
    // P1 at (7,7) clears row 7 (8 cells, total 1+10=11).
    // P5 (3×1 vertical) at (7,5) also clears row 7 (8 cells, total 3+10=13).
    const board = boardWithRow7Filled(6);
    board[idx(0, 0)] = 4;
    const game = craftGame(board, [
      { pieceId: 'P1', color: 1, rot: 0 },
      { pieceId: 'P5', color: 2, rot: 0 },
      null,
    ]);
    const move = new GreedyAgent().chooseMove(game);
    expect(move).toEqual({ trayIndex: 1, rot: 0, col: 7, row: 5 });
  });

  it('breaks full ties by first in enumeration order (lower trayIndex wins)', () => {
    // Two identical P1s: both clear row 7 at (7,7) with identical points.
    const game = craftGame(boardWithRow7Filled(6), [
      { pieceId: 'P1', color: 1, rot: 0 },
      { pieceId: 'P1', color: 2, rot: 0 },
      null,
    ]);
    const move = new GreedyAgent().chooseMove(game);
    expect(move).toEqual({ trayIndex: 0, rot: 0, col: 7, row: 7 });
  });

  it('never mutates the real game while evaluating', () => {
    const game = Game.create(13, 'normal');
    const before = game.serialize();
    new GreedyAgent().chooseMove(game);
    expect(game.serialize()).toBe(before);
  });

  it('evaluation is exact: matches the real engine PlacementResult on cloned games (20 seeds)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const game = Game.create(seed, 'normal');
      const agent = new GreedyAgent();
      let guard = 0;
      while (!game.state.over && guard < 200) {
        guard++;
        const move = agent.chooseMove(game);
        if (!move) throw new Error(`seed ${seed}: agent found no move but game not over`);
        const st = game.state;
        const evaluated = evaluatePlacement(st.board, st.tray, st.streak, move);
        const clone = Game.deserialize(game.serialize());
        const actual = applyMove(clone, move);
        expect(evaluated.totalPoints).toBe(actual.totalPoints);
        expect(evaluated.cellsCleared).toBe(cellsClearedOf(actual.steps));
        applyMove(game, move);
      }
    }
  });
});

describe('greedy-agent sanity (spec §7.2)', () => {
  it('greedy mean score strictly exceeds random mean score over 300 games each (same seeds)', () => {
    const GAMES = 300;
    let randomTotal = 0;
    let greedyTotal = 0;
    const greedy = new GreedyAgent();
    for (let seed = 1; seed <= GAMES; seed++) {
      const randomGame = Game.create(seed, 'normal');
      randomTotal += playGame(randomGame, new RandomAgent(createRng(seed ^ 0x517cc1b7))).finalScore;
      const greedyGame = Game.create(seed, 'normal');
      greedyTotal += playGame(greedyGame, greedy).finalScore;
    }
    const randomMean = randomTotal / GAMES;
    const greedyMean = greedyTotal / GAMES;
    console.log(
      `[greedy sanity] games per agent: ${GAMES} | mean score random: ${randomMean.toFixed(1)} | mean score greedy: ${greedyMean.toFixed(1)}`,
    );
    expect(greedyMean).toBeGreaterThan(randomMean);
  });
});

// Keep TypeScript aware that Move is the canonical tuple shape used above.
const _moveShapeCheck: Move = { trayIndex: 0, rot: 0, col: 0, row: 0 };
void _moveShapeCheck;

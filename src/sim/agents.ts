// Headless simulation agents + harness (spec §7.2, plan Task 3).
//
// Both agents enumerate ALL legal (trayIndex, col, row) triples in the same
// deterministic order — trayIndex asc, then row asc, then col asc — so runs are
// reproducible and the greedy tie-break "first in enumeration order" is well
// defined. Agents only READ the game (state snapshots + canPlace); they never
// mutate it while choosing.
import { resolveCascade } from '../engine/game';
import type { Game } from '../engine/game';
import { getPiece } from '../engine/pieces';
import type { Rng } from '../engine/rng';
import { COLS, ROWS, idx } from '../engine/types';
import type { Board, PlacementResult, TraySlot } from '../engine/types';

/** One placement: which tray slot goes where (top-left anchor of the piece). */
export interface Move {
  trayIndex: number;
  col: number;
  row: number;
}

export interface Agent {
  /** Pick the next move for `game`, or null when no legal move exists. */
  chooseMove(game: Game): Move | null;
}

/**
 * All legal (trayIndex, col, row) triples, ordered trayIndex asc, row asc,
 * col asc. Consumed (null) slots are skipped. Read-only on the game.
 */
export function enumerateLegalMoves(game: Game): Move[] {
  const moves: Move[] = [];
  const tray = game.state.tray;
  for (let trayIndex = 0; trayIndex < tray.length; trayIndex++) {
    if (!tray[trayIndex]) continue;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (game.canPlace(trayIndex, col, row)) moves.push({ trayIndex, col, row });
      }
    }
  }
  return moves;
}

/** Uniform random over the legal triples, driven by an INJECTED rng — its
 *  stream is fully separate from the game's own piece-generation rng. */
export class RandomAgent implements Agent {
  constructor(private readonly rng: Rng) {}

  chooseMove(game: Game): Move | null {
    const moves = enumerateLegalMoves(game);
    if (moves.length === 0) return null;
    const pick = moves[Math.floor(this.rng.next() * moves.length)];
    if (!pick) throw new Error('RandomAgent pick out of range — rng.next() outside [0,1)?');
    return pick;
  }
}

/**
 * Board-level candidate evaluation — exact by construction: the placement is
 * applied to a COPY of the board and resolved with the engine's own
 * resolveCascade; the score arithmetic below mirrors spec §2.5 with the plan's
 * pinned rule 1 (streak includes the current placement). Exactness is
 * cross-checked against real PlacementResults in tests/sim/greedy.test.ts.
 */
export function evaluatePlacement(
  board: Board,
  tray: ReadonlyArray<TraySlot | null>,
  streak: number,
  move: Move,
): { cellsCleared: number; totalPoints: number } {
  const slot = tray[move.trayIndex];
  if (!slot) throw new Error(`evaluatePlacement: tray slot ${move.trayIndex} holds no piece`);
  const piece = getPiece(slot.pieceId);

  const placed = board.slice();
  for (const [dc, dr] of piece.cells) placed[idx(move.col + dc, move.row + dr)] = slot.color;
  const { board: resolved, steps } = resolveCascade(placed);

  let cellsCleared = 0;
  for (const s of steps) cellsCleared += s.clearedCells.length;

  const streakAfter = steps.length > 0 ? streak + 1 : 0;
  const streakMultiplier = streakAfter >= 2 ? Math.min(streakAfter, 5) : 1;
  let linePoints = 0;
  for (const s of steps) linePoints += s.pointsAfterChain * streakMultiplier;
  const allClearBonus = steps.length > 0 && resolved.every((c) => c === 0) ? 300 : 0;

  return { cellsCleared, totalPoints: piece.cells.length + linePoints + allClearBonus };
}

/**
 * Greedy: maximize cells cleared by this placement; tie-break by max
 * totalPoints, then by first in enumeration order. Evaluates every candidate
 * on board copies — the real game is never mutated.
 */
export class GreedyAgent implements Agent {
  chooseMove(game: Game): Move | null {
    const moves = enumerateLegalMoves(game);
    if (moves.length === 0) return null;
    const { board, tray, streak } = game.state;

    let best: Move | null = null;
    let bestCleared = -1;
    let bestPoints = -1;
    for (const move of moves) {
      const { cellsCleared, totalPoints } = evaluatePlacement(board, tray, streak, move);
      if (cellsCleared > bestCleared || (cellsCleared === bestCleared && totalPoints > bestPoints)) {
        best = move;
        bestCleared = cellsCleared;
        bestPoints = totalPoints;
      }
    }
    return best;
  }
}

/** Hard per-game safety cap for harness runs (soak asserts it is never hit). */
export const SAFETY_CAP = 10_000;

export interface PlayedGame {
  /** Every move in placement order. */
  moves: Move[];
  finalScore: number;
  maxChain: number;
  placements: number;
  /** True iff the loop stopped because SAFETY_CAP was reached (never expected). */
  capHit: boolean;
}

/**
 * Drive `game` with `agent` until game over (or SAFETY_CAP placements).
 * `onPlacement` fires after every placement with the engine result, the move,
 * and the live game — used by the soak suite for per-turn invariant checks.
 * Throws if the agent reports no move while the game is not over (that would
 * contradict the §2.7 game-over definition).
 */
export function playGame(
  game: Game,
  agent: Agent,
  onPlacement?: (result: PlacementResult, move: Move, game: Game) => void,
): PlayedGame {
  const moves: Move[] = [];
  let capHit = false;
  while (!game.state.over) {
    if (moves.length >= SAFETY_CAP) {
      capHit = true;
      break;
    }
    const move = agent.chooseMove(game);
    if (!move) {
      throw new Error('Agent found no legal move although the game is not over (§2.7 violation)');
    }
    const result = game.place(move.trayIndex, move.col, move.row);
    moves.push(move);
    if (onPlacement) onPlacement(result, move, game);
  }
  const state = game.state;
  return {
    moves,
    finalScore: state.score,
    maxChain: state.maxChain,
    placements: moves.length,
    capHit,
  };
}

// Game core — full turn sequence per spec §2.4:
// place → cascade loop → score (§2.5) → refill if all 3 consumed (§2.6) →
// game-over check (§2.7). Pure grid math; all randomness via the injected RNG.
import { COLS, ROWS, idx } from './types';
import type {
  Board,
  ChainStep,
  ContinueResult,
  GameMode,
  GameState,
  PlacementResult,
  Rot,
  TraySlot,
} from './types';
import {
  applyGravity,
  canPlace as canPlaceOnBoard,
  clearLines,
  emptyBoard,
  findFullLines,
} from './board';
import { anyPlacementAnyRotation, shapeFor } from './pieces';
import { createRng } from './rng';
import type { Rng } from './rng';
import { generateTray } from './tray';
import { deserializeGameState, serializeGameState } from './serialize';

const MAX_CHAIN_ITERATIONS = 64; // spec §7.1.4 bound; provably unreachable

/**
 * Run the clear → gravity → re-check loop (spec §2.4.2–5) on a board, starting
 * the chain counter at `startStep`. Pure: the input board is not mutated.
 * Gravity runs only after a clear; with no full lines, zero steps are produced.
 */
export function resolveCascade(
  board: Board,
  startStep = 1,
): { board: Board; steps: ChainStep[] } {
  let current = board.slice();
  const steps: ChainStep[] = [];
  let step = startStep;
  for (;;) {
    const { rows, cols } = findFullLines(current);
    if (rows.length === 0 && cols.length === 0) break;
    if (steps.length >= MAX_CHAIN_ITERATIONS) {
      throw new Error('Cascade loop exceeded 64 iterations — invariant violated');
    }
    const { board: clearedBoard, cleared } = clearLines(current, rows, cols);
    const { board: settled, moves } = applyGravity(clearedBoard);
    const linesCleared = rows.length + cols.length;
    const basePoints = linesCleared * linesCleared * 10;
    steps.push({
      step,
      rowsCleared: rows,
      colsCleared: cols,
      clearedCells: cleared,
      linesCleared,
      basePoints,
      pointsAfterChain: basePoints * step,
      fallMoves: moves,
      boardAfter: settled.slice(),
    });
    current = settled;
    step++;
  }
  return { board: current, steps };
}

function cloneState(state: GameState): GameState {
  return {
    board: state.board.slice(),
    tray: state.tray.map((slot) => (slot ? { ...slot } : null)),
    score: state.score,
    streak: state.streak,
    maxChain: state.maxChain,
    placements: state.placements,
    continueUsed: state.continueUsed,
    rngState: state.rngState,
    mode: state.mode,
    dailyDate: state.dailyDate,
    over: state.over,
  };
}

export class Game {
  private readonly st: GameState;
  private readonly rng: Rng;

  private constructor(state: GameState, rng: Rng) {
    this.st = state;
    this.rng = rng;
  }

  static create(seed: number, mode: GameMode, dailyDate?: string): Game {
    const rng = createRng(seed);
    const board = emptyBoard();
    const tray: (TraySlot | null)[] = generateTray(board, rng);
    const state: GameState = {
      board,
      tray,
      score: 0,
      streak: 0,
      maxChain: 0,
      placements: 0,
      continueUsed: false,
      rngState: rng.getState(),
      mode,
      dailyDate: dailyDate ?? null,
      over: false,
    };
    const game = new Game(state, rng);
    game.st.over = !game.hasAnyMove();
    return game;
  }

  /** Deep-readonly snapshot; serialize() is the canonical persistence form. */
  get state(): Readonly<GameState> {
    return cloneState(this.st);
  }

  canPlace(trayIndex: number, col: number, row: number): boolean {
    if (this.st.over) return false;
    const slot = this.st.tray[trayIndex];
    if (!slot) return false;
    return canPlaceOnBoard(this.st.board, shapeFor(slot.pieceId, slot.rot), col, row);
  }

  /**
   * Rotate a tray piece one clockwise quarter turn (gameplay update; free,
   * unlimited, no RNG, no score effect). Returns the new rotation.
   */
  rotateTray(trayIndex: number): Rot {
    if (this.st.over) throw new Error('Game is over — no rotations allowed');
    const slot = this.st.tray[trayIndex];
    if (!slot) throw new Error(`Tray slot ${trayIndex} holds no piece`);
    slot.rot = ((slot.rot + 1) % 4) as Rot;
    return slot.rot;
  }

  place(trayIndex: number, col: number, row: number): PlacementResult {
    if (this.st.over) throw new Error('Game is over — no further placements allowed');
    const slot = this.st.tray[trayIndex];
    if (!slot) throw new Error(`Tray slot ${trayIndex} holds no piece`);
    const piece = shapeFor(slot.pieceId, slot.rot);
    if (!canPlaceOnBoard(this.st.board, piece, col, row)) {
      throw new Error(`Illegal placement: ${piece.id} at (${col},${row})`);
    }

    // 1. Place — piece cells become filled board cells (spec §2.4.1).
    const placed = this.st.board.slice();
    for (const [dc, dr] of piece.cells) placed[idx(col + dc, row + dr)] = slot.color;
    this.st.tray[trayIndex] = null;
    this.st.placements += 1;

    // 2–5. Cascade loop (clear → gravity → repeat).
    const { board: resolved, steps } = resolveCascade(placed);
    this.st.board = resolved;

    // 6a. Score (spec §2.5; pinned rule 1: streak includes this placement).
    const placementPoints = piece.cells.length;
    this.st.streak = steps.length > 0 ? this.st.streak + 1 : 0;
    const streakAfter = this.st.streak;
    const streakMultiplier = streakAfter >= 2 ? Math.min(streakAfter, 5) : 1;
    let linePoints = 0;
    for (const s of steps) linePoints += s.pointsAfterChain * streakMultiplier;
    const allClearBonus =
      steps.length > 0 && resolved.every((c) => c === 0) ? 300 : 0;
    const totalPoints = placementPoints + linePoints + allClearBonus;
    this.st.score += totalPoints;
    if (steps.length > this.st.maxChain) this.st.maxChain = steps.length;

    // 6b. Refill when all 3 consumed (§2.6) — never a partial refill.
    let trayRefilled = false;
    if (this.st.tray.every((s) => s === null)) {
      this.st.tray = generateTray(this.st.board, this.rng);
      trayRefilled = true;
    }
    this.st.rngState = this.rng.getState();

    // 6c. Game-over check, after the refill (§2.7; pinned rule 8).
    this.st.over = !this.hasAnyMove();

    return {
      placementPoints,
      steps,
      streakAfter,
      streakMultiplier,
      linePoints,
      allClearBonus,
      totalPoints,
      scoreAfter: this.st.score,
      maxChain: this.st.maxChain,
      trayRefilled,
      gameOver: this.st.over,
    };
  }

  /**
   * Continue reward (spec §9.3.1, plan pinned rule 5): clear the 2 rows with
   * the most filled cells (tie → lower row index) as chain step 1, then run the
   * normal gravity/cascade loop. ZERO points; streak and maxChain untouched.
   */
  applyContinueReward(): ContinueResult {
    if (this.st.continueUsed) throw new Error('Continue reward already used this run');

    const counts: Array<{ row: number; count: number }> = [];
    for (let r = 0; r < ROWS; r++) {
      let count = 0;
      for (let c = 0; c < COLS; c++) {
        if (this.st.board[idx(c, r)] !== 0) count++;
      }
      counts.push({ row: r, count });
    }
    counts.sort((a, b) => b.count - a.count || a.row - b.row);
    const first = counts[0];
    const second = counts[1];
    if (!first || !second) throw new Error('Row count bookkeeping failed');
    const rows = [first.row, second.row].sort((a, b) => a - b);

    const { board: clearedBoard, cleared } = clearLines(this.st.board, rows, []);
    const { board: settled, moves } = applyGravity(clearedBoard);
    const linesCleared = 2;
    const basePoints = linesCleared * linesCleared * 10;
    const firstStep: ChainStep = {
      step: 1,
      rowsCleared: rows,
      colsCleared: [],
      clearedCells: cleared,
      linesCleared,
      basePoints,
      pointsAfterChain: basePoints, // × step 1 (recorded; never awarded)
      fallMoves: moves,
      boardAfter: settled.slice(),
    };
    const { board: finalBoard, steps: rest } = resolveCascade(settled, 2);

    this.st.board = finalBoard;
    this.st.continueUsed = true;
    // Resume with the current tray: recompute liveness, nothing else changes.
    this.st.over = !this.hasAnyMove();

    return { steps: [firstStep, ...rest], boardAfter: finalBoard.slice() };
  }

  serialize(): string {
    this.st.rngState = this.rng.getState();
    return serializeGameState(this.st);
  }

  static deserialize(json: string): Game {
    const state = deserializeGameState(json);
    const rng = createRng(1);
    rng.setState(state.rngState);
    const game = new Game(state, rng);
    // Migration guard: a pre-rotation save can claim `over` although a rotation
    // still fits under the updated §2.7. Game-over is a pure function of
    // board+tray, so a stale flag is corrected (no-op for current-build saves).
    if (game.st.over && game.hasAnyMove()) game.st.over = false;
    return game;
  }

  /**
   * Spec §2.7, rotation-aware: a tray piece keeps the run alive when ANY of its
   * rotations has a legal placement (the player can always rotate for free).
   */
  private hasAnyMove(): boolean {
    return this.st.tray.some(
      (slot) => slot !== null && anyPlacementAnyRotation(this.st.board, slot.pieceId),
    );
  }
}

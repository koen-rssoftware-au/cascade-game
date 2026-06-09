// Shared engine types — contract per docs/superpowers/plans/2026-06-10-cascade.md.
// This module is pure data/types: no side effects, no host environment access.

export type Cell = number; // 0 = empty, 1..8 = color index (cosmetic only)
export type Board = Cell[]; // length 64, index = row * 8 + col
export const COLS = 8,
  ROWS = 8;
export const idx = (col: number, row: number) => row * 8 + col;

export interface PieceDef {
  id: string;
  cells: ReadonlyArray<readonly [number, number]>;
  w: number;
  h: number;
}
/** Quarter-turn rotation count, clockwise. 0 = catalog orientation. */
export type Rot = 0 | 1 | 2 | 3;

export interface TraySlot {
  pieceId: string;
  color: number;
  rot: Rot;
}

export interface FallMove {
  col: number;
  fromRow: number;
  toRow: number;
  color: number;
}
export interface ChainStep {
  step: number; // 1-based chain counter
  rowsCleared: number[];
  colsCleared: number[];
  clearedCells: Array<{ col: number; row: number; color: number }>; // each cell once (cross counted once)
  linesCleared: number; // rows + cols this step
  basePoints: number; // linesCleared² × 10
  pointsAfterChain: number; // basePoints × step
  fallMoves: FallMove[]; // gravity moves AFTER this clear
  boardAfter: Board; // snapshot after clear+gravity (for the view layer & tests)
}
export interface PlacementResult {
  placementPoints: number; // = piece cell count
  steps: ChainStep[]; // empty if no clear (then NO gravity ran)
  streakAfter: number;
  streakMultiplier: number; // min(streakAfter,5) if streakAfter ≥ 2 else 1
  linePoints: number; // Σ pointsAfterChain × streakMultiplier
  allClearBonus: number; // 300 or 0
  totalPoints: number; // placementPoints + linePoints + allClearBonus
  scoreAfter: number;
  maxChain: number; // run-level max after this placement
  trayRefilled: boolean;
  gameOver: boolean;
}
export interface ContinueResult {
  steps: ChainStep[];
  boardAfter: Board;
} // ZERO points (spec §9.3.1)

export type GameMode = 'normal' | 'daily';
export interface GameState {
  board: Board;
  tray: (TraySlot | null)[]; // tray length always 3; null = consumed
  score: number;
  streak: number;
  maxChain: number;
  placements: number;
  continueUsed: boolean;
  rngState: number;
  mode: GameMode;
  dailyDate: string | null; // 'YYYYMMDD'
  over: boolean;
}

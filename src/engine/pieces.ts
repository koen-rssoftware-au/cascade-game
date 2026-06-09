// Piece catalog — exactly per spec §2.3, offsets transcribed cell by cell.
import type { PieceDef } from './types';

function def(id: string, cells: ReadonlyArray<readonly [number, number]>): PieceDef {
  let maxC = 0;
  let maxR = 0;
  for (const [c, r] of cells) {
    if (c > maxC) maxC = c;
    if (r > maxR) maxR = r;
  }
  return { id, cells, w: maxC + 1, h: maxR + 1 };
}

export const PIECES: ReadonlyArray<PieceDef> = [
  def('P1', [[0, 0]] as const), // 1×1 dot
  def('P2', [[0, 0], [1, 0]] as const), // 1×2 horizontal
  def('P3', [[0, 0], [0, 1]] as const), // 2×1 vertical
  def('P4', [[0, 0], [1, 0], [2, 0]] as const), // 1×3 horizontal
  def('P5', [[0, 0], [0, 1], [0, 2]] as const), // 3×1 vertical
  def('P6', [[0, 0], [1, 0], [2, 0], [3, 0]] as const), // 1×4 horizontal
  def('P7', [[0, 0], [0, 1], [0, 2], [0, 3]] as const), // 4×1 vertical
  def('P8', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] as const), // 1×5 horizontal
  def('P9', [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] as const), // 5×1 vertical
  def('P10', [[0, 0], [1, 0], [0, 1], [1, 1]] as const), // 2×2 square
  def(
    'P11', // 3×3 square — all 9 cells
    [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]] as const,
  ),
  def('P12', [[0, 0], [0, 1], [1, 1]] as const), // L small
  def('P13', [[1, 0], [1, 1], [0, 1]] as const), // L small mirrored
  def('P14', [[0, 0], [1, 0], [0, 1]] as const), // L small rotated
  def('P15', [[0, 0], [1, 0], [1, 1]] as const), // L small rotated mirrored
  def('P16', [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]] as const), // L big
  def('P17', [[2, 0], [2, 1], [2, 2], [1, 2], [0, 2]] as const), // L big mirrored
  def('P18', [[0, 0], [1, 0], [2, 0], [1, 1]] as const), // T shape
  def('P19', [[1, 0], [2, 0], [0, 1], [1, 1]] as const), // S/Z horizontal
  def('P20', [[0, 0], [1, 0], [1, 1], [2, 1]] as const), // Z/S horizontal
];

const byId: ReadonlyMap<string, PieceDef> = new Map(PIECES.map((p) => [p.id, p]));

export function getPiece(id: string): PieceDef {
  const piece = byId.get(id);
  if (!piece) throw new Error(`Unknown piece id: ${id}`);
  return piece;
}

/** Alias of getPiece — same lookup, name used by the view layer. */
export const pieceById = getPiece;

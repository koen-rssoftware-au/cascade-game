// Piece catalog — exactly per spec §2.3, offsets transcribed cell by cell.
// Rotation support (gameplay update at the owner's request, deviating from
// §2.2 "pieces cannot be rotated"): every piece has 4 precomputed clockwise
// quarter-turn shapes, normalized to a (0,0) top-left origin.
import { anyLegalPlacement } from './board';
import type { Board, PieceDef, Rot } from './types';

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

/** One clockwise quarter turn: (x, y) → (h−1−y, x), already normalized to (0,0). */
function rotateOnce(piece: PieceDef): PieceDef {
  const cells = piece.cells
    .map(([x, y]) => [piece.h - 1 - y, x] as const)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return { id: piece.id, cells, w: piece.h, h: piece.w };
}

function cellsKey(p: PieceDef): string {
  return p.cells.map(([x, y]) => `${x},${y}`).join(';');
}

const ROTATIONS: ReadonlyMap<string, readonly [PieceDef, PieceDef, PieceDef, PieceDef]> = new Map(
  PIECES.map((p) => {
    const r1 = rotateOnce(p);
    const r2 = rotateOnce(r1);
    const r3 = rotateOnce(r2);
    return [p.id, [p, r1, r2, r3] as const];
  }),
);

/** Distinct shapes only (a 2×2 square has one, an S-piece two, an L four). */
const UNIQUE_ROTATIONS: ReadonlyMap<string, readonly PieceDef[]> = new Map(
  [...ROTATIONS].map(([id, rots]) => {
    const seen = new Set<string>();
    const unique: PieceDef[] = [];
    for (const r of rots) {
      const key = cellsKey(r);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(r);
      }
    }
    return [id, unique];
  }),
);

/** The piece's shape after `rot` clockwise quarter turns, origin-normalized. */
export function shapeFor(id: string, rot: Rot): PieceDef {
  const rots = ROTATIONS.get(id);
  if (!rots) throw new Error(`Unknown piece id: ${id}`);
  return rots[rot];
}

const UNIQUE_ROT_INDICES: ReadonlyMap<string, readonly Rot[]> = new Map(
  [...ROTATIONS].map(([id, rots]) => {
    const seen = new Set<string>();
    const out: Rot[] = [];
    ([0, 1, 2, 3] as const).forEach((r) => {
      const k = cellsKey(rots[r]);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(r);
      }
    });
    return [id, out];
  }),
);

/** Rotation indices producing distinct shapes (P1 → [0], P2 → [0,1], Ls → all four). */
export function uniqueRotations(id: string): readonly Rot[] {
  const rots = UNIQUE_ROT_INDICES.get(id);
  if (!rots) throw new Error(`Unknown piece id: ${id}`);
  return rots;
}

/** True iff the tray piece fits somewhere in at least one of its rotations. */
export function anyPlacementAnyRotation(board: Board, pieceId: string): boolean {
  const shapes = UNIQUE_ROTATIONS.get(pieceId);
  if (!shapes) throw new Error(`Unknown piece id: ${pieceId}`);
  return shapes.some((shape) => anyLegalPlacement(board, shape));
}

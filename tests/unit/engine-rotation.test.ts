// Rotation support (gameplay update, deviates from spec §2.2 at the owner's
// request): shapeFor math, rotateTray, rotation-aware legality/game-over, and
// serialization of the rot field incl. pre-rotation save compatibility.
import { describe, expect, it } from 'vitest';
import { PIECES, getPiece, shapeFor, anyPlacementAnyRotation } from '../../src/engine/pieces';
import { anyLegalPlacement } from '../../src/engine/board';
import { Game } from '../../src/engine/game';
import { idx, type Board, type Rot } from '../../src/engine/types';

const ROTS: Rot[] = [0, 1, 2, 3];

function key(cells: ReadonlyArray<readonly [number, number]>): string {
  return cells
    .map(([x, y]) => `${x},${y}`)
    .sort()
    .join(';');
}

describe('shapeFor — rotation math', () => {
  it('preserves cell count and normalizes to a (0,0) origin for every piece × rotation', () => {
    for (const p of PIECES) {
      for (const rot of ROTS) {
        const s = shapeFor(p.id, rot);
        expect(s.cells.length).toBe(p.cells.length);
        const minX = Math.min(...s.cells.map(([x]) => x));
        const minY = Math.min(...s.cells.map(([, y]) => y));
        expect(minX).toBe(0);
        expect(minY).toBe(0);
        const maxX = Math.max(...s.cells.map(([x]) => x));
        const maxY = Math.max(...s.cells.map(([, y]) => y));
        expect(s.w).toBe(maxX + 1);
        expect(s.h).toBe(maxY + 1);
        // no duplicate cells
        expect(new Set(s.cells.map(([x, y]) => `${x},${y}`)).size).toBe(s.cells.length);
      }
    }
  });

  it('swaps w/h on odd quarter turns', () => {
    for (const p of PIECES) {
      expect(shapeFor(p.id, 1).w).toBe(p.h);
      expect(shapeFor(p.id, 1).h).toBe(p.w);
      expect(shapeFor(p.id, 2).w).toBe(p.w);
      expect(shapeFor(p.id, 2).h).toBe(p.h);
    }
  });

  it('rot 0 is the catalog shape', () => {
    for (const p of PIECES) {
      expect(key(shapeFor(p.id, 0).cells)).toBe(key(p.cells));
    }
  });

  it('P4 (1×3 horizontal) rotated once equals the P5 (3×1 vertical) shape', () => {
    expect(key(shapeFor('P4', 1).cells)).toBe(key(getPiece('P5').cells));
    expect(key(shapeFor('P5', 1).cells)).toBe(key(getPiece('P4').cells));
  });

  it('P19 (S horizontal) rotated once is the exact hand-computed vertical S', () => {
    // P19 = (1,0)(2,0)(0,1)(1,1), w3 h2; CW: (x,y) → (h−1−y, x)
    expect(key(shapeFor('P19', 1).cells)).toBe(key([[0, 0], [0, 1], [1, 1], [1, 2]] as const));
  });

  it('the four small Ls (P12–P15) are each other’s rotations', () => {
    // P12 rotated CW once must match one of the other catalog Ls, and the
    // 4-cycle visits 4 distinct shapes (no symmetry for 3-cell Ls).
    const shapes = ROTS.map((r) => key(shapeFor('P12', r).cells));
    expect(new Set(shapes).size).toBe(4);
    const catalogLs = ['P12', 'P13', 'P14', 'P15'].map((id) => key(getPiece(id).cells));
    for (const s of shapes) expect(catalogLs).toContain(s);
  });

  it('rotation-invariant pieces (P1, P10, P11) have identical shapes in all rotations', () => {
    for (const id of ['P1', 'P10', 'P11']) {
      const base = key(shapeFor(id, 0).cells);
      for (const rot of ROTS) expect(key(shapeFor(id, rot).cells)).toBe(base);
    }
  });
});

describe('Game.rotateTray', () => {
  it('cycles 0→1→2→3→0 and serializes the rot field', () => {
    const game = Game.create(42, 'normal');
    expect(game.state.tray[0]?.rot).toBe(0);
    expect(game.rotateTray(0)).toBe(1);
    expect(game.rotateTray(0)).toBe(2);
    expect(game.rotateTray(0)).toBe(3);
    expect(game.rotateTray(0)).toBe(0);
    game.rotateTray(0);
    const revived = Game.deserialize(game.serialize());
    expect(revived.state.tray[0]?.rot).toBe(1);
  });

  it('throws on an empty slot', () => {
    const game = Game.create(42, 'normal');
    const slotIndex = 0;
    // place the slot-0 piece at its first legal position, then rotate the empty slot
    outer: for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (game.canPlace(slotIndex, c, r)) {
          game.place(slotIndex, c, r);
          break outer;
        }
      }
    }
    expect(() => game.rotateTray(slotIndex)).toThrow();
  });

  it('canPlace and place use the rotated shape', () => {
    // Empty board, anchor (6,0): horizontal P4 would need x=8 (out of bounds);
    // vertical P4 fits. Nothing can clear, so the placed cells stay put.
    const board: Board = new Array<number>(64).fill(0);
    const json = JSON.stringify({
      board,
      tray: [{ pieceId: 'P4', color: 3, rot: 0 }, null, null],
      score: 0,
      streak: 0,
      maxChain: 0,
      placements: 0,
      continueUsed: false,
      rngState: 99,
      mode: 'normal',
      dailyDate: null,
      over: false,
    });
    const game = Game.deserialize(json);
    expect(game.canPlace(0, 6, 0)).toBe(false); // horizontal: out of bounds at x=8
    game.rotateTray(0);
    expect(game.canPlace(0, 6, 0)).toBe(true); // vertical fits
    const result = game.place(0, 6, 0);
    expect(result.placementPoints).toBe(3);
    expect(result.steps).toHaveLength(0);
    expect(game.state.board[idx(6, 0)]).toBe(3);
    expect(game.state.board[idx(6, 1)]).toBe(3);
    expect(game.state.board[idx(6, 2)]).toBe(3);
    expect(game.state.board[idx(6, 3)]).toBe(0);
  });
});

describe('rotation-aware game over (§2.7 updated)', () => {
  it('a piece that only fits rotated keeps the run alive', () => {
    const board: Board = new Array<number>(64).fill(2);
    for (let r = 0; r < 8; r++) board[idx(7, r)] = 0; // only column 7 empty
    expect(anyLegalPlacement(board, getPiece('P4'))).toBe(false);
    expect(anyPlacementAnyRotation(board, 'P4')).toBe(true);
    const json = JSON.stringify({
      board,
      tray: [{ pieceId: 'P4', color: 3, rot: 0 }, null, null],
      score: 0,
      streak: 0,
      maxChain: 0,
      placements: 0,
      continueUsed: false,
      rngState: 99,
      mode: 'normal',
      dailyDate: null,
      over: false,
    });
    const game = Game.deserialize(json);
    // place it (rotated) — the run was alive, and the placement must succeed
    game.rotateTray(0);
    expect(game.canPlace(0, 7, 0)).toBe(true);
  });

  it('placement that leaves only-rotatable fits does not end the game', () => {
    // Board full except carefully poked holes (no row or column is ever full,
    // before or after the placement, so nothing clears):
    //   (0,0) P1 target · (7,0)+(7,1) the only adjacent pair, VERTICAL
    //   one extra hole per row/column: (0,3),(1,2),(2,3),(3,4),(4,5),(5,6),(6,7)
    // Tray after placing P1: P2 (horizontal pair) fits nowhere at rot 0 — the
    // only adjacency is vertical — so without rotation this would be game over.
    const board: Board = new Array<number>(64).fill(2);
    const holes: Array<[number, number]> = [
      [0, 0], [7, 0], [7, 1], [0, 3], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7],
    ];
    for (const [c, r] of holes) board[idx(c, r)] = 0;
    const json = JSON.stringify({
      board,
      tray: [{ pieceId: 'P1', color: 1, rot: 0 }, { pieceId: 'P2', color: 4, rot: 0 }, null],
      score: 0,
      streak: 0,
      maxChain: 0,
      placements: 0,
      continueUsed: false,
      rngState: 99,
      mode: 'normal',
      dailyDate: null,
      over: false,
    });
    const game = Game.deserialize(json);
    // fixture sanity: P2 fits nowhere unrotated, somewhere rotated
    expect(anyLegalPlacement(game.state.board, getPiece('P2'))).toBe(false);
    expect(anyPlacementAnyRotation(game.state.board, 'P2')).toBe(true);
    const result = game.place(0, 0, 0);
    expect(result.steps).toHaveLength(0); // nothing cleared
    expect(result.gameOver).toBe(false); // P2 fits only as its vertical rotation
  });
});

describe('pre-rotation save compatibility', () => {
  it('deserializes a tray slot without rot as rot 0', () => {
    const legacy = JSON.stringify({
      board: new Array(64).fill(0),
      tray: [{ pieceId: 'P4', color: 7 }, null, { pieceId: 'P11', color: 2 }],
      score: 12,
      streak: 0,
      maxChain: 1,
      placements: 3,
      continueUsed: false,
      rngState: 123,
      mode: 'normal',
      dailyDate: null,
      over: false,
    });
    const game = Game.deserialize(legacy);
    expect(game.state.tray[0]?.rot).toBe(0);
    expect(game.state.tray[2]?.rot).toBe(0);
    expect(game.canPlace(0, 0, 0)).toBe(true);
  });
});

// Spec §2.3 — piece catalog. All expected values transcribed from the spec table,
// NOT derived from the implementation.
import { describe, expect, it } from 'vitest';
import { PIECES, getPiece } from '../../src/engine/pieces';

// Expected cell counts per spec §2.3 (assignment-pinned).
const EXPECTED_CELL_COUNTS: Record<string, number> = {
  P1: 1, P2: 2, P3: 2, P4: 3, P5: 3, P6: 4, P7: 4, P8: 5, P9: 5, P10: 4,
  P11: 9, P12: 3, P13: 3, P14: 3, P15: 3, P16: 5, P17: 5, P18: 4, P19: 4, P20: 4,
};

// Exact offsets for the asymmetric pieces, transcribed cell by cell from §2.3.
const EXPECTED_OFFSETS: Record<string, Array<[number, number]>> = {
  P12: [[0, 0], [0, 1], [1, 1]],
  P13: [[1, 0], [1, 1], [0, 1]],
  P14: [[0, 0], [1, 0], [0, 1]],
  P15: [[0, 0], [1, 0], [1, 1]],
  P16: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  P17: [[2, 0], [2, 1], [2, 2], [1, 2], [0, 2]],
  P18: [[0, 0], [1, 0], [2, 0], [1, 1]],
  P19: [[1, 0], [2, 0], [0, 1], [1, 1]],
  P20: [[0, 0], [1, 0], [1, 1], [2, 1]],
};

describe('piece catalog (spec §2.3)', () => {
  it('contains exactly P1..P20 in catalog order', () => {
    expect(PIECES.length).toBe(20);
    expect(PIECES.map((p) => p.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `P${i + 1}`),
    );
  });

  it('has the exact cell count for every piece', () => {
    for (const piece of PIECES) {
      expect(piece.cells.length, piece.id).toBe(EXPECTED_CELL_COUNTS[piece.id]);
    }
    // Total cells across the catalog (independent sum of the spec table).
    const total = PIECES.reduce((n, p) => n + p.cells.length, 0);
    expect(total).toBe(76);
  });

  it('has the exact spec offsets for the asymmetric pieces P12–P20', () => {
    for (const [id, offsets] of Object.entries(EXPECTED_OFFSETS)) {
      const piece = getPiece(id);
      expect(piece.cells.map((c) => [c[0], c[1]]), id).toEqual(offsets);
    }
  });

  it('has the exact spec offsets for the simple pieces', () => {
    expect(getPiece('P1').cells.map((c) => [c[0], c[1]])).toEqual([[0, 0]]);
    expect(getPiece('P2').cells.map((c) => [c[0], c[1]])).toEqual([[0, 0], [1, 0]]);
    expect(getPiece('P3').cells.map((c) => [c[0], c[1]])).toEqual([[0, 0], [0, 1]]);
    expect(getPiece('P8').cells.map((c) => [c[0], c[1]])).toEqual(
      [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
    );
    expect(getPiece('P9').cells.map((c) => [c[0], c[1]])).toEqual(
      [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
    );
    expect(getPiece('P10').cells.map((c) => [c[0], c[1]])).toEqual(
      [[0, 0], [1, 0], [0, 1], [1, 1]],
    );
    // P11: all 9 cells of 3×3 — order-insensitive set comparison.
    const p11 = getPiece('P11').cells.map((c) => `${c[0]},${c[1]}`).sort();
    const all9: string[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) all9.push(`${c},${r}`);
    expect(p11).toEqual(all9.sort());
  });

  it('computes w/h consistent with the offsets (independent recomputation)', () => {
    for (const piece of PIECES) {
      let maxC = 0;
      let maxR = 0;
      for (const cell of piece.cells) {
        if (cell[0] > maxC) maxC = cell[0];
        if (cell[1] > maxR) maxR = cell[1];
      }
      expect(piece.w, `${piece.id} w`).toBe(maxC + 1);
      expect(piece.h, `${piece.id} h`).toBe(maxR + 1);
    }
    // Spot checks straight from the spec shape descriptions.
    expect([getPiece('P8').w, getPiece('P8').h]).toEqual([5, 1]); // 1×5 horizontal
    expect([getPiece('P9').w, getPiece('P9').h]).toEqual([1, 5]); // 5×1 vertical
    expect([getPiece('P11').w, getPiece('P11').h]).toEqual([3, 3]); // 3×3 square
    expect([getPiece('P16').w, getPiece('P16').h]).toEqual([3, 3]); // L big
  });

  it('getPiece throws on an unknown id', () => {
    expect(() => getPiece('P21')).toThrow();
    expect(() => getPiece('')).toThrow();
  });
});

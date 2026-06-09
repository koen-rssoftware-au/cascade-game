// Spec §7.1.6 — tray generation: reproducibility, adaptive weights (§2.6),
// survivability redraw. The reference draw below is an independent in-test
// re-implementation of the PINNED algorithm:
//   per slot: (1) weighted piece draw r = rng.next() × totalWeight walking the
//   catalog P1..P20, (2) color draw 1 + floor(rng.next() × 8).
//   Survivability replaces slot 2 only, WITHOUT consuming RNG, keeping the
//   already-drawn slot-2 color; if even P1 has no placement the tray is kept.
import { describe, expect, it } from 'vitest';
import { generateTray } from '../../src/engine/tray';
import { anyLegalPlacement, emptyBoard } from '../../src/engine/board';
import { getPiece } from '../../src/engine/pieces';
import { createRng } from '../../src/engine/rng';
import { idx } from '../../src/engine/types';
import type { Board, TraySlot } from '../../src/engine/types';
import type { Rng } from '../../src/engine/rng';

// Cell counts per catalog piece, transcribed from spec §2.3 (index = catalog order).
const CATALOG_CELLS = [1, 2, 2, 3, 3, 4, 4, 5, 5, 4, 9, 3, 3, 3, 3, 5, 5, 4, 4, 4];

function refWeights(board: Board): number[] {
  const filled = board.reduce((n, c) => n + (c !== 0 ? 1 : 0), 0);
  const f = filled / 64;
  return CATALOG_CELLS.map((cells) => {
    let w = 10;
    if (f > 0.55 && cells <= 3) w += 10; // relief mode
    if (f < 0.3 && cells >= 4) w += 5; // pressure mode
    return w;
  });
}

/** Raw 3-slot draw per the pinned RNG order — no survivability step. */
function refDrawTray(board: Board, rng: Rng): TraySlot[] {
  const ws = refWeights(board);
  const total = ws.reduce((a, w) => a + w, 0);
  const out: TraySlot[] = [];
  for (let s = 0; s < 3; s++) {
    let r = rng.next() * total;
    let pick = 19;
    for (let i = 0; i < 20; i++) {
      const w = ws[i] ?? 0;
      if (r < w) {
        pick = i;
        break;
      }
      r -= w;
    }
    const color = 1 + Math.floor(rng.next() * 8);
    out.push({ pieceId: `P${pick + 1}`, color, rot: 0 });
  }
  return out;
}

/** f = 0.625 board (40 filled) where EVERY catalog piece has a legal placement. */
function reliefBoard(): Board {
  const board: Board = new Array(64).fill(1);
  for (let r = 0; r < 8; r++) board[idx(0, r)] = 0; // col 0 fully empty (vertical 5 fits)
  for (const c of [1, 2]) for (const r of [5, 6, 7]) board[idx(c, r)] = 0; // 3×3 region w/ col 0
  for (let c = 3; c < 8; c++) for (const r of [6, 7]) board[idx(c, r)] = 0; // row 6–7 strip
  return board;
}

/** f = 0.1875 board (12 filled). */
function pressureBoard(): Board {
  const board = emptyBoard();
  for (let c = 0; c < 8; c++) board[idx(c, 0)] = 2;
  for (let c = 0; c < 4; c++) board[idx(c, 1)] = 3;
  return board;
}

describe('tray generation (spec §2.6, §7.1.6)', () => {
  it('is reproducible byte-for-byte from the same rng state', () => {
    for (const seed of [1, 42, 12345, 0xdeadbeef]) {
      const t1 = generateTray(emptyBoard(), createRng(seed));
      const t2 = generateTray(emptyBoard(), createRng(seed));
      expect(JSON.stringify(t1)).toBe(JSON.stringify(t2));
    }
    // Two consecutive trays from one rng are reproducible as a sequence too.
    const rA = createRng(777);
    const rB = createRng(777);
    expect([generateTray(emptyBoard(), rA), generateTray(emptyBoard(), rA)]).toEqual([
      generateTray(emptyBoard(), rB),
      generateTray(emptyBoard(), rB),
    ]);
  });

  it('matches the pinned draw order exactly (reference re-implementation, 200 seeds)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const expected = refDrawTray(emptyBoard(), createRng(seed));
      const actual = generateTray(emptyBoard(), createRng(seed));
      expect(actual).toEqual(expected); // empty board → survivability never triggers
    }
  });

  it('always yields 3 slots with valid piece ids and colors 1..8', () => {
    const rng = createRng(31337);
    for (let i = 0; i < 100; i++) {
      const tray = generateTray(emptyBoard(), rng);
      expect(tray.length).toBe(3);
      for (const slot of tray) {
        expect(() => getPiece(slot.pieceId)).not.toThrow();
        expect(slot.color).toBeGreaterThanOrEqual(1);
        expect(slot.color).toBeLessThanOrEqual(8);
        expect(Number.isInteger(slot.color)).toBe(true);
      }
    }
  });

  it('relief mode f = 0.625 (> 0.55): small-piece share ≈ 180/290 (±2pp over 10,000 trays)', () => {
    const board = reliefBoard();
    expect(board.reduce((n, c) => n + (c !== 0 ? 1 : 0), 0)).toBe(40); // f = 0.625
    // Fixture sanity: every piece placeable → no survivability interference.
    for (let i = 1; i <= 20; i++) expect(anyLegalPlacement(board, getPiece(`P${i}`))).toBe(true);

    // Exact weighted expectation from the spec weight table:
    // 9 small pieces (≤3 cells) at weight 20 = 180; 11 large at 10 = 110.
    const expectedShare = 180 / 290;
    const rng = createRng(555);
    let small = 0;
    let totalDraws = 0;
    for (let i = 0; i < 10_000; i++) {
      for (const slot of generateTray(board, rng)) {
        totalDraws++;
        const cells = CATALOG_CELLS[parseInt(slot.pieceId.slice(1), 10) - 1];
        if (cells !== undefined && cells <= 3) small++;
      }
    }
    expect(totalDraws).toBe(30_000);
    expect(Math.abs(small / totalDraws - expectedShare)).toBeLessThan(0.02);
  });

  it('pressure mode f = 0.1875 (< 0.30): small-piece share ≈ 90/255 (±2pp over 10,000 trays)', () => {
    const board = pressureBoard();
    expect(board.reduce((n, c) => n + (c !== 0 ? 1 : 0), 0)).toBe(12); // f = 0.1875
    // 9 small at 10 = 90; 11 large at 15 = 165; total 255.
    const expectedShare = 90 / 255;
    const rng = createRng(666);
    let small = 0;
    for (let i = 0; i < 10_000; i++) {
      for (const slot of generateTray(board, rng)) {
        const cells = CATALOG_CELLS[parseInt(slot.pieceId.slice(1), 10) - 1];
        if (cells !== undefined && cells <= 3) small++;
      }
    }
    expect(Math.abs(small / 30_000 - expectedShare)).toBeLessThan(0.02);
  });

  it('neutral band (0.30 ≤ f ≤ 0.55): uniform weights, small share ≈ 9/20', () => {
    const board = emptyBoard();
    for (let i = 0; i < 32; i++) board[i] = 1; // f = 0.5 → no bonus either way
    const rng = createRng(888);
    let small = 0;
    for (let i = 0; i < 10_000; i++) {
      for (const slot of generateTray(board, rng)) {
        const cells = CATALOG_CELLS[parseInt(slot.pieceId.slice(1), 10) - 1];
        if (cells !== undefined && cells <= 3) small++;
      }
    }
    expect(Math.abs(small / 30_000 - 9 / 20)).toBeLessThan(0.02);
  });

  describe('survivability redraw (spec §2.6.4)', () => {
    // Board full except (0,7) and (1,7): only P1 and P2 have legal placements.
    function nearFullBoard(): Board {
      const board: Board = new Array(64).fill(3);
      board[idx(0, 7)] = 0;
      board[idx(1, 7)] = 0;
      return board;
    }

    // Seed chosen so the raw draw contains neither P1 nor P2 (verified below):
    // seed 1 draws P13, P11, P20 — all unplaceable on the two-cell gap.
    const SEED = 1;

    it('replaces slot 2 with the largest placeable piece, keeping the drawn color, consuming no RNG', () => {
      const board = nearFullBoard();
      const raw = refDrawTray(board, createRng(SEED));
      // Fixture sanity: none of the three raw pieces is placeable.
      expect(raw.every((s) => !anyLegalPlacement(board, getPiece(s.pieceId)))).toBe(true);

      const tray = generateTray(board, createRng(SEED));
      expect(tray[0]).toEqual(raw[0]);
      expect(tray[1]).toEqual(raw[1]);
      // Largest placeable by (cell count DESC, catalog index ASC): P2 (2 cells) beats P1.
      expect(tray[2]?.pieceId).toBe('P2');
      expect(tray[2]?.color).toBe(raw[2]?.color); // keeps the already-drawn color

      // Deterministic across two runs from the same rng state.
      expect(generateTray(board, createRng(SEED))).toEqual(tray);

      // The redraw consumes no RNG: both rngs continue identically.
      const rngUsed = createRng(SEED);
      generateTray(board, rngUsed);
      const rngRef = createRng(SEED);
      refDrawTray(board, rngRef); // exactly 6 draws
      expect(rngUsed.next()).toBe(rngRef.next());
    });

    it('does not trigger when at least one drawn piece is placeable', () => {
      const board = nearFullBoard();
      // Hunt a seed whose raw draw contains P1 or P2.
      let seed = 1;
      for (; seed < 1000; seed++) {
        const raw = refDrawTray(board, createRng(seed));
        if (raw.some((s) => s.pieceId === 'P1' || s.pieceId === 'P2')) break;
      }
      const raw = refDrawTray(board, createRng(seed));
      expect(raw.some((s) => anyLegalPlacement(board, getPiece(s.pieceId)))).toBe(true);
      expect(generateTray(board, createRng(seed))).toEqual(raw); // tray unchanged
    });

    it('if even P1 has no legal placement (full board), the drawn tray is kept', () => {
      const board: Board = new Array(64).fill(5);
      const raw = refDrawTray(board, createRng(SEED));
      expect(generateTray(board, createRng(SEED))).toEqual(raw);
    });
  });
});

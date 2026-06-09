// Adaptive bag — exact algorithm spec §2.6, with the pinned RNG draw order:
// for each of the 3 slots in order: (1) one weighted piece draw
// (r = rng.next() × totalWeight, walking the catalog P1..P20 subtracting
// weights), then (2) one color draw (1 + floor(rng.next() × 8)).
// The survivability redraw (§2.6.4) replaces slot 2 only, deterministically and
// WITHOUT consuming RNG: catalog sorted by (cell count DESC, catalog index ASC),
// first piece with a legal placement; the replacement KEEPS the color already
// drawn for slot 2. If even P1 has no legal placement, the drawn tray is kept.
import { PIECES, anyPlacementAnyRotation } from './pieces';
import { COLS, ROWS } from './types';
import type { Board, TraySlot } from './types';
import type { Rng } from './rng';

function pieceWeights(board: Board): number[] {
  const filled = board.reduce((n, c) => n + (c !== 0 ? 1 : 0), 0);
  const f = filled / (COLS * ROWS);
  return PIECES.map((p) => {
    let w = 10; // base weight
    if (f > 0.55 && p.cells.length <= 3) w += 10; // relief mode
    if (f < 0.3 && p.cells.length >= 4) w += 5; // pressure mode
    return w;
  });
}

export function generateTray(board: Board, rng: Rng): TraySlot[] {
  const weights = pieceWeights(board);
  const totalWeight = weights.reduce((a, w) => a + w, 0);

  const slots: TraySlot[] = [];
  for (let s = 0; s < 3; s++) {
    let r = rng.next() * totalWeight;
    let pick = PIECES.length - 1; // float-safety fallback: last catalog entry
    for (let i = 0; i < PIECES.length; i++) {
      const w = weights[i] ?? 0;
      if (r < w) {
        pick = i;
        break;
      }
      r -= w;
    }
    const piece = PIECES[pick];
    if (!piece) throw new Error(`Catalog index out of range: ${pick}`);
    const color = 1 + Math.floor(rng.next() * 8);
    slots.push({ pieceId: piece.id, color, rot: 0 });
  }

  // Survivability guarantee (§2.6.4) — runs at most once per tray. With the
  // rotation update a piece counts as placeable when ANY of its rotations fits.
  const anyPlaceable = slots.some((slot) => anyPlacementAnyRotation(board, slot.pieceId));
  if (!anyPlaceable) {
    const candidates = PIECES.map((p, i) => ({ p, i })).sort(
      (a, b) => b.p.cells.length - a.p.cells.length || a.i - b.i,
    );
    for (const { p } of candidates) {
      if (anyPlacementAnyRotation(board, p.id)) {
        const drawn = slots[2];
        if (drawn) slots[2] = { pieceId: p.id, color: drawn.color, rot: 0 };
        break;
      }
    }
    // If nothing fits (even P1), fall through: the drawn tray stays unchanged
    // and the game will end legitimately.
  }

  return slots;
}

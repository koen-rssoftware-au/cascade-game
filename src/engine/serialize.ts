// GameState ↔ JSON round trip, including the RNG state.
// deserializeGameState validates the payload and returns a fresh deep copy in
// canonical key order, so engine-produced JSON re-serializes byte-identically.
import { COLS, ROWS } from './types';
import { getPiece } from './pieces';
import type { Board, GameMode, GameState, Rot, TraySlot } from './types';

export function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

function fail(reason: string): never {
  throw new Error(`Invalid GameState payload: ${reason}`);
}

function asFiniteNumber(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${name} must be a finite number`);
  return v;
}

function asBoolean(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') fail(`${name} must be a boolean`);
  return v;
}

function asBoard(v: unknown): Board {
  if (!Array.isArray(v) || v.length !== COLS * ROWS) fail(`board must have ${COLS * ROWS} cells`);
  const board: number[] = [];
  for (const cell of v) {
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 8) {
      fail('board cells must be integers 0..8');
    }
    board.push(cell);
  }
  return board;
}

function asTray(v: unknown): (TraySlot | null)[] {
  if (!Array.isArray(v) || v.length !== 3) fail('tray must have exactly 3 slots');
  return v.map((entry) => {
    if (entry === null) return null;
    if (typeof entry !== 'object' || entry === undefined) fail('tray slot must be null or object');
    const rec = entry as Record<string, unknown>;
    const pieceId = rec['pieceId'];
    const color = rec['color'];
    if (typeof pieceId !== 'string') fail('tray slot pieceId must be a string');
    getPiece(pieceId); // throws on unknown piece id
    if (typeof color !== 'number' || !Number.isInteger(color) || color < 1 || color > 8) {
      fail('tray slot color must be an integer 1..8');
    }
    // rot is absent in pre-rotation saves — default 0 keeps old runs loadable
    const rot = rec['rot'] ?? 0;
    if (rot !== 0 && rot !== 1 && rot !== 2 && rot !== 3) {
      fail('tray slot rot must be 0..3');
    }
    return { pieceId, color, rot: rot as Rot };
  });
}

export function deserializeGameState(json: string): GameState {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('payload must be a JSON object');
  }
  const rec = raw as Record<string, unknown>;

  const mode = rec['mode'];
  if (mode !== 'normal' && mode !== 'daily') fail("mode must be 'normal' or 'daily'");
  const dailyDate = rec['dailyDate'];
  if (dailyDate !== null && typeof dailyDate !== 'string') {
    fail('dailyDate must be a string or null');
  }

  // Canonical key order — must match Game.create's state literal exactly.
  return {
    board: asBoard(rec['board']),
    tray: asTray(rec['tray']),
    score: asFiniteNumber(rec['score'], 'score'),
    streak: asFiniteNumber(rec['streak'], 'streak'),
    maxChain: asFiniteNumber(rec['maxChain'], 'maxChain'),
    placements: asFiniteNumber(rec['placements'], 'placements'),
    continueUsed: asBoolean(rec['continueUsed'], 'continueUsed'),
    rngState: asFiniteNumber(rec['rngState'], 'rngState'),
    mode: mode as GameMode,
    dailyDate,
    over: asBoolean(rec['over'], 'over'),
  };
}

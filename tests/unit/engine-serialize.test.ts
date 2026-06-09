// Spec §7.1.8 — persistence: serialize → deserialize → deep-equal round trip
// for mid-run state INCLUDING the RNG state (resumed runs continue the same
// piece sequence). Plus seeded RNG/state and FNV-1a contract checks.
import { describe, expect, it } from 'vitest';
import { Game } from '../../src/engine/game';
import { deserializeGameState, serializeGameState } from '../../src/engine/serialize';
import { createRng, hashStringToSeed } from '../../src/engine/rng';
import { emptyBoard } from '../../src/engine/board';
import type { GameState, PlacementResult } from '../../src/engine/types';

/** Deterministic move rule: first legal (slot 0..2, col 0..7, row 0..7). */
function placeFirstLegal(game: Game): PlacementResult {
  for (let slot = 0; slot < 3; slot++) {
    for (let col = 0; col < 8; col++) {
      for (let row = 0; row < 8; row++) {
        if (game.canPlace(slot, col, row)) return game.place(slot, col, row);
      }
    }
  }
  throw new Error('no legal move found');
}

describe('seeded RNG (mulberry32)', () => {
  it('same seed → identical sequence; values in [0,1)', () => {
    const a = createRng(123);
    const b = createRng(123);
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('getState/setState resumes the exact sequence', () => {
    const a = createRng(99);
    a.next();
    a.next();
    const snapshot = a.getState();
    const tail = [a.next(), a.next(), a.next()];
    const b = createRng(1);
    b.setState(snapshot);
    expect([b.next(), b.next(), b.next()]).toEqual(tail);
  });

  it('seed is coerced to uint32; seed 0 is remapped to 0x9E3779B9', () => {
    const z = createRng(0);
    const remapped = createRng(0x9e3779b9);
    expect(z.next()).toBe(remapped.next());
    // uint32 coercion: 2^32 + 5 ≡ 5
    expect(createRng(2 ** 32 + 5).next()).toBe(createRng(5).next());
    expect(createRng(-1).next()).toBe(createRng(0xffffffff).next());
  });
});

describe('hashStringToSeed (FNV-1a 32-bit)', () => {
  it('matches the canonical FNV-1a test vectors', () => {
    expect(hashStringToSeed('')).toBe(0x811c9dc5); // offset basis
    expect(hashStringToSeed('a')).toBe(0xe40c292c);
    expect(hashStringToSeed('foobar')).toBe(0xbf9cf968);
  });

  it('is deterministic and uint32 for daily date strings', () => {
    const h = hashStringToSeed('20260610');
    expect(h).toBe(hashStringToSeed('20260610'));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
    expect(hashStringToSeed('20260611')).not.toBe(h);
  });
});

describe('persistence round trip (spec §7.1.8)', () => {
  it('mid-run state survives serialize → deserialize exactly', () => {
    const game = Game.create(999, 'normal');
    placeFirstLegal(game);
    placeFirstLegal(game);
    const json = game.serialize();
    const revived = Game.deserialize(json);
    expect(revived.state).toEqual(game.state);
    expect(revived.serialize()).toBe(json); // byte-identical re-serialization
  });

  it('daily mode and dailyDate round trip', () => {
    const game = Game.create(hashStringToSeed('20260610'), 'daily', '20260610');
    const revived = Game.deserialize(game.serialize());
    expect(revived.state.mode).toBe('daily');
    expect(revived.state.dailyDate).toBe('20260610');
  });

  it('a deserialized game continues the IDENTICAL piece sequence (RNG state)', () => {
    const original = Game.create(31415, 'normal');
    placeFirstLegal(original); // consume one piece mid-tray
    const json = original.serialize();
    const revived = Game.deserialize(json);

    // Play the same deterministic moves on both until ≥2 tray refills happened:
    // refills draw from the RNG, so identical trays prove RNG continuation.
    let refills = 0;
    for (let i = 0; i < 24 && refills < 2; i++) {
      if (original.state.over) break;
      const a = placeFirstLegal(original);
      const b = placeFirstLegal(revived);
      expect(b).toEqual(a); // identical results incl. steps and scores
      expect(revived.state).toEqual(original.state); // identical state incl. refilled trays
      if (a.trayRefilled) refills++;
    }
    expect(refills).toBeGreaterThanOrEqual(2);
  });

  it('continueUsed, streak, maxChain and over flags round trip', () => {
    const state: GameState = {
      board: emptyBoard(),
      tray: [{ pieceId: 'P4', color: 7 }, null, { pieceId: 'P11', color: 2 }],
      score: 4820,
      streak: 3,
      maxChain: 2,
      placements: 41,
      continueUsed: true,
      rngState: 0xc0ffee,
      mode: 'daily',
      dailyDate: '20260610',
      over: true,
    };
    const revived = deserializeGameState(serializeGameState(state));
    expect(revived).toEqual(state);
    expect(revived).not.toBe(state); // fresh object, not a reference
    expect(revived.board).not.toBe(state.board);
  });

  it('rejects malformed payloads', () => {
    expect(() => deserializeGameState('not json')).toThrow();
    expect(() => deserializeGameState('42')).toThrow();
    expect(() => deserializeGameState('{}')).toThrow();

    const good: GameState = {
      board: emptyBoard(),
      tray: [null, null, null],
      score: 0,
      streak: 0,
      maxChain: 0,
      placements: 0,
      continueUsed: false,
      rngState: 1,
      mode: 'normal',
      dailyDate: null,
      over: false,
    };
    const withBadBoard = { ...good, board: [0, 1, 2] };
    expect(() => deserializeGameState(JSON.stringify(withBadBoard))).toThrow();
    const withBadTray = { ...good, tray: [null, null] };
    expect(() => deserializeGameState(JSON.stringify(withBadTray))).toThrow();
    const withBadPiece = { ...good, tray: [{ pieceId: 'P99', color: 1 }, null, null] };
    expect(() => deserializeGameState(JSON.stringify(withBadPiece))).toThrow();
    const withBadMode = { ...good, mode: 'hard' };
    expect(() => deserializeGameState(JSON.stringify(withBadMode))).toThrow();
  });
});

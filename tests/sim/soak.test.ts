// Random-agent soak (spec §7.2) + monetization soak extension (spec §9.7.6).
//
// 10,000 complete games with RandomAgent across game seeds 1..10000. Invariants
// asserted on EVERY placement (plain throwing checks — expect() per cell would
// dominate the runtime):
//   - no exceptions anywhere;
//   - score monotonically non-decreasing within a run;
//   - every board cell is an integer in 0..8;
//   - cascade loop ≤ 64 iterations (spec §7.1.4 bound);
//   - "no floating blocks immediately after any cascade loop ends" — applies
//     only when the placement triggered ≥ 1 clear (steps.length > 0; spec §2.4
//     note: gravity never runs after a plain no-clear placement): re-running
//     findFullLines on the final board finds nothing, and applyGravity moves
//     nothing;
//   - every game terminates: game over reached, hard safety cap of 10,000
//     placements per game never hit.
import { describe, expect, it } from 'vitest';
import { applyGravity, findFullLines } from '../../src/engine/board';
import { Game } from '../../src/engine/game';
import { createRng } from '../../src/engine/rng';
import { RandomAgent, SAFETY_CAP, playGame } from '../../src/sim/agents';
import { DEFAULT_CONFIG } from '../../src/monetization/config';
import {
  MonetizationDirector,
  createInitialMonetizationState,
  localDateString,
} from '../../src/monetization/director';

const GAMES = 10_000;

describe('random-agent soak (spec §7.2)', () => {
  it(
    `plays ${GAMES} complete games with every per-turn invariant holding`,
    { timeout: 120_000 },
    () => {
      let totalScore = 0;
      let totalPlacements = 0;
      let maxChainObserved = 0;

      for (let seed = 1; seed <= GAMES; seed++) {
        const game = Game.create(seed, 'normal');
        // Agent rng is its own stream, deliberately decoupled from the game rng.
        const agent = new RandomAgent(createRng((seed ^ 0x9e3779b9) >>> 0));
        let prevScore = 0;

        const played = playGame(game, agent, (result, move, g) => {
          const where = `seed ${seed}, placement ${g.state.placements}, move ${JSON.stringify(move)}`;

          // Score monotonically non-decreasing within the run.
          if (result.scoreAfter < prevScore) {
            throw new Error(`Score decreased ${prevScore} -> ${result.scoreAfter} (${where})`);
          }
          prevScore = result.scoreAfter;

          // Cascade loop bound (spec §7.1.4).
          if (result.steps.length > 64) {
            throw new Error(`Cascade ran ${result.steps.length} steps > 64 (${where})`);
          }

          // Every cell an integer in 0..8.
          const board = g.state.board;
          for (let i = 0; i < board.length; i++) {
            const cell = board[i];
            if (cell === undefined || !Number.isInteger(cell) || cell < 0 || cell > 8) {
              throw new Error(`Cell ${i} out of range: ${String(cell)} (${where})`);
            }
          }

          // No floating blocks immediately after a cascade loop that ran
          // (steps.length > 0). Without a clear, gravity never ran and floating
          // arrangements are legitimate (spec §2.4: gravity only after a clear).
          if (result.steps.length > 0) {
            const { rows, cols } = findFullLines(board);
            if (rows.length > 0 || cols.length > 0) {
              throw new Error(
                `Full lines survived the cascade loop: rows=[${rows.join()}] cols=[${cols.join()}] (${where})`,
              );
            }
            const { moves } = applyGravity(board);
            if (moves.length > 0) {
              throw new Error(`Gravity not settled after cascade: ${moves.length} moves (${where})`);
            }
          }
        });

        // Termination: game over reached, safety cap never hit.
        if (played.capHit || played.placements >= SAFETY_CAP) {
          throw new Error(`Safety cap of ${SAFETY_CAP} placements hit at seed ${seed}`);
        }
        if (!game.state.over) {
          throw new Error(`Game did not terminate at seed ${seed}`);
        }

        totalScore += played.finalScore;
        totalPlacements += played.placements;
        if (played.maxChain > maxChainObserved) maxChainObserved = played.maxChain;
      }

      console.log(
        `[soak] games played: ${GAMES} | mean score: ${(totalScore / GAMES).toFixed(1)} | ` +
          `max cascade chain observed: ${maxChainObserved} | ` +
          `mean placements per game: ${(totalPlacements / GAMES).toFixed(1)}`,
      );

      expect(maxChainObserved).toBeGreaterThanOrEqual(1);
      expect(totalPlacements / GAMES).toBeGreaterThan(0);
    },
  );
});

describe('monetization soak extension (spec §9.7.6)', () => {
  it('interstitial decisions never violate grace/cadence/cooldown/cap across 10,000 game_over events', () => {
    const cfg = DEFAULT_CONFIG;
    // Fake clock: starts at a fixed local-time anchor, advances 30s per game.
    let nowMs = new Date(2026, 5, 10, 9, 0, 0).getTime();
    const director = new MonetizationDirector(cfg, createInitialMonetizationState(), () => nowMs);

    // Shadow model recomputed from the config alone (independent bookkeeping).
    let totalGames = 0;
    let oversSinceShown = 0;
    let lastShownAt: number | null = null;
    const shownPerDay = new Map<string, number>();
    const shownEvents: Array<{ index: number; at: number; oversBefore: number }> = [];

    for (let i = 1; i <= GAMES; i++) {
      nowMs += 30_000;
      director.recordGameOver();
      totalGames++;
      oversSinceShown++;

      const today = localDateString(nowMs);
      const expected =
        totalGames > cfg.gracePeriodGames &&
        oversSinceShown >= cfg.gameOversPerInterstitial &&
        (lastShownAt === null || nowMs - lastShownAt >= cfg.interstitialCooldownMs) &&
        (shownPerDay.get(today) ?? 0) < cfg.interstitialDailyCap;

      const decision = director.shouldShowInterstitial(false);
      if (decision !== expected) {
        throw new Error(
          `Decision mismatch at game_over ${i}: director=${decision} expected=${expected} ` +
            `(totalGames=${totalGames}, oversSinceShown=${oversSinceShown}, ` +
            `sinceLastMs=${lastShownAt === null ? 'n/a' : nowMs - lastShownAt}, ` +
            `shownToday=${shownPerDay.get(today) ?? 0})`,
        );
      }

      if (decision) {
        shownEvents.push({ index: i, at: nowMs, oversBefore: oversSinceShown });
        director.recordInterstitialShown();
        oversSinceShown = 0;
        lastShownAt = nowMs;
        shownPerDay.set(today, (shownPerDay.get(today) ?? 0) + 1);
      }
    }

    // Direct invariant scan over the shown events (belt and braces).
    expect(shownEvents.length).toBeGreaterThan(0);
    for (let k = 0; k < shownEvents.length; k++) {
      const ev = shownEvents[k];
      if (!ev) throw new Error('unreachable: shownEvents index in range');
      // Grace period: never within the first N games ever.
      expect(ev.index).toBeGreaterThan(cfg.gracePeriodGames);
      // Cadence: at least N game overs since the previous interstitial.
      expect(ev.oversBefore).toBeGreaterThanOrEqual(cfg.gameOversPerInterstitial);
      // Cooldown between consecutive shows.
      if (k > 0) {
        const prev = shownEvents[k - 1];
        if (!prev) throw new Error('unreachable: prev index in range');
        expect(ev.at - prev.at).toBeGreaterThanOrEqual(cfg.interstitialCooldownMs);
      }
    }
    // Daily cap never exceeded; with 2,880 game overs per simulated day the cap
    // must actually be reached on full days, proving it binds.
    let maxPerDay = 0;
    for (const count of shownPerDay.values()) {
      expect(count).toBeLessThanOrEqual(cfg.interstitialDailyCap);
      if (count > maxPerDay) maxPerDay = count;
    }
    expect(maxPerDay).toBe(cfg.interstitialDailyCap);

    console.log(
      `[monetization soak] game_over events: ${GAMES} | interstitials shown: ${shownEvents.length} | ` +
        `days simulated: ${shownPerDay.size} | max shown in one day: ${maxPerDay}`,
    );
  });
});

describe('monetization soak attached to the real random-agent soak (spec §9.7.6)', () => {
  const ATTACHED_GAMES = 2_000;

  it(
    `plays ${ATTACHED_GAMES} real games with the director attached; grace/cadence/cooldown/cap hold`,
    { timeout: 120_000 },
    () => {
      const cfg = DEFAULT_CONFIG;
      // Fake clock advanced by an IRREGULAR per-game amount derived from the game
      // itself (10s overhead + 1.5s per placement) — unlike the fixed-step soak
      // above, cooldown and local-day boundaries land at uneven offsets.
      let nowMs = new Date(2026, 5, 10, 9, 0, 0).getTime();
      const director = new MonetizationDirector(cfg, createInitialMonetizationState(), () => nowMs);

      // Shadow model recomputed from the config alone (same approach as above).
      let totalGames = 0;
      let oversSinceShown = 0;
      let lastShownAt: number | null = null;
      const shownPerDay = new Map<string, number>();
      const shownEvents: Array<{ index: number; at: number; oversBefore: number }> = [];

      for (let seed = 1; seed <= ATTACHED_GAMES; seed++) {
        const game = Game.create((seed + 0x5eed_0000) >>> 0, 'normal');
        const agent = new RandomAgent(createRng((seed ^ 0x51f15eed) >>> 0));
        const played = playGame(game, agent);
        if (played.capHit || !game.state.over) {
          throw new Error(`Game did not terminate cleanly at seed ${seed}`);
        }

        nowMs += 10_000 + played.placements * 1_500;
        director.recordGameOver();
        totalGames++;
        oversSinceShown++;

        const today = localDateString(nowMs);
        const expected =
          totalGames > cfg.gracePeriodGames &&
          oversSinceShown >= cfg.gameOversPerInterstitial &&
          (lastShownAt === null || nowMs - lastShownAt >= cfg.interstitialCooldownMs) &&
          (shownPerDay.get(today) ?? 0) < cfg.interstitialDailyCap;

        const decision = director.shouldShowInterstitial(false);
        if (decision !== expected) {
          throw new Error(
            `Decision mismatch at game ${seed}: director=${decision} expected=${expected} ` +
              `(totalGames=${totalGames}, oversSinceShown=${oversSinceShown}, ` +
              `placements=${played.placements}, ` +
              `sinceLastMs=${lastShownAt === null ? 'n/a' : nowMs - lastShownAt}, ` +
              `shownToday=${shownPerDay.get(today) ?? 0})`,
          );
        }

        if (decision) {
          shownEvents.push({ index: seed, at: nowMs, oversBefore: oversSinceShown });
          director.recordInterstitialShown();
          oversSinceShown = 0;
          lastShownAt = nowMs;
          shownPerDay.set(today, (shownPerDay.get(today) ?? 0) + 1);
        }
      }

      // Direct invariant scan over the shown events (belt and braces).
      expect(shownEvents.length).toBeGreaterThan(0);
      for (let k = 0; k < shownEvents.length; k++) {
        const ev = shownEvents[k];
        if (!ev) throw new Error('unreachable: shownEvents index in range');
        // Never during the grace period (first N games ever).
        expect(ev.index).toBeGreaterThan(cfg.gracePeriodGames);
        // Cadence: at least N game overs since the previous interstitial.
        expect(ev.oversBefore).toBeGreaterThanOrEqual(cfg.gameOversPerInterstitial);
        // Gaps between consecutive shows >= cooldown.
        if (k > 0) {
          const prev = shownEvents[k - 1];
          if (!prev) throw new Error('unreachable: prev index in range');
          expect(ev.at - prev.at).toBeGreaterThanOrEqual(cfg.interstitialCooldownMs);
        }
      }
      // Per-local-day count never exceeds the cap.
      for (const count of shownPerDay.values()) {
        expect(count).toBeLessThanOrEqual(cfg.interstitialDailyCap);
      }

      console.log(
        `[attached soak] games: ${ATTACHED_GAMES} | interstitials shown: ${shownEvents.length} | ` +
          `days simulated: ${shownPerDay.size} | ` +
          `sim duration: ${((nowMs - new Date(2026, 5, 10, 9, 0, 0).getTime()) / 3_600_000).toFixed(1)}h`,
      );
    },
  );
});

/**
 * §9.7.1 — MonetizationDirector unit tests (spec §9.2, §9.3.2–3, §9.4, §9.6).
 * Every decision is driven by a mocked clock; no real timers anywhere.
 *
 * Pinned semantics (plan "MonetizationDirector contract"):
 * - recordGameOver() increments totalGamesCompleted and gameOversSinceInterstitial.
 * - shouldShowInterstitial() is true iff gameOversSinceInterstitial >= 2 AND all
 *   other rules (grace, cooldown, daily cap, no-double-tax, removeAds) pass.
 * - recordInterstitialShown() resets the counter to 0 and stamps time + local date.
 * - Decision methods are pure reads; only record*() mutates state.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/monetization/config';
import {
  MonetizationDirector,
  createInitialMonetizationState,
  isoWeekString,
  localDateString,
  type MonetizationState,
} from '../../src/monetization/director';
import { EVENT_NAMES, EventLog, type MonetizationEvent } from '../../src/monetization/events';

/** Local-noon epoch for Wednesday 2026-06-10 (ISO week 2026-W24). */
const NOON = new Date(2026, 5, 10, 12, 0, 0).getTime();

function makeClock(start: number) {
  let t = start;
  return {
    now: (): number => t,
    set: (v: number): void => {
      t = v;
    },
    advance: (ms: number): void => {
      t += ms;
    },
  };
}

function freshDirector(overrides: Partial<MonetizationState> = {}, startAt: number = NOON) {
  const clock = makeClock(startAt);
  const state: MonetizationState = { ...createInitialMonetizationState(), ...overrides };
  return { d: new MonetizationDirector(DEFAULT_CONFIG, state, clock.now), clock, state };
}

describe('DEFAULT_CONFIG', () => {
  it('has the exact §9 defaults', () => {
    expect(DEFAULT_CONFIG).toStrictEqual({
      gracePeriodGames: 3,
      interstitialCooldownMs: 90_000,
      gameOversPerInterstitial: 2,
      interstitialDailyCap: 20,
      continueMinScore: 500,
      continueBestRatio: 0.5,
      streakRepairsPerWeek: 1,
      dailySecondTriesPerDay: 1,
    });
  });
});

describe('grace period (§9.2: no interstitials in first 3 games ever)', () => {
  it('games 1–3 never show regardless of cadence; game 4 is eligible', () => {
    const { d, clock } = freshDirector();
    const results: boolean[] = [];
    for (let game = 1; game <= 4; game++) {
      clock.advance(600_000); // cooldown is never the limiter here
      d.recordGameOver();
      results.push(d.shouldShowInterstitial(false));
    }
    expect(results).toEqual([false, false, false, true]);
  });

  it('brand-new profile over 8 game overs: F,F,F,T,F,T,F,T', () => {
    const { d, clock } = freshDirector();
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      clock.advance(600_000);
      d.recordGameOver();
      const show = d.shouldShowInterstitial(false);
      results.push(show);
      if (show) d.recordInterstitialShown();
    }
    expect(results).toEqual([false, false, false, true, false, true, false, true]);
  });
});

describe('cadence (§9.2: every 2nd game over)', () => {
  it('after grace, fires on every 2nd game over only: F,T,F,T,F,T,F,T', () => {
    const { d, clock } = freshDirector({ totalGamesCompleted: 3 });
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      clock.advance(100_000); // > 90s, cooldown always satisfied
      d.recordGameOver();
      const show = d.shouldShowInterstitial(false);
      results.push(show);
      if (show) d.recordInterstitialShown();
    }
    expect(results).toEqual([false, true, false, true, false, true, false, true]);
  });

  it('pins counter semantics: recordGameOver increments, shouldShowInterstitial is read-only, recordInterstitialShown resets to 0', () => {
    const { d } = freshDirector({ totalGamesCompleted: 10 });
    expect(d.state.gameOversSinceInterstitial).toBe(0);
    d.recordGameOver();
    expect(d.state.gameOversSinceInterstitial).toBe(1);
    expect(d.shouldShowInterstitial(false)).toBe(false); // count 1 < 2
    d.recordGameOver();
    expect(d.state.gameOversSinceInterstitial).toBe(2);
    expect(d.shouldShowInterstitial(false)).toBe(true); // count >= 2
    // asking twice changes nothing (read-only)
    expect(d.shouldShowInterstitial(false)).toBe(true);
    expect(d.state.gameOversSinceInterstitial).toBe(2);
    d.recordInterstitialShown();
    expect(d.state.gameOversSinceInterstitial).toBe(0);
    expect(d.shouldShowInterstitial(false)).toBe(false);
  });
});

describe('cooldown (§9.2: max 1 per 90 seconds)', () => {
  it('suppresses a due interstitial until >= 90s since last shown; 89_999ms false, 90_000ms true', () => {
    const { d, clock } = freshDirector({ totalGamesCompleted: 5 });
    const t0 = clock.now();
    d.recordInterstitialShown(); // lastInterstitialAt = t0
    clock.set(t0 + 30_000);
    d.recordGameOver();
    expect(d.shouldShowInterstitial(false)).toBe(false); // count 1: cadence not met yet
    clock.set(t0 + 60_000);
    d.recordGameOver();
    expect(d.shouldShowInterstitial(false)).toBe(false); // due by cadence, blocked by cooldown
    clock.set(t0 + 89_999);
    expect(d.shouldShowInterstitial(false)).toBe(false);
    clock.set(t0 + 90_000);
    expect(d.shouldShowInterstitial(false)).toBe(true);
  });
});

describe('daily cap (§9.2: hard cap 20 per local day)', () => {
  it('20 shown today blocks the 21st even when cadence and cooldown pass', () => {
    const today = localDateString(NOON);
    const { d, clock } = freshDirector({
      totalGamesCompleted: 50,
      gameOversSinceInterstitial: 5,
      interstitialDates: Array.from({ length: 20 }, () => today),
      lastInterstitialAt: NOON - 3_600_000, // 1h ago, cooldown satisfied
    });
    expect(d.shouldShowInterstitial(false)).toBe(false);
    // next LOCAL day -> allowed again
    clock.set(new Date(2026, 5, 11, 9, 0, 0).getTime());
    expect(d.shouldShowInterstitial(false)).toBe(true);
  });

  it('19 shown today still allows the 20th (boundary)', () => {
    const today = localDateString(NOON);
    const { d } = freshDirector({
      totalGamesCompleted: 50,
      gameOversSinceInterstitial: 5,
      interstitialDates: Array.from({ length: 19 }, () => today),
      lastInterstitialAt: NOON - 3_600_000,
    });
    expect(d.shouldShowInterstitial(false)).toBe(true);
  });

  it("only TODAY's local-date entries count toward the cap", () => {
    const yesterday = localDateString(new Date(2026, 5, 9, 12, 0, 0).getTime());
    const { d } = freshDirector({
      totalGamesCompleted: 50,
      gameOversSinceInterstitial: 5,
      interstitialDates: Array.from({ length: 20 }, () => yesterday),
      lastInterstitialAt: NOON - 3_600_000,
    });
    expect(d.shouldShowInterstitial(false)).toBe(true);
  });
});

describe('no-double-tax (§9.2: never on the same game over as a rewarded ad)', () => {
  it('rewardedWatchedThisGameOver=true suppresses, but the cadence counter still increments', () => {
    const { d, clock } = freshDirector({ totalGamesCompleted: 5 });
    clock.advance(100_000);
    d.recordGameOver();
    d.recordGameOver();
    expect(d.shouldShowInterstitial(false)).toBe(true); // due
    expect(d.shouldShowInterstitial(true)).toBe(false); // suppressed: player watched rewarded
    expect(d.state.gameOversSinceInterstitial).toBe(2); // counter untouched by the suppression
    d.recordGameOver(); // next game over
    expect(d.state.gameOversSinceInterstitial).toBe(3);
    expect(d.shouldShowInterstitial(false)).toBe(true); // can show again
  });
});

describe('streak repair (§9.3.2: broke yesterday only, max 1 per ISO week)', () => {
  it('offers when streak broke yesterday only and none used this ISO week', () => {
    const { d } = freshDirector();
    expect(d.canOfferStreakRepair(true)).toBe(true);
  });

  it('does not offer when the streak did not break yesterday-only', () => {
    const { d } = freshDirector();
    expect(d.canOfferStreakRepair(false)).toBe(false);
  });

  it('max 1 per ISO week; week rollover re-enables', () => {
    const { d, clock } = freshDirector(); // Wed 2026-06-10 -> 2026-W24
    d.recordStreakRepair();
    expect(d.state.lastStreakRepairWeek).toBe('2026-W24');
    clock.set(new Date(2026, 5, 13, 12, 0, 0).getTime()); // Sat, same ISO week
    expect(d.canOfferStreakRepair(true)).toBe(false);
    clock.set(new Date(2026, 5, 14, 12, 0, 0).getTime()); // Sun, STILL W24 (ISO weeks end Sunday)
    expect(d.canOfferStreakRepair(true)).toBe(false);
    clock.set(new Date(2026, 5, 15, 12, 0, 0).getTime()); // Mon -> 2026-W25
    expect(d.canOfferStreakRepair(true)).toBe(true);
  });
});

describe('isoWeekString (ISO 8601, Thursday-based)', () => {
  it('matches known ISO week values incl. year boundaries', () => {
    expect(isoWeekString(new Date(2026, 5, 10).getTime())).toBe('2026-W24');
    expect(isoWeekString(new Date(2026, 0, 1).getTime())).toBe('2026-W01'); // a Thursday
    expect(isoWeekString(new Date(2025, 11, 29).getTime())).toBe('2026-W01'); // Mon of the week containing Thu 1 Jan
    expect(isoWeekString(new Date(2021, 0, 1).getTime())).toBe('2020-W53'); // Fri -> previous ISO year
    expect(isoWeekString(new Date(2024, 11, 30).getTime())).toBe('2025-W01'); // Mon -> next ISO year
  });
});

describe('localDateString', () => {
  it('formats the LOCAL date as YYYY-MM-DD with zero padding', () => {
    expect(localDateString(new Date(2026, 5, 10, 0, 0, 0).getTime())).toBe('2026-06-10');
    expect(localDateString(new Date(2026, 0, 5, 23, 59, 59).getTime())).toBe('2026-01-05');
  });
});

describe('daily second try (§9.3.3: max 1 per local day)', () => {
  it('once per local day, resets on local-day rollover', () => {
    const { d, clock } = freshDirector();
    expect(d.canOfferDailySecondTry()).toBe(true);
    d.recordDailySecondTry();
    expect(d.state.secondTryDate).toBe('2026-06-10');
    expect(d.canOfferDailySecondTry()).toBe(false);
    clock.set(new Date(2026, 5, 10, 23, 59, 59).getTime());
    expect(d.canOfferDailySecondTry()).toBe(false); // same local day
    clock.set(new Date(2026, 5, 11, 0, 0, 1).getTime());
    expect(d.canOfferDailySecondTry()).toBe(true); // next local day
  });
});

describe('banner (§9.4)', () => {
  it('visible only on the game screen, never in the first session ever', () => {
    const { d } = freshDirector();
    expect(d.bannerVisible('game', false)).toBe(true);
    expect(d.bannerVisible('home', false)).toBe(false);
    expect(d.bannerVisible('pause', false)).toBe(false);
    expect(d.bannerVisible('gameover', false)).toBe(false);
    expect(d.bannerVisible('game', true)).toBe(false); // first session ever
  });
});

describe('decision methods are pure reads', () => {
  it('no decision method mutates state', () => {
    const { d, state } = freshDirector({ totalGamesCompleted: 10, gameOversSinceInterstitial: 2 });
    const before = JSON.stringify(state);
    d.shouldShowInterstitial(false);
    d.shouldShowInterstitial(true);
    d.shouldOfferContinue(600, 1000, false);
    d.canOfferStreakRepair(true);
    d.canOfferDailySecondTry();
    d.bannerVisible('game', false);
    d.grantsAreAdFree();
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('EventLog (§9.6)', () => {
  it('exposes exactly the spec event names', () => {
    expect([...EVENT_NAMES]).toEqual([
      'game_start',
      'game_over',
      'interstitial_shown',
      'interstitial_skipped',
      'rewarded_offered',
      'rewarded_completed',
      'rewarded_dismissed',
      'remove_ads_purchased',
      'daily_played',
    ]);
  });

  it('appends events with the injected clock timestamp and optional data', () => {
    const events: MonetizationEvent[] = [];
    const clock = makeClock(1_000);
    const log = new EventLog((e) => events.push(e), clock.now);
    log.log('game_start');
    clock.set(2_000);
    log.log('game_over', { score: 123, chain_max: 3 });
    expect(events).toStrictEqual([
      { name: 'game_start', t: 1_000 },
      { name: 'game_over', t: 2_000, data: { score: 123, chain_max: 3 } },
    ]);
  });
});

/**
 * §9.7.4 — Remove Ads (spec §9.5): owning the flag suppresses interstitials and
 * the banner, but NEVER the rewarded features (continue / streak repair / second
 * try stay offerable; the UI grants them ad-free — exposed via grantsAreAdFree()).
 * Also: Purchases mock (purchase/cancel/error/restore + injected persistence
 * callback) and MonetizationState JSON round-trip.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/monetization/config';
import {
  MonetizationDirector,
  createInitialMonetizationState,
  type MonetizationState,
} from '../../src/monetization/director';
import { MockPurchases } from '../../src/monetization/purchases';

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

function ownerDirector(overrides: Partial<MonetizationState> = {}) {
  const clock = makeClock(NOON);
  const state: MonetizationState = {
    ...createInitialMonetizationState(),
    removeAdsOwned: true,
    totalGamesCompleted: 10,
    ...overrides,
  };
  return { d: new MonetizationDirector(DEFAULT_CONFIG, state, clock.now), clock, state };
}

describe('Remove Ads suppression matrix (§9.5)', () => {
  it('shouldShowInterstitial is always false, even when every other rule passes', () => {
    const { d, clock } = ownerDirector();
    for (let i = 0; i < 6; i++) {
      clock.advance(600_000); // cooldown satisfied
      d.recordGameOver();
      expect(d.shouldShowInterstitial(false)).toBe(false);
    }
    // counter still accumulated; ONLY removeAdsOwned is the blocker
    expect(d.state.gameOversSinceInterstitial).toBe(6);
  });

  it('banner is suppressed on the game screen', () => {
    const { d } = ownerDirector();
    expect(d.bannerVisible('game', false)).toBe(false);
  });

  it('rewarded features remain offerable (player-positive, not ads-as-tax)', () => {
    const { d } = ownerDirector();
    expect(d.shouldOfferContinue(600, 1000, false)).toBe(true);
    expect(d.canOfferStreakRepair(true)).toBe(true);
    expect(d.canOfferDailySecondTry()).toBe(true);
  });

  it('grantsAreAdFree() mirrors removeAdsOwned', () => {
    expect(ownerDirector().d.grantsAreAdFree()).toBe(true);
    const free = new MonetizationDirector(
      DEFAULT_CONFIG,
      createInitialMonetizationState(),
      () => NOON,
    );
    expect(free.grantsAreAdFree()).toBe(false);
  });

  it('setting the flag on live state (e.g. after a restore) takes effect immediately', () => {
    const clock = makeClock(NOON);
    const state = { ...createInitialMonetizationState(), totalGamesCompleted: 10 };
    const d = new MonetizationDirector(DEFAULT_CONFIG, state, clock.now);
    d.recordGameOver();
    d.recordGameOver();
    expect(d.shouldShowInterstitial(false)).toBe(true);
    d.state.removeAdsOwned = true; // app layer flips it after purchase/restore
    expect(d.shouldShowInterstitial(false)).toBe(false);
    expect(d.grantsAreAdFree()).toBe(true);
  });
});

describe('MonetizationState persistence (JSON round-trip)', () => {
  it('state round-trips through JSON and the restored director behaves identically', () => {
    const clock = makeClock(NOON);
    const state = { ...createInitialMonetizationState(), removeAdsOwned: true };
    const d = new MonetizationDirector(DEFAULT_CONFIG, state, clock.now);
    d.recordGameOver();
    d.recordGameOver();
    d.recordGameOver();
    d.recordInterstitialShown();
    d.recordStreakRepair();
    d.recordDailySecondTry();

    const restored = JSON.parse(JSON.stringify(d.state)) as MonetizationState;
    expect(restored).toStrictEqual({
      totalGamesCompleted: 3,
      gameOversSinceInterstitial: 0,
      lastInterstitialAt: NOON,
      interstitialDates: ['2026-06-10'],
      removeAdsOwned: true,
      lastStreakRepairWeek: '2026-W24',
      secondTryDate: '2026-06-10',
    });

    const d2 = new MonetizationDirector(DEFAULT_CONFIG, restored, clock.now);
    expect(d2.shouldShowInterstitial(false)).toBe(d.shouldShowInterstitial(false));
    expect(d2.canOfferStreakRepair(true)).toBe(d.canOfferStreakRepair(true));
    expect(d2.canOfferDailySecondTry()).toBe(d.canOfferDailySecondTry());
    expect(d2.grantsAreAdFree()).toBe(true);
  });
});

describe('MockPurchases (§9.5)', () => {
  it('successful purchase sets ownership and persists via the injected callback', async () => {
    const saved: string[][] = [];
    const p = new MockPurchases({ purchaseOutcome: 'purchased', onOwnedChange: (o) => saved.push(o) });
    expect(p.isOwned('remove_ads')).toBe(false);
    await expect(p.purchase('remove_ads')).resolves.toBe('purchased');
    expect(p.isOwned('remove_ads')).toBe(true);
    expect(saved).toEqual([['remove_ads']]);
  });

  it("'cancelled' and 'error' outcomes leave ownership untouched", async () => {
    const saved: string[][] = [];
    const p = new MockPurchases({ purchaseOutcome: 'cancelled', onOwnedChange: (o) => saved.push(o) });
    await expect(p.purchase('remove_ads')).resolves.toBe('cancelled');
    expect(p.isOwned('remove_ads')).toBe(false);
    p.setPurchaseOutcome('error');
    await expect(p.purchase('remove_ads')).resolves.toBe('error');
    expect(p.isOwned('remove_ads')).toBe(false);
    expect(saved).toEqual([]); // never persisted anything
  });

  it('restore returns the restored skus and sets ownership (restore path sets the flag)', async () => {
    const saved: string[][] = [];
    const p = new MockPurchases({ restoreSkus: ['remove_ads'], onOwnedChange: (o) => saved.push(o) });
    expect(p.isOwned('remove_ads')).toBe(false);
    await expect(p.restore()).resolves.toEqual(['remove_ads']);
    expect(p.isOwned('remove_ads')).toBe(true);
    expect(saved).toEqual([['remove_ads']]);
  });

  it('restore with nothing to restore resolves to an empty list', async () => {
    const p = new MockPurchases();
    await expect(p.restore()).resolves.toEqual([]);
  });

  it('initially-owned skus are owned from construction', () => {
    const p = new MockPurchases({ owned: ['remove_ads'] });
    expect(p.isOwned('remove_ads')).toBe(true);
    expect(p.isOwned('other_sku')).toBe(false);
  });
});

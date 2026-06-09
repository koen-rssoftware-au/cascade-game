/**
 * §9.7.1/§9.7.3 (unit part) — AdProvider abstraction (spec §9.1).
 * MockAdProvider behaviors, fill simulation, latency, onShow hook, and the
 * SafeAdProvider failure rule: an ad failure must never block the game —
 * provider exceptions map to 'unavailable' (pinned for BOTH interstitial and
 * rewarded).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MockAdProvider,
  SafeAdProvider,
  type AdProvider,
} from '../../src/monetization/adProvider';

describe('MockAdProvider behaviors (§9.1)', () => {
  it("behavior 'reward': interstitial -> 'shown', rewarded -> 'rewarded'", async () => {
    const p = new MockAdProvider({ behavior: 'reward' });
    await expect(p.showInterstitial()).resolves.toBe('shown');
    await expect(p.showRewarded()).resolves.toBe('rewarded');
  });

  it("behavior 'dismiss': interstitial -> 'skipped', rewarded -> 'dismissed'", async () => {
    const p = new MockAdProvider({ behavior: 'dismiss' });
    await expect(p.showInterstitial()).resolves.toBe('skipped');
    await expect(p.showRewarded()).resolves.toBe('dismissed');
  });

  it("behavior 'unavailable': both -> 'unavailable'", async () => {
    const p = new MockAdProvider({ behavior: 'unavailable' });
    await expect(p.showInterstitial()).resolves.toBe('unavailable');
    await expect(p.showRewarded()).resolves.toBe('unavailable');
  });

  it("behavior 'throw': both REJECT (provider exception is catchable by callers)", async () => {
    const p = new MockAdProvider({ behavior: 'throw' });
    await expect(p.showInterstitial()).rejects.toThrow();
    await expect(p.showRewarded()).rejects.toThrow();
  });

  it('setBehavior switches behavior at runtime', async () => {
    const p = new MockAdProvider({ behavior: 'reward' });
    await expect(p.showRewarded()).resolves.toBe('rewarded');
    p.setBehavior('dismiss');
    await expect(p.showRewarded()).resolves.toBe('dismissed');
    p.setBehavior('unavailable');
    await expect(p.showRewarded()).resolves.toBe('unavailable');
    p.setBehavior('throw');
    await expect(p.showRewarded()).rejects.toThrow();
  });

  it('defaults to rewarding with zero latency and ready for every kind', async () => {
    const p = new MockAdProvider();
    expect(p.isReady('interstitial')).toBe(true);
    expect(p.isReady('rewarded')).toBe(true);
    expect(p.isReady('banner')).toBe(true);
    await expect(p.showRewarded()).resolves.toBe('rewarded');
  });
});

describe('MockAdProvider fill simulation', () => {
  it('boolean fillRate pins readiness per kind', () => {
    const p = new MockAdProvider({ fillRate: { interstitial: false, rewarded: true } });
    expect(p.isReady('interstitial')).toBe(false);
    expect(p.isReady('rewarded')).toBe(true);
    expect(p.isReady('banner')).toBe(true); // unspecified -> ready
  });

  it('fractional fillRate draws against the injected random source', () => {
    let roll = 0;
    const p = new MockAdProvider({ fillRate: { rewarded: 0.5 }, random: () => roll });
    roll = 0.49;
    expect(p.isReady('rewarded')).toBe(true); // 0.49 < 0.5
    roll = 0.5;
    expect(p.isReady('rewarded')).toBe(false); // 0.5 < 0.5 is false
    const always = new MockAdProvider({ fillRate: { interstitial: 1 }, random: () => 0.999 });
    expect(always.isReady('interstitial')).toBe(true);
    const never = new MockAdProvider({ fillRate: { interstitial: 0 }, random: () => 0 });
    expect(never.isReady('interstitial')).toBe(false);
  });
});

describe('MockAdProvider latency + onShow hook (fake 2s placeholder support)', () => {
  it('onShow fires with the kind so the UI can render the placeholder', async () => {
    const kinds: string[] = [];
    const p = new MockAdProvider({ onShow: (k) => kinds.push(k) });
    await p.showInterstitial();
    await p.showRewarded();
    expect(kinds).toEqual(['interstitial', 'rewarded']);
  });

  it('resolves only after the configured latency', async () => {
    vi.useFakeTimers();
    try {
      const p = new MockAdProvider({ latencyMs: 2_000 });
      let resolved: string | null = null;
      const promise = p.showRewarded().then((r) => {
        resolved = r;
      });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(resolved).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await promise;
      expect(resolved).toBe('rewarded');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MockAdProvider banner state', () => {
  it('setBannerVisible records visibility', () => {
    const p = new MockAdProvider();
    expect(p.bannerVisible).toBe(false);
    p.setBannerVisible(true);
    expect(p.bannerVisible).toBe(true);
    p.setBannerVisible(false);
    expect(p.bannerVisible).toBe(false);
  });
});

describe('SafeAdProvider (failure rule §9.1: ad failure never blocks the game)', () => {
  it("maps a rewarded rejection to 'unavailable'", async () => {
    const safe = new SafeAdProvider(new MockAdProvider({ behavior: 'throw' }));
    await expect(safe.showRewarded()).resolves.toBe('unavailable');
  });

  it("maps an interstitial rejection to 'unavailable' (pinned)", async () => {
    const safe = new SafeAdProvider(new MockAdProvider({ behavior: 'throw' }));
    await expect(safe.showInterstitial()).resolves.toBe('unavailable');
  });

  it('passes successful resolutions through unchanged', async () => {
    const inner = new MockAdProvider({ behavior: 'reward' });
    const safe = new SafeAdProvider(inner);
    await expect(safe.showInterstitial()).resolves.toBe('shown');
    await expect(safe.showRewarded()).resolves.toBe('rewarded');
    inner.setBehavior('dismiss');
    await expect(safe.showInterstitial()).resolves.toBe('skipped');
    await expect(safe.showRewarded()).resolves.toBe('dismissed');
  });

  it('a throwing isReady reads as not-ready; setBannerVisible never throws', () => {
    const hostile: AdProvider = {
      isReady: () => {
        throw new Error('provider exploded');
      },
      showInterstitial: () => Promise.reject(new Error('boom')),
      showRewarded: () => Promise.reject(new Error('boom')),
      setBannerVisible: () => {
        throw new Error('boom');
      },
    };
    const safe = new SafeAdProvider(hostile);
    expect(safe.isReady('interstitial')).toBe(false);
    expect(safe.isReady('rewarded')).toBe(false);
    expect(safe.isReady('banner')).toBe(false);
    expect(() => safe.setBannerVisible(true)).not.toThrow();
  });
});

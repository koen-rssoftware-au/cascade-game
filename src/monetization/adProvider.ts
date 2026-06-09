/**
 * Ad provider abstraction (spec §9.1) — injected like the RNG.
 * v1 ships MockAdProvider; v1.1 swaps in a real mediation SDK with zero changes
 * to game code. The renderer never decides; the MonetizationDirector does.
 */

/** Spec §9.1 — verbatim. */
export interface AdProvider {
  isReady(kind: 'interstitial' | 'rewarded' | 'banner'): boolean;
  showInterstitial(): Promise<'shown' | 'skipped' | 'unavailable'>;
  showRewarded(): Promise<'rewarded' | 'dismissed' | 'unavailable'>;
  setBannerVisible(visible: boolean): void;
}

export type AdKind = 'interstitial' | 'rewarded' | 'banner';
export type InterstitialResult = 'shown' | 'skipped' | 'unavailable';
export type RewardedResult = 'rewarded' | 'dismissed' | 'unavailable';

/** How the mock resolves show calls. */
export type MockAdBehavior = 'reward' | 'dismiss' | 'unavailable' | 'throw';

export interface MockAdProviderOptions {
  /**
   * Per-kind fill: boolean pins isReady; a number in [0,1) is a fill
   * probability drawn against `random`. Unspecified kinds are always ready.
   */
  fillRate?: Partial<Record<AdKind, number | boolean>>;
  /** Resolution behavior for show calls. Default: 'reward'. */
  behavior?: MockAdBehavior;
  /** Simulated network/SDK latency before resolution. Default: 0. */
  latencyMs?: number;
  /** UI hook: fires when a show starts so a fake placeholder can render. */
  onShow?: (kind: 'interstitial' | 'rewarded') => void;
  /** Random source for fractional fillRate. Default: Math.random. */
  random?: () => number;
}

export class MockAdProvider implements AdProvider {
  private behavior: MockAdBehavior;
  private readonly fillRate: Partial<Record<AdKind, number | boolean>>;
  private readonly latencyMs: number;
  private readonly onShow: ((kind: 'interstitial' | 'rewarded') => void) | undefined;
  private readonly random: () => number;
  private banner = false;

  constructor(options: MockAdProviderOptions = {}) {
    this.behavior = options.behavior ?? 'reward';
    this.fillRate = options.fillRate ?? {};
    this.latencyMs = options.latencyMs ?? 0;
    this.onShow = options.onShow;
    this.random = options.random ?? Math.random;
  }

  setBehavior(behavior: MockAdBehavior): void {
    this.behavior = behavior;
  }

  /** Current mock banner visibility (for tests/debug UI). */
  get bannerVisible(): boolean {
    return this.banner;
  }

  isReady(kind: AdKind): boolean {
    const rate = this.fillRate[kind];
    if (rate === undefined) return true;
    if (typeof rate === 'boolean') return rate;
    return this.random() < rate;
  }

  async showInterstitial(): Promise<InterstitialResult> {
    this.onShow?.('interstitial');
    await this.delay();
    switch (this.behavior) {
      case 'reward':
        return 'shown';
      case 'dismiss':
        return 'skipped';
      case 'unavailable':
        return 'unavailable';
      case 'throw':
        throw new Error('MockAdProvider: simulated interstitial provider failure');
    }
  }

  async showRewarded(): Promise<RewardedResult> {
    this.onShow?.('rewarded');
    await this.delay();
    switch (this.behavior) {
      case 'reward':
        return 'rewarded';
      case 'dismiss':
        return 'dismissed';
      case 'unavailable':
        return 'unavailable';
      case 'throw':
        throw new Error('MockAdProvider: simulated rewarded provider failure');
    }
  }

  setBannerVisible(visible: boolean): void {
    this.banner = visible;
  }

  private async delay(): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.latencyMs));
    }
  }
}

/**
 * Failure rule (spec §9.1): an ad failure must never block, soft-lock, or
 * punish the player. SafeAdProvider wraps any provider and converts thrown
 * exceptions / rejections into benign results — 'unavailable' for BOTH
 * interstitial and rewarded (pinned), false for isReady, no-op for the banner.
 */
export class SafeAdProvider implements AdProvider {
  constructor(private readonly inner: AdProvider) {}

  isReady(kind: AdKind): boolean {
    try {
      return this.inner.isReady(kind);
    } catch {
      return false;
    }
  }

  async showInterstitial(): Promise<InterstitialResult> {
    try {
      return await this.inner.showInterstitial();
    } catch {
      return 'unavailable';
    }
  }

  async showRewarded(): Promise<RewardedResult> {
    try {
      return await this.inner.showRewarded();
    } catch {
      return 'unavailable';
    }
  }

  setBannerVisible(visible: boolean): void {
    try {
      this.inner.setBannerVisible(visible);
    } catch {
      // ad failure never blocks the game
    }
  }
}

/**
 * MonetizationDirector (spec §9.2–§9.5) — pure decision module.
 * Consumes game events, emits ad decisions; the renderer only obeys.
 * Time flows exclusively through the injected now() (epoch ms). Decision
 * methods are read-only; only the record*() methods mutate state.
 */
import type { MonetizationConfig } from './config';

export interface MonetizationState {
  totalGamesCompleted: number;
  gameOversSinceInterstitial: number;
  lastInterstitialAt: number | null;
  interstitialDates: string[]; // 'YYYY-MM-DD' (local) per shown interstitial, for the daily cap
  removeAdsOwned: boolean;
  lastStreakRepairWeek: string | null; // ISO week 'YYYY-Www'
  secondTryDate: string | null; // 'YYYY-MM-DD' (local)
}

export function createInitialMonetizationState(): MonetizationState {
  return {
    totalGamesCompleted: 0,
    gameOversSinceInterstitial: 0,
    lastInterstitialAt: null,
    interstitialDates: [],
    removeAdsOwned: false,
    lastStreakRepairWeek: null,
    secondTryDate: null,
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** LOCAL calendar date of an epoch-ms timestamp, as 'YYYY-MM-DD'. */
export function localDateString(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * ISO 8601 week of the LOCAL date of an epoch-ms timestamp, as 'YYYY-Www'.
 * Thursday-based: a week belongs to the year containing its Thursday, so the
 * ISO year can differ from the calendar year around 1 January.
 */
export function isoWeekString(epochMs: number): string {
  const local = new Date(epochMs);
  // Re-anchor the local Y/M/D in UTC so day arithmetic is immune to DST.
  const d = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
  const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Mon=1 .. Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - isoDay); // shift to this week's Thursday
  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${pad2(week)}`;
}

export class MonetizationDirector {
  constructor(
    private readonly cfg: MonetizationConfig,
    private readonly st: MonetizationState,
    private readonly now: () => number,
  ) {}

  /**
   * §9.2 — all interstitial rules. Read-only. True iff:
   * Remove Ads not owned, no rewarded ad watched this game over (no double-tax),
   * past the grace period, gameOversSinceInterstitial >= cadence, cooldown
   * elapsed, and under the local-day cap.
   */
  shouldShowInterstitial(rewardedWatchedThisGameOver: boolean): boolean {
    if (this.st.removeAdsOwned) return false;
    if (rewardedWatchedThisGameOver) return false;
    if (this.st.totalGamesCompleted <= this.cfg.gracePeriodGames) return false;
    if (this.st.gameOversSinceInterstitial < this.cfg.gameOversPerInterstitial) return false;
    const t = this.now();
    if (
      this.st.lastInterstitialAt !== null &&
      t - this.st.lastInterstitialAt < this.cfg.interstitialCooldownMs
    ) {
      return false;
    }
    const today = localDateString(t);
    const shownToday = this.st.interstitialDates.filter((date) => date === today).length;
    if (shownToday >= this.cfg.interstitialDailyCap) return false;
    return true;
  }

  /** Call on every game over, BEFORE asking shouldShowInterstitial(). */
  recordGameOver(): void {
    this.st.totalGamesCompleted += 1;
    this.st.gameOversSinceInterstitial += 1;
  }

  /** Call after an interstitial actually showed; resets the cadence counter. */
  recordInterstitialShown(): void {
    const t = this.now();
    const today = localDateString(t);
    this.st.gameOversSinceInterstitial = 0;
    this.st.lastInterstitialAt = t;
    // Prune stale days so the array stays bounded (only today matters for the cap).
    this.st.interstitialDates = this.st.interstitialDates.filter((date) => date === today);
    this.st.interstitialDates.push(today);
  }

  /**
   * §9.3.1 — continue offer: score >= floor AND score >= ratio × best AND not
   * already used this run. NOT suppressed by Remove Ads (owners get it ad-free).
   */
  shouldOfferContinue(score: number, best: number, continueUsedThisRun: boolean): boolean {
    if (continueUsedThisRun) return false;
    return score >= this.cfg.continueMinScore && score >= this.cfg.continueBestRatio * best;
  }

  /** §9.3.2 — streak repair: broke yesterday only, max 1 per ISO week. */
  canOfferStreakRepair(streakBrokeYesterdayOnly: boolean): boolean {
    if (!streakBrokeYesterdayOnly) return false;
    if (this.cfg.streakRepairsPerWeek <= 0) return false;
    return this.st.lastStreakRepairWeek !== isoWeekString(this.now());
  }

  recordStreakRepair(): void {
    this.st.lastStreakRepairWeek = isoWeekString(this.now());
  }

  /** §9.3.3 — daily second try: max 1 per local calendar day. */
  canOfferDailySecondTry(): boolean {
    if (this.cfg.dailySecondTriesPerDay <= 0) return false;
    return this.st.secondTryDate !== localDateString(this.now());
  }

  recordDailySecondTry(): void {
    this.st.secondTryDate = localDateString(this.now());
  }

  /** §9.4 — banner: game screen only, never first session, never for owners. */
  bannerVisible(screen: 'home' | 'game' | 'pause' | 'gameover', isFirstSessionEver: boolean): boolean {
    return screen === 'game' && !isFirstSessionEver && !this.st.removeAdsOwned;
  }

  /**
   * §9.5 — Remove Ads owners keep all rewarded features; the UI must grant
   * them WITHOUT showing an ad when this returns true.
   */
  grantsAreAdFree(): boolean {
    return this.st.removeAdsOwned;
  }

  /** §9.5 — flips ownership after a successful purchase or restore. */
  setRemoveAdsOwned(owned: boolean): void {
    this.st.removeAdsOwned = owned;
  }

  /** Live state object, for persistence (JSON-serializable by construction). */
  get state(): MonetizationState {
    return this.st;
  }
}

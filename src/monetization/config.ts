/**
 * MonetizationConfig — all frequency/eligibility constants in one object
 * (spec §9.2/§9.6: locally configurable defaults, editable via the debug panel).
 */
export interface MonetizationConfig {
  gracePeriodGames: number; // 3 — no interstitials in the first N games ever
  interstitialCooldownMs: number; // 90_000 — max 1 interstitial per 90s
  gameOversPerInterstitial: number; // 2 — show on every 2nd game over
  interstitialDailyCap: number; // 20 — hard cap per local day per device
  continueMinScore: number; // 500 — continue offer floor
  continueBestRatio: number; // 0.5 — continue requires score >= ratio × best
  streakRepairsPerWeek: number; // 1 — max streak repairs per ISO week
  dailySecondTriesPerDay: number; // 1 — max daily-challenge second tries per local day
}

export const DEFAULT_CONFIG: MonetizationConfig = {
  gracePeriodGames: 3,
  interstitialCooldownMs: 90_000,
  gameOversPerInterstitial: 2,
  interstitialDailyCap: 20,
  continueMinScore: 500,
  continueBestRatio: 0.5,
  streakRepairsPerWeek: 1,
  dailySecondTriesPerDay: 1,
};

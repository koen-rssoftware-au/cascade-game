// Daily challenge date/seed/streak logic (spec §4.2, §9.3.2-3).
// All date math is LOCAL time; `today` is injectable for tests via the clock param.

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`; // YYYYMMDD
}

export function previousDateKey(key: string): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() - 1);
  return dateKey(d);
}

export function parseDateKey(key: string): Date {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(4, 6)) - 1;
  const day = Number(key.slice(6, 8));
  return new Date(y, m, day);
}

export interface DailyData {
  streak: number;
  lastPlayedDate: string | null; // YYYYMMDD
  bestByDate: Record<string, number>;
  secondTryUsedDate: string | null;
}

export const EMPTY_DAILY: DailyData = {
  streak: 0,
  lastPlayedDate: null,
  bestByDate: {},
  secondTryUsedDate: null,
};

/** Current displayable streak. A streak survives until a full day has been skipped. */
export function currentStreak(data: DailyData, todayKey: string): number {
  if (data.lastPlayedDate === null) return 0;
  if (data.lastPlayedDate === todayKey) return data.streak;
  if (data.lastPlayedDate === previousDateKey(todayKey)) return data.streak; // play today to extend
  return 0; // broken
}

/** True iff the streak broke exactly yesterday (missed exactly one day) — repair window (§9.3.2). */
export function streakBrokeYesterdayOnly(data: DailyData, todayKey: string): boolean {
  if (data.lastPlayedDate === null || data.streak === 0) return false;
  return data.lastPlayedDate === previousDateKey(previousDateKey(todayKey));
}

/** Record a finished daily run. Returns updated data. Streak = played, not won (§4.2). */
export function recordDailyPlayed(data: DailyData, todayKey: string, score: number): DailyData {
  const best = Math.max(data.bestByDate[todayKey] ?? 0, score);
  let streak: number;
  if (data.lastPlayedDate === todayKey) {
    streak = data.streak; // already counted today
  } else if (data.lastPlayedDate === previousDateKey(todayKey)) {
    streak = data.streak + 1;
  } else {
    streak = 1;
  }
  return {
    ...data,
    streak,
    lastPlayedDate: todayKey,
    bestByDate: { ...data.bestByDate, [todayKey]: best },
  };
}

/** Apply a watched streak-repair ad: restore as if yesterday was played (§9.3.2). */
export function applyStreakRepair(data: DailyData, todayKey: string): DailyData {
  return { ...data, lastPlayedDate: previousDateKey(todayKey) };
}

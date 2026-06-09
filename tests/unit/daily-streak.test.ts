// Unit tests for src/app/daily.ts — pure date/streak functions (spec §4.2, §9.3.2).
// All date keys are YYYYMMDD in LOCAL time; no Date.now() anywhere in these tests.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_DAILY,
  applyStreakRepair,
  currentStreak,
  dateKey,
  parseDateKey,
  previousDateKey,
  recordDailyPlayed,
  streakBrokeYesterdayOnly,
  type DailyData,
} from '../../src/app/daily';

const TODAY = '20260610';

function daily(overrides: Partial<DailyData> = {}): DailyData {
  return { ...EMPTY_DAILY, bestByDate: {}, ...overrides };
}

describe('recordDailyPlayed (§4.2: streak = played, not won)', () => {
  it('first daily ever starts the streak at 1 and records the score', () => {
    const next = recordDailyPlayed(EMPTY_DAILY, TODAY, 140);
    expect(next.streak).toBe(1);
    expect(next.lastPlayedDate).toBe(TODAY);
    expect(next.bestByDate[TODAY]).toBe(140);
    // input untouched (pure function)
    expect(EMPTY_DAILY.streak).toBe(0);
    expect(EMPTY_DAILY.lastPlayedDate).toBeNull();
  });

  it('playing on consecutive days increments the streak', () => {
    const data = daily({ streak: 3, lastPlayedDate: '20260609' });
    const next = recordDailyPlayed(data, TODAY, 50);
    expect(next.streak).toBe(4);
    expect(next.lastPlayedDate).toBe(TODAY);
  });

  it('same-day replay leaves the streak unchanged and best takes the max of both scores', () => {
    const first = recordDailyPlayed(daily({ streak: 1, lastPlayedDate: '20260609' }), TODAY, 150);
    expect(first.streak).toBe(2);
    // lower second score: best stays
    const lower = recordDailyPlayed(first, TODAY, 120);
    expect(lower.streak).toBe(2);
    expect(lower.bestByDate[TODAY]).toBe(150);
    // higher second score: best raises
    const higher = recordDailyPlayed(first, TODAY, 220);
    expect(higher.streak).toBe(2);
    expect(higher.bestByDate[TODAY]).toBe(220);
  });

  it('a gap of one or more missed days resets the streak to 1', () => {
    const oneMissed = recordDailyPlayed(daily({ streak: 5, lastPlayedDate: '20260608' }), TODAY, 10);
    expect(oneMissed.streak).toBe(1);
    const manyMissed = recordDailyPlayed(daily({ streak: 9, lastPlayedDate: '20260520' }), TODAY, 10);
    expect(manyMissed.streak).toBe(1);
  });
});

describe('currentStreak (streak survives until a full day is skipped)', () => {
  it('played today → full streak', () => {
    expect(currentStreak(daily({ streak: 4, lastPlayedDate: TODAY }), TODAY)).toBe(4);
  });

  it('played yesterday → streak still alive, pending today', () => {
    expect(currentStreak(daily({ streak: 4, lastPlayedDate: '20260609' }), TODAY)).toBe(4);
  });

  it('missed a full day → broken, shows 0', () => {
    expect(currentStreak(daily({ streak: 4, lastPlayedDate: '20260608' }), TODAY)).toBe(0);
  });

  it('never played → 0', () => {
    expect(currentStreak(EMPTY_DAILY, TODAY)).toBe(0);
  });
});

describe('streakBrokeYesterdayOnly (§9.3.2 repair window)', () => {
  it('true exactly when lastPlayedDate is the day before yesterday', () => {
    expect(streakBrokeYesterdayOnly(daily({ streak: 6, lastPlayedDate: '20260608' }), TODAY)).toBe(true);
  });

  it('false when the streak is still alive (yesterday)', () => {
    expect(streakBrokeYesterdayOnly(daily({ streak: 6, lastPlayedDate: '20260609' }), TODAY)).toBe(false);
  });

  it('false when broken more than one day ago (today-3)', () => {
    expect(streakBrokeYesterdayOnly(daily({ streak: 6, lastPlayedDate: '20260607' }), TODAY)).toBe(false);
  });

  it('false when never played or no streak to repair', () => {
    expect(streakBrokeYesterdayOnly(EMPTY_DAILY, TODAY)).toBe(false);
    expect(streakBrokeYesterdayOnly(daily({ streak: 0, lastPlayedDate: '20260608' }), TODAY)).toBe(false);
  });
});

describe('applyStreakRepair (§9.3.2)', () => {
  it('rewrites lastPlayedDate to yesterday so playing today extends the old streak', () => {
    const broken = daily({ streak: 6, lastPlayedDate: '20260608' });
    const repaired = applyStreakRepair(broken, TODAY);
    expect(repaired.lastPlayedDate).toBe('20260609');
    expect(repaired.streak).toBe(6); // streak value itself untouched
    // playing today now counts as consecutive → 7
    expect(recordDailyPlayed(repaired, TODAY, 1).streak).toBe(7);
    // and the displayable streak is alive again immediately
    expect(currentStreak(repaired, TODAY)).toBe(6);
  });
});

describe('dateKey / previousDateKey', () => {
  it('roundtrips through parseDateKey', () => {
    for (const key of ['20260610', '20260101', '20251231', '20240229']) {
      expect(dateKey(parseDateKey(key))).toBe(key);
    }
  });

  it('formats with zero padding', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('20260105');
  });

  it('handles month boundaries', () => {
    expect(previousDateKey('20260301')).toBe('20260228'); // 2026 is not a leap year
    expect(previousDateKey('20240301')).toBe('20240229'); // 2024 is
    expect(previousDateKey('20260401')).toBe('20260331');
  });

  it('handles the year boundary', () => {
    expect(previousDateKey('20260101')).toBe('20251231');
  });
});

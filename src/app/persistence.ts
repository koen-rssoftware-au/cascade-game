// Typed persistence for everything that must survive refresh/kill (spec §6).
import type { Storage } from './storage';
import { type DailyData, EMPTY_DAILY } from './daily';
import type { MonetizationState } from '../monetization/director';

const KEYS = {
  run: 'cascade:run.v1',
  settings: 'cascade:settings.v1',
  stats: 'cascade:stats.v1',
  daily: 'cascade:daily.v1',
  monetization: 'cascade:monetization.v1',
  events: 'cascade:events.v1',
} as const;

export interface Settings {
  sound: boolean;
  haptics: boolean;
}
export interface Stats {
  best: number;
  maxChainEver: number;
  tutorialDone: boolean;
  firstSessionAt: number | null; // epoch ms of very first launch
}

const DEFAULT_SETTINGS: Settings = { sound: true, haptics: true };
const DEFAULT_STATS: Stats = { best: 0, maxChainEver: 0, tutorialDone: false, firstSessionAt: null };

function readJson<T>(storage: Storage, key: string, fallback: T): T {
  const raw = storage.get(key);
  if (raw === null) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

export class Persistence {
  constructor(private storage: Storage) {}

  // --- in-progress run (serialized engine state + run metadata) ---
  saveRun(serialized: string): void {
    this.storage.set(KEYS.run, serialized);
  }
  loadRun(): string | null {
    return this.storage.get(KEYS.run);
  }
  clearRun(): void {
    this.storage.remove(KEYS.run);
  }

  loadSettings(): Settings {
    return readJson(this.storage, KEYS.settings, DEFAULT_SETTINGS);
  }
  saveSettings(s: Settings): void {
    this.storage.set(KEYS.settings, JSON.stringify(s));
  }

  loadStats(): Stats {
    return readJson(this.storage, KEYS.stats, DEFAULT_STATS);
  }
  saveStats(s: Stats): void {
    this.storage.set(KEYS.stats, JSON.stringify(s));
  }

  loadDaily(): DailyData {
    return readJson(this.storage, KEYS.daily, EMPTY_DAILY);
  }
  saveDaily(d: DailyData): void {
    this.storage.set(KEYS.daily, JSON.stringify(d));
  }

  loadMonetization(): MonetizationState | null {
    const raw = this.storage.get(KEYS.monetization);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as MonetizationState;
    } catch {
      return null;
    }
  }
  saveMonetization(m: MonetizationState): void {
    this.storage.set(KEYS.monetization, JSON.stringify(m));
  }

  appendEvent(event: { name: string; t: number; data?: Record<string, unknown> }): void {
    // Minimal local event log (§9.6) — capped so it can never grow unbounded.
    try {
      const raw = this.storage.get(KEYS.events);
      const list = raw !== null ? (JSON.parse(raw) as unknown[]) : [];
      list.push(event);
      if (list.length > 500) list.splice(0, list.length - 500);
      this.storage.set(KEYS.events, JSON.stringify(list));
    } catch {
      /* logging must never crash the game */
    }
  }

  /** Reset data (§4.4) — removes every cascade key. */
  resetAll(): void {
    for (const key of Object.values(KEYS)) this.storage.remove(key);
  }
}

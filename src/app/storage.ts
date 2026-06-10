// Storage abstraction (spec §1.1) so Capacitor native storage can be swapped in later.
export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export class LocalStorageImpl implements Storage {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Quota or private-mode failure must never crash the game (spec §6).
    }
  }
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  keys(): string[] {
    try {
      const out: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k !== null) out.push(k);
      }
      return out;
    } catch {
      return [];
    }
  }
}

/**
 * Native storage: synchronous reads/writes against an in-memory cache that is
 * hydrated once at boot from Capacitor Preferences and written through
 * asynchronously. WKWebView localStorage can be evicted by the OS; Preferences
 * (UserDefaults/SharedPreferences) is the durable store the spec's kill-proof
 * guarantees need on device.
 */
export class HydratedNativeStorage implements Storage {
  private cache = new Map<string, string>();
  private constructor(
    private prefs: {
      set(o: { key: string; value: string }): Promise<void>;
      remove(o: { key: string }): Promise<void>;
    },
  ) {}

  static async create(): Promise<HydratedNativeStorage> {
    const { Preferences } = await import('@capacitor/preferences');
    const storage = new HydratedNativeStorage(Preferences);
    const { keys } = await Preferences.keys();
    for (const key of keys) {
      const { value } = await Preferences.get({ key });
      if (value !== null) storage.cache.set(key, value);
    }
    return storage;
  }

  get(key: string): string | null {
    return this.cache.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.cache.set(key, value);
    void this.prefs.set({ key, value }).catch(() => {
      /* a failed flush must never crash the game; the cache stays authoritative */
    });
  }
  remove(key: string): void {
    this.cache.delete(key);
    void this.prefs.remove({ key }).catch(() => {
      /* ignore */
    });
  }
  keys(): string[] {
    return [...this.cache.keys()];
  }
}

export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

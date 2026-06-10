// Guarded haptics (spec §3.2). On the web this uses navigator.vibrate (a no-op
// on iOS Safari); in the native Capacitor shell it upgrades to real Taptic/
// vibrator impacts — the first time iPhone players get haptics at all.
type NativeHaptics = {
  impact(o: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }): Promise<void>;
  notification(o: { type: 'SUCCESS' | 'WARNING' | 'ERROR' }): Promise<void>;
};

export class Haptics {
  enabled = true;
  private native: NativeHaptics | null = null;

  /** Call once at boot on native platforms; web silently keeps the vibrate path. */
  async useNative(): Promise<void> {
    try {
      const mod = await import('@capacitor/haptics');
      this.native = {
        impact: (o) => mod.Haptics.impact({ style: mod.ImpactStyle[o.style === 'LIGHT' ? 'Light' : o.style === 'MEDIUM' ? 'Medium' : 'Heavy'] }),
        notification: (o) =>
          mod.Haptics.notification({
            type: mod.NotificationType[o.type === 'SUCCESS' ? 'Success' : o.type === 'WARNING' ? 'Warning' : 'Error'],
          }),
      };
    } catch {
      this.native = null; // plugin unavailable → web fallback
    }
  }

  private vibrate(pattern: number | number[]): void {
    if (!this.enabled) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      /* never crash on haptics */
    }
  }

  placement(): void {
    if (!this.enabled) return;
    if (this.native) {
      void this.native.impact({ style: 'LIGHT' }).catch(() => {});
      return;
    }
    this.vibrate(10);
  }

  clear(): void {
    if (!this.enabled) return;
    if (this.native) {
      void this.native.impact({ style: 'MEDIUM' }).catch(() => {});
      return;
    }
    this.vibrate(30);
  }

  /** Escalating pattern per cascade chain step (spec §3.2). */
  cascade(chainStep: number): void {
    if (!this.enabled) return;
    if (this.native) {
      void (chainStep >= 3
        ? this.native.notification({ type: 'SUCCESS' })
        : this.native.impact({ style: 'HEAVY' })
      ).catch(() => {});
      return;
    }
    const n = Math.min(chainStep, 6);
    const pattern: number[] = [];
    for (let i = 0; i < n; i++) pattern.push(20 + i * 12, 40);
    this.vibrate(pattern);
  }
}

// Guarded vibration (spec §3.2). iOS Safari has no navigator.vibrate — all calls are no-ops there.
export class Haptics {
  enabled = true;

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
    this.vibrate(10);
  }

  clear(): void {
    this.vibrate(30);
  }

  /** Escalating pattern per cascade chain step (spec §3.2). */
  cascade(chainStep: number): void {
    const n = Math.min(chainStep, 6);
    const pattern: number[] = [];
    for (let i = 0; i < n; i++) pattern.push(20 + i * 12, 40);
    this.vibrate(pattern);
  }
}

/**
 * Purchases abstraction (spec §9.5) — mock in v1, StoreKit/Play Billing via
 * Capacitor in v1.1. Ownership persistence is delegated to an injected setter
 * callback so the app layer owns the storage format.
 */
export type PurchaseOutcome = 'purchased' | 'cancelled' | 'error';

export interface Purchases {
  isOwned(sku: string): boolean;
  purchase(sku: string): Promise<'purchased' | 'cancelled' | 'error'>;
  restore(): Promise<string[]>;
}

export interface MockPurchasesOptions {
  /** SKUs owned from construction (e.g. loaded from persisted state). */
  owned?: readonly string[];
  /** Outcome every purchase() resolves to. Default: 'purchased'. */
  purchaseOutcome?: PurchaseOutcome;
  /** SKUs the simulated store remembers for restore(). Default: none. */
  restoreSkus?: readonly string[];
  /** Persistence hook: called with the full owned-SKU list on every change. */
  onOwnedChange?: (owned: string[]) => void;
}

export class MockPurchases implements Purchases {
  private readonly owned: Set<string>;
  private outcome: PurchaseOutcome;
  private readonly restoreSkus: readonly string[];
  private readonly onOwnedChange: ((owned: string[]) => void) | undefined;

  constructor(options: MockPurchasesOptions = {}) {
    this.owned = new Set(options.owned ?? []);
    this.outcome = options.purchaseOutcome ?? 'purchased';
    this.restoreSkus = options.restoreSkus ?? [];
    this.onOwnedChange = options.onOwnedChange;
  }

  setPurchaseOutcome(outcome: PurchaseOutcome): void {
    this.outcome = outcome;
  }

  isOwned(sku: string): boolean {
    return this.owned.has(sku);
  }

  async purchase(sku: string): Promise<'purchased' | 'cancelled' | 'error'> {
    if (this.outcome === 'purchased' && !this.owned.has(sku)) {
      this.owned.add(sku);
      this.persist();
    }
    return this.outcome;
  }

  async restore(): Promise<string[]> {
    const restored = [...this.restoreSkus];
    let changed = false;
    for (const sku of restored) {
      if (!this.owned.has(sku)) {
        this.owned.add(sku);
        changed = true;
      }
    }
    if (changed) this.persist();
    return restored;
  }

  private persist(): void {
    this.onOwnedChange?.([...this.owned].sort());
  }
}

/**
 * Minimal local event log (spec §9.6). Append-only via an injected sink so the
 * app layer decides where events land (Storage in v1, analytics SDK in v1.1).
 * No PII, no device fingerprinting.
 */
export type MonetizationEventName =
  | 'game_start'
  | 'game_over'
  | 'interstitial_shown'
  | 'interstitial_skipped'
  | 'rewarded_offered'
  | 'rewarded_completed'
  | 'rewarded_dismissed'
  | 'remove_ads_purchased'
  | 'daily_played';

/** Exactly the spec §9.6 event set, in spec order. */
export const EVENT_NAMES: readonly MonetizationEventName[] = [
  'game_start',
  'game_over',
  'interstitial_shown',
  'interstitial_skipped',
  'rewarded_offered',
  'rewarded_completed',
  'rewarded_dismissed',
  'remove_ads_purchased',
  'daily_played',
];

export interface MonetizationEvent {
  name: string;
  t: number; // epoch ms from the injected clock
  data?: Record<string, unknown>;
}

export type EventSink = (event: MonetizationEvent) => void;

export class EventLog {
  constructor(
    private readonly append: EventSink,
    private readonly now: () => number,
  ) {}

  log(name: MonetizationEventName, data?: Record<string, unknown>): void {
    this.append(data === undefined ? { name, t: this.now() } : { name, t: this.now(), data });
  }
}

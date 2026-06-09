/**
 * §9.7.2 (eligibility part) — Continue offer (spec §9.3.1):
 * offer iff score >= 500 AND score >= 0.5 × bestScore AND not already used this run.
 *
 * NOTE: the 2-fullest-rows reward clearing itself lives in the ENGINE
 * (Game.applyContinueReward, plan pinned rule 5) — these tests cover only the
 * MonetizationDirector's offer-eligibility decision.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/monetization/config';
import {
  MonetizationDirector,
  createInitialMonetizationState,
} from '../../src/monetization/director';

function director() {
  return new MonetizationDirector(DEFAULT_CONFIG, createInitialMonetizationState(), () => 0);
}

describe('shouldOfferContinue (§9.3.1)', () => {
  it('enforces the 500-point floor (best = 1000)', () => {
    const d = director();
    expect(d.shouldOfferContinue(499, 1000, false)).toBe(false);
    expect(d.shouldOfferContinue(500, 1000, false)).toBe(true);
  });

  it('score exactly 0.5 × best qualifies (spec: score ≥ 0.5 × bestScore)', () => {
    const d = director();
    // 500 = 0.5 × 1000 exactly, and meets the 500 floor -> true
    expect(d.shouldOfferContinue(500, 1000, false)).toBe(true);
  });

  it('enforces the 0.5 × best ratio (best = 2000)', () => {
    const d = director();
    expect(d.shouldOfferContinue(999, 2000, false)).toBe(false); // >= 500 but < 1000
    expect(d.shouldOfferContinue(1000, 2000, false)).toBe(true);
  });

  it('ratio applies with non-integer halves (best = 1001 -> threshold 500.5)', () => {
    const d = director();
    expect(d.shouldOfferContinue(500, 1001, false)).toBe(false); // 500 < 500.5
    expect(d.shouldOfferContinue(501, 1001, false)).toBe(true);
  });

  it('max 1 continue per run: continueUsedThisRun=true always blocks', () => {
    const d = director();
    expect(d.shouldOfferContinue(5000, 1000, true)).toBe(false);
  });

  it('best = 0 (first ever game): only the 500 floor applies', () => {
    const d = director();
    expect(d.shouldOfferContinue(600, 0, false)).toBe(true); // 0.5 × 0 = 0 <= 600, and >= 500
    expect(d.shouldOfferContinue(499, 0, false)).toBe(false);
  });
});

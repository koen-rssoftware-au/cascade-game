# Cascade — Verification Report (spec §7.6)

Generated 2026-06-10. Build: see git history. Live: https://koen-rssoftware-au.github.io/cascade-game/

## Verdict

All automated suites green in two commands (`npm test`, `npm run test:e2e`), monetization
suite included, bundle far under budget, performance targets exceeded. One documented spec
inconsistency (max cascade chain, below). Manual QA checklist: automated where possible;
remaining hand checks listed at the bottom.

## Test counts

| Suite | Command | Files | Tests | Status |
|---|---|---|---|---|
| Unit (engine §7.1 + monetization §9.7.1–2 + daily) | `npm test` | 14 | 149 | ✅ all pass |
| Simulation (§7.2 + §9.7.6) | `npm test` (same run) | 3 | 17 | ✅ all pass |
| E2E (§7.3 + §9.7.3–5 + regressions) | `npm run test:e2e` | 6 | 28 × 2 device profiles = 56 runs | ✅ all pass |
| **Total** | | **20** | **166 unit/sim + 56 e2e runs** | ✅ |

E2E runs on two profiles: Pixel 7 (Chromium/Android) and iPhone 14 (WebKit/iOS), each with a
console-error watchdog — zero console errors or unhandled rejections across the whole suite (§7.3).

## Soak statistics (§7.2, random agent, seeds 1..10000)

- **Games simulated:** 10,000 — zero exceptions, every game terminated, safety cap never hit
- **Mean score (random agent):** 165.9 · mean placements/game: 18.8
- **Mean score (greedy agent, 300 games):** 11,195.9 → **~60× random** (scoring rewards skill, §7.2 sanity ✅)
- **Max cascade chain observed:** 2 (see "Spec inconsistency" below)
- Invariants held on every placement: score non-decreasing, cells ∈ 0..8, cascade ≤ 64 steps,
  board settled (no full lines, gravity no-op) after every clearing placement
- **Daily determinism:** same date seed + same moves → identical boards and scores; replay reproduces exactly

## Monetization invariants (§9.7)

- Director unit tests: grace period (games 1–3), every-2nd cadence, 90s cooldown boundary
  (89,999 vs 90,000 ms), daily cap (19/20/21 + local-day reset), no-double-tax, ISO-week streak
  repair incl. year-boundary vectors, second-try per local day, banner matrix, remove-ads suppression ✅
- Soak extension: director attached to 2,000 real random-agent games with irregular clock advance;
  decisions matched an independent shadow model; caps/cooldowns never violated. Separate
  10,000-event fixed-cadence test reaches the daily cap exactly (80 interstitials / 4 days) ✅
- Ad failure matrix (E2E): every placement (continue, streak repair, second try, interstitial)
  × {unavailable, dismissed, provider exception} → game proceeds, no reward, no crash, no blocked UI ✅
- Kill-proof reward grant (E2E): reload between 'rewarded' resolution and UI continuation →
  post-relaunch state contains the grant ✅
- Remove Ads: zero interstitials/banner, rewarded features remain and grant ad-free, purchase
  persists and round-trips, restore path sets the flag ✅

## Performance (§7.4, against the built bundle)

| Check | Requirement | Measured | Status |
|---|---|---|---|
| fps under 4× CPU throttle, 20-cascade stress scene | ≥ 30 fps | **60.0 fps** | ✅ |
| JS heap growth across 30 consecutive games | < 10 MB | **0.12 MB** | ✅ |
| Lighthouse performance (built bundle) | pass | **100/100** (FCP 1.1s, TBT 0ms, CLS 0) | ✅ |
| Cold load to interactive | < 2 s | 1.2 s (Lighthouse TTI, throttled) | ✅ |
| Total payload | < 5 MB | **116 KB** (precache 13 entries ≈ 73 KB gzip-relevant JS 18.5 KB) | ✅ |
| Offline after first load | full session | verified live (SW precache, airplane-mode probe) | ✅ |

## Documented spec inconsistency: max cascade chain = 2

Spec §2.4 defines gravity as full column compaction ("like Connect-4"). Under that rule, **a
cascade chain deeper than 2 is mathematically impossible**: after any clear+compaction the
board is fully compacted, the full rows are exactly the bottom `min(column height)` rows, and
clearing them always leaves some column at height 0 — so no further full line can exist.
Corroborated by a 3,000,000-random-board search (max found: 2) and a 2,000-board fuzz test.

Consequences (accepted, flagged for the spec owner):
- The §7.1.4 chain-3 fixture cannot exist; the suite contains two fully-asserted chain-2
  fixtures plus the impossibility proof and fuzz bound instead.
- §3.5's "Amazing!" (chain 3) and "UNBELIEVABLE!" (chain ≥ 4) callouts and the §7.5 "chain-3
  feels like a jackpot" QA item are unreachable. The code implements them anyway, so a future
  rule change (e.g. gap-preserving gravity) lights them up without rework.
- The chain-2 + combo-streak + all-clear layer still delivers the escalation loop.

## Engine golden reference

Seed 12345, 15 first-legal placements → final score **115**, board FNV-1a hash **3946954091**,
cross-checked per placement by an in-test independent re-implementation of the §2.5 formula.

## Manual QA checklist (§7.5) — status

- [x] *Dragged piece visible above the finger* — implemented (60px offset, 1.08× scale), verified visually in browser; *confirm on device*
- [x] *Airplane mode: full session works* — automated offline probe against the live site passed; *confirm on device*
- [x] *Kill mid-cascade → relaunch lands post-cascade* — automated (state saves resolved synchronously at drop; regression e2e covers the game-over variant)
- [x] *No dead-end placements caused by UI* — every legal cell reachable: placement targeting is exact-cell (e2e drags prove corner cells (0,0) and (7,7))
- [ ] *A new player understands the game within 10 seconds* — *hand the phone to someone and observe* (cannot be automated)
- [~] *A chain-3 cascade feels like a jackpot* — unreachable (see above); chain-2 fires shake + pitch rise + "Great!" callout, all-clear fires "PERFECT!" + boom

## Known v1 limitations (by design, per spec)

- Ads/IAP are mock implementations (§9: v1 ships `MockAdProvider`/`MockPurchases`); the visible
  2s fake-ad placeholder only renders with `?test=1` or `?debug=1` — production players see no
  placeholder ads. v1.1 swaps in AdMob/StoreKit behind the same interfaces.
- The GitHub Actions deploy workflow is stored as `docs/ci/deploy-workflow.yml.example` because
  the local `gh` token lacks the `workflow` scope; deploys run via `bash scripts/deploy.sh`
  (gh-pages branch). Run `gh auth refresh -s workflow` once to enable the Actions path.

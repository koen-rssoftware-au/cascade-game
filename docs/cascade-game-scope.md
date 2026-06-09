# CASCADE — Build Scope & Verification Specification

**Document purpose:** Complete, unambiguous specification for a coding agent to build and fully verify the game. Every rule is deterministic and testable. Where a choice is left open, a default is specified — follow the default unless instructed otherwise.

---

## 1. Product Summary

**Cascade** is a single-screen, offline, drag-and-drop block puzzle for mobile. The player places pieces on an 8×8 grid to clear full rows and columns. The twist: after lines clear, remaining blocks **fall under gravity**, and any new full lines formed by the fall clear again — producing chain reactions ("cascades") with escalating rewards.

- **Genre:** Casual / block puzzle (Block Blast category)
- **Session length target:** 1–5 minutes per run, infinitely repeatable
- **Audience:** All ages, global, low-end device friendly
- **Connectivity:** 100% playable offline
- **Orientation:** Portrait only
- **Input:** Single finger drag-and-drop. No taps required mid-game except buttons.

### 1.1 Platform & Tech Stack (default)

Build as a **single-page HTML5/TypeScript canvas game** with zero server dependencies, structured so it can later be wrapped with Capacitor for iOS/Android store distribution.

- TypeScript, strict mode
- Rendering: HTML5 Canvas 2D (no WebGL required)
- No game engine framework required; if one is used, prefer a minimal one. No physics engine — all logic is deterministic grid math.
- State persistence: `localStorage` (abstracted behind a `Storage` interface so Capacitor native storage can be swapped in later)
- Audio: Web Audio API, all sounds synthesized or tiny embedded assets; total payload < 5 MB
- Must run at 60 fps on a low-end device profile (throttle test: 4× CPU slowdown in Chrome DevTools must stay ≥ 30 fps)
- **Architecture requirement:** Game logic (rules engine) must be a pure, renderer-independent module with zero DOM/canvas imports. All randomness flows through a single injectable seeded RNG. This is mandatory because the verification plan depends on headless simulation.

---

## 2. Core Game Rules (normative)

### 2.1 Board

- Grid: **8 columns × 8 rows**. Cell coordinates: `(col 0–7, row 0–7)`, row 0 = top.
- Each cell is either empty or filled with a colored block. Color is cosmetic only — it never affects matching, clearing, or scoring.

### 2.2 Pieces

- The player is always offered a **tray of 3 pieces** at the bottom of the screen.
- Pieces are polyomino shapes drawn from the fixed catalog in §2.3.
- Pieces **cannot be rotated**.
- A piece may be dragged from the tray and dropped onto the board. A placement is **legal** iff every cell of the piece lands on an empty board cell fully inside the grid.
- After a piece is placed it is consumed. When **all 3** tray pieces have been placed, a new tray of 3 is generated (see §2.6). The tray never partially refills.

### 2.3 Piece catalog

Each piece is a set of relative cell offsets. Catalog (IDs are stable and used in tests):

| ID | Shape | Cells |
|----|-------|-------|
| P1 | 1×1 dot | (0,0) |
| P2 | 1×2 horizontal | (0,0)(1,0) |
| P3 | 2×1 vertical | (0,0)(0,1) |
| P4 | 1×3 horizontal | (0,0)(1,0)(2,0) |
| P5 | 3×1 vertical | (0,0)(0,1)(0,2) |
| P6 | 1×4 horizontal | (0,0)(1,0)(2,0)(3,0) |
| P7 | 4×1 vertical | (0,0)(0,1)(0,2)(0,3) |
| P8 | 1×5 horizontal | (0,0)(1,0)(2,0)(3,0)(4,0) |
| P9 | 5×1 vertical | (0,0)(0,1)(0,2)(0,3)(0,4) |
| P10 | 2×2 square | (0,0)(1,0)(0,1)(1,1) |
| P11 | 3×3 square | all 9 cells of 3×3 |
| P12 | L small | (0,0)(0,1)(1,1) |
| P13 | L small mirrored | (1,0)(1,1)(0,1) |
| P14 | L small rotated | (0,0)(1,0)(0,1) |
| P15 | L small rotated mirrored | (0,0)(1,0)(1,1) |
| P16 | L big | (0,0)(0,1)(0,2)(1,2)(2,2) |
| P17 | L big mirrored | (2,0)(2,1)(2,2)(1,2)(0,2) |
| P18 | T shape | (0,0)(1,0)(2,0)(1,1) |
| P19 | S/Z horizontal | (1,0)(2,0)(0,1)(1,1) |
| P20 | Z/S horizontal | (0,0)(1,0)(1,1)(2,1) |

### 2.4 Turn sequence (one placement)

1. Player drops a piece on a legal position. Piece cells become filled board cells.
2. **Clear check:** every row with all 8 cells filled and every column with all 8 cells filled is marked. All marked cells clear simultaneously (a cell at a full row/column intersection clears once).
3. **Gravity step (the twist):** after a clear, every remaining filled cell falls straight down within its column until it rests on the bottom wall or another filled cell. (Standard column compaction, like Connect-4 — no floating blocks survive.)
4. **Cascade check:** after gravity, re-run the clear check. If new full rows/columns exist, clear them, apply gravity again, and repeat. Each repetition increments the **cascade chain counter** (placement-triggered clear = chain 1, first cascade = chain 2, etc.).
5. The loop terminates when a gravity step produces no new full lines. (Termination is guaranteed: each clear strictly reduces the number of filled cells.)
6. Score the placement (§2.5), refill tray if empty (§2.6), then run the game-over check (§2.7).

**Important:** Gravity runs **only after a clear**, never after a plain placement. With no clear, blocks stay exactly where placed — preserving the strategic, no-time-pressure feel of the genre.

### 2.5 Scoring

All scoring is integer math, defined exactly:

- **Placement points:** +1 per cell of the placed piece.
- **Line clear points:** for each chain step, `lines_cleared_this_step × 10 × lines_cleared_this_step` (1 line = 10, 2 = 40, 3 = 90, 4 = 160…).
- **Cascade multiplier:** points from chain step *n* are multiplied by *n* (step 1 ×1, step 2 ×2, step 3 ×3…).
- **Combo streak:** a persistent counter of *consecutive placements that triggered at least one clear*. Resets to 0 on any placement with no clear. While streak ≥ 2, all line-clear points (after cascade multiplier) are additionally multiplied by `min(streak, 5)`.
- **All-clear bonus:** if the board is completely empty after the cascade loop ends, +300.
- Running total displayed live; high score persisted.

### 2.6 Piece generation (adaptive bag — exact algorithm)

Deterministic given a seed. Each new tray of 3 is generated as follows:

1. Compute board fill ratio `f` = filled cells / 64.
2. Assign each catalog piece a weight: base weight 10 for all pieces; if `f > 0.55`, pieces with ≤ 3 cells get +10 (relief mode); if `f < 0.30`, pieces with ≥ 4 cells get +5 (pressure mode).
3. Draw 3 pieces independently by weighted random using the seeded RNG.
4. **Survivability guarantee:** if none of the 3 drawn pieces has any legal placement on the current board, redraw the third piece as the largest catalog piece that *does* have a legal placement (falling back toward P1). If even P1 cannot be placed, keep the drawn tray (the game will end legitimately). This guarantee runs at most once per tray and must be deterministic.

This implements the genre-proven "hard but never unfair" adaptive difficulty.

### 2.7 Game over

After every placement (and tray refill), if **no piece remaining in the tray has any legal placement**, the game ends. Show the game-over screen with final score, best score, biggest cascade chain of the run, and a one-tap Replay button. Replay must be reachable in a single tap and start a fresh run in < 1 second.

---

## 3. Game Feel ("Juice") Specification

These are requirements, not suggestions — the research consensus is that this layer drives retention as much as the rules do.

1. **Drag preview:** while dragging, the piece's landing cells are highlighted on the board; legal = soft glow in piece color, illegal = no highlight. Rows/columns that *would* complete are pre-highlighted brighter (the "about to pop" tease).
2. **Snap & haptics:** on drop, piece snaps to grid with a 80–120 ms ease; trigger `navigator.vibrate(10)` (guard for availability) on placement, `vibrate(30)` on clears, escalating pattern on cascades.
3. **Clear animation:** cleared cells burst into 4–8 particles each and fade ≤ 250 ms. Animations never block input for the *next* drag.
4. **Cascade spectacle:** each chain step plays gravity fall (blocks animate falling, 150 ms, slight bounce), then the next clear. Screen shake intensity scales with chain step (2 px → 6 px max). Pitch of clear sound rises one step per chain.
5. **Praise callouts:** centered text pops, ≤ 600 ms, never stacking: 2 lines "Nice!", 3 lines or chain 2 "Great!", chain 3 "Amazing!", chain ≥ 4 "UNBELIEVABLE!", all-clear "PERFECT!".
6. **Sound:** soft placement thock; chime arpeggio on clears; deep satisfying boom on all-clear; gentle ambient nothing otherwise. Master mute toggle, persisted.
7. **Score feedback:** points fly from the cleared lines to the score counter; counter ticks up rather than jumping.
8. **Color palette:** dark navy background, 6–8 saturated candy block colors, large rounded blocks with subtle top highlight. High contrast for readability in clips. No text smaller than 14 px.

---

## 4. Meta Layer (v1 scope — keep minimal)

1. **High score** persisted locally; shown on home and game-over screens.
2. **Daily challenge:** one seeded run per calendar day (seed = `YYYYMMDD` hashed). Fixed piece sequence for everyone; separate daily best score; a **streak counter** of consecutive days played, with the current streak shown on the home screen. (Streak = played, not won — keep it kind.)
3. **Share:** game-over screen has a Share button producing a text payload like `Cascade 🟦 Score 4,820 · Max chain ×4 · Day streak 🔥6` via the Web Share API with clipboard fallback. No images required in v1.
4. **Settings:** sound on/off, haptics on/off, reset data (with confirm).

**Explicitly out of scope for v1:** accounts, server leaderboards, tutorials beyond a 3-step first-launch overlay, localization (structure strings in one file for later), landscape mode, tablets-specific layout (must merely not break). Live ad networks are also out of scope for v1, **but the full monetization architecture in §9 must be built into v1** behind a mock ad provider, so that v1.1 ships by swapping in a real SDK — not by restructuring the game.

---

## 5. Screens & Flow

1. **Home:** logo, Play, Daily Challenge (with streak flame + count), high score, settings gear. One screen, no scrolling.
2. **Game:** score top-center, best score small beside it, current combo streak indicator, 8×8 board centered, tray of 3 pieces at bottom, pause button top-left.
3. **Pause:** resume / restart / home / sound / haptics.
4. **Game over:** final score, best, max chain this run, Replay (primary), Share, Home.
5. **First launch:** 3-step overlay (drag pieces → fill lines to clear → clears make blocks fall and chain), dismissible instantly.

---

## 6. Quality Requirements

- 60 fps on modern phones; ≥ 30 fps under 4× CPU throttle; no GC hitches > 50 ms during play.
- Cold load to interactive < 2 s on a mid-range device; total asset payload < 5 MB.
- All state survives refresh/kill: an in-progress run restores exactly (board, tray, score, streaks) on relaunch.
- Works fully offline after first load (service worker cache).
- No console errors or unhandled promise rejections in a full play session.
- Touch targets ≥ 44×44 px. The dragged piece renders **above and slightly larger than the finger** (offset ~60 px up) so the player can see placement — this is a known genre-critical detail.

---

## 7. Verification Plan (mandatory — build is not done until all pass)

### 7.1 Unit tests (rules engine, headless, deterministic)

Minimum required cases — implement with a test runner (Vitest/Jest), all using the injected seeded RNG:

1. **Placement legality:** every catalog piece at every board position on an empty board — legal iff fully in-bounds. Reject any overlap with a filled cell. Property: legality function never mutates state.
2. **Clear detection:** single full row; single full column; row+column cross (intersection cell cleared exactly once, total cleared = 15, not 16); multiple simultaneous rows; full board.
3. **Gravity:** hand-built fixtures asserting exact post-gravity boards, including columns with multiple gaps, untouched columns, and already-grounded blocks (no-op). Property: gravity preserves per-column filled-cell count.
4. **Cascade loop:** fixture where a clear → fall produces a second clear (chain 2), and one producing chain 3. Assert chain counter, intermediate boards, and termination. Property (fuzz): cascade loop always terminates ≤ 64 iterations on arbitrary boards.
5. **Scoring:** exact expected scores for: 5-cell piece no clear (+5); 1-line clear (+placement +10); 2 lines same step (+40); chain-2 single line (10×1 + 10×2 = 30 line points); streak ×3 scenario; all-clear bonus. One end-to-end scripted game with a known seed asserting the exact final score.
6. **Tray generation:** with fixed seed, generation is reproducible byte-for-byte. Weight shift verified at f = 0.6 and f = 0.2 (statistical test over 10,000 draws, tolerance ±2%). Survivability redraw triggers on a crafted near-full board and is deterministic.
7. **Game over:** crafted board+tray with zero legal moves → game over fires; same board with one legal P1 → it does not.
8. **Persistence:** serialize → deserialize → deep-equal round trip for mid-run state, including RNG state (resumed runs must continue the same piece sequence).

### 7.2 Simulation tests (headless soak)

- **Random-agent soak:** run ≥ 10,000 complete games with a random legal-move agent across seeds. Assert: zero exceptions; score monotonically non-decreasing within a run; board never contains out-of-range cells; every game terminates; invariant "no floating blocks immediately after any cascade loop ends" holds on every turn.
- **Greedy-agent sanity:** an agent that maximizes immediate clears must achieve a higher mean score than the random agent (sanity check that scoring rewards skill).
- **Daily challenge determinism:** two simulations of the same date seed with the same move list produce identical scores and boards.

### 7.3 UI / integration tests (Playwright or equivalent)

- Full happy path: home → play → drag-place 3 pieces (synthetic pointer events) → score updates → pause/resume → force game over via injected state → replay.
- Drag cancel (drop on illegal cell) returns piece to tray, board unchanged.
- Refresh mid-game restores identical board/score/tray (visual + state assertion).
- Daily challenge button starts the seeded run; streak increments once per simulated day, resets after a skipped day (test with mocked clock).
- Mute toggle persists across reload.
- No console errors across the whole suite.

### 7.4 Performance & device checks

- Lighthouse performance pass on the built bundle; record fps under DevTools 4× CPU throttle during a scripted 20-cascade stress scene (must stay ≥ 30 fps).
- Memory: heap growth < 10 MB across 30 consecutive games (leak check).

### 7.5 Manual QA checklist (final gate)

- [ ] A new player understands the game with zero instructions within 10 seconds (hand to someone, observe).
- [ ] Dragged piece is visible above the finger at all times.
- [ ] A chain-3 cascade *feels* like a jackpot (shake + pitch rise + callout all fire).
- [ ] No dead-end placements caused by UI (every legal cell is reachable by drag).
- [ ] Airplane mode: full session works.
- [ ] Kill app mid-cascade animation → relaunch → state is the post-cascade resolved state (never mid-animation, never pre-clear).

### 7.6 Definition of Done

All 7.1–7.4 automated suites green in one command (`npm test` + `npm run test:e2e`), **plus the monetization suite in §9.7**, 7.5 checklist signed off, bundle < 5 MB, and a `VERIFICATION.md` generated summarizing: test counts, soak-run statistics (games simulated, max chain observed, mean scores per agent), monetization invariant results, and performance numbers.

---

## 8. Suggested Build Order for the Agent

1. Pure rules engine + seeded RNG + full unit suite (§7.1) — get this green before any rendering.
2. Headless simulation harness + soak suite (§7.2).
3. Canvas renderer + input (drag/drop/preview) wired to the engine.
4. Juice layer (§3), screens (§5), persistence, daily challenge.
5. Monetization architecture (§9) with the mock ad provider + its test suite (§9.7).
6. E2E + performance suites (§7.3–7.4), then VERIFICATION.md and manual QA (§7.5).

---

## 9. v1.1 Monetization Specification

**Model:** hybrid casual — ad-revenue core (interstitial + rewarded + banner) with a minimal IAP layer (Remove Ads + cosmetics later). v1 implements everything below against a **mock ad provider**; v1.1 swaps in a real mediation SDK (default: Google AdMob via the abstraction in §9.1) with zero changes to game code.

**Design law (overrides everything else in this section):** ads must never interrupt active play, never gate the core loop, and rewarded ads are always opt-in with the reward stated up front. If any rule below would conflict with retention guardrails (§9.6), retention wins.

### 9.1 Ad provider abstraction (build in v1)

A single `AdProvider` interface, injected like the RNG:

```ts
interface AdProvider {
  isReady(kind: 'interstitial' | 'rewarded' | 'banner'): boolean;
  showInterstitial(): Promise<'shown' | 'skipped' | 'unavailable'>;
  showRewarded(): Promise<'rewarded' | 'dismissed' | 'unavailable'>;
  setBannerVisible(visible: boolean): void;
}
```

- v1 ships `MockAdProvider` (configurable to simulate fill, no-fill, dismiss-without-reward, and latency) and uses it everywhere. A debug flag visibly fakes ad display (2 s placeholder screen) so flows are testable end to end.
- All placement decisions (when/whether to show) live in a pure, unit-testable `MonetizationDirector` module that consumes game events and emits ad decisions. The renderer never decides; it only obeys.
- **Failure rule:** every ad call can fail (`unavailable`). On failure, the game continues exactly as if the ad were shown (interstitial) or the offer is hidden (rewarded). An ad failure must never block, soft-lock, or punish the player.

### 9.2 Interstitial placements (the volume engine)

- **Only trigger point:** the game-over screen, after the score presentation finishes (never before — the player must see their result first).
- **Frequency rules (defaults, all remotely/locally configurable constants in one `MonetizationConfig` object):**
  - No interstitials in the player's **first 3 games ever** (grace period).
  - No more than 1 interstitial per **90 seconds** (cooldown).
  - Show on every **2nd** game over (`gameOversPerInterstitial = 2`).
  - Hard cap **20 per day** per device.
- Never show an interstitial on the same game over where the player watched a rewarded ad (no double-tax).
- Pre-load the next interstitial as soon as one closes; `isReady` gating means a slow network silently skips, never delays.

### 9.3 Rewarded video placements (the value engine)

Three placements, all opt-in, all with the reward named on the button:

1. **Continue? (`onContinueOffered`)** — on game over, if `score ≥ 0.5 × bestScore` and `score ≥ 500`, offer: *"Watch to keep going — clears the 2 fullest rows."* Rules: max **1 continue per run**; on reward, clear the 2 rows with the most filled cells (ties → lower row index), run the normal gravity/cascade loop (cascade chain counter starts at 1; these clears award **no points** — the reward is survival, not score), then resume with the current tray. On `dismissed` or `unavailable`, proceed to normal game over.
2. **Streak repair** — if the daily-challenge streak broke **yesterday only** (exactly one missed day), home screen shows: *"Repair your 🔥N streak — watch a short ad."* Max 1 repair per calendar week. Restores the streak count as if unbroken; today's challenge must still be played to extend it.
3. **Daily second try** — after a finished daily-challenge run, offer one ad-gated retry of the same seed. Best of the two scores counts. Max 1 per day.

Reward grant happens **only** on the `'rewarded'` resolution. Grants are written to persisted state *before* any UI continues (kill-proof: relaunching after the ad must land in the post-reward state — extend the §7.1.8 persistence tests to cover this).

### 9.4 Banner

- One adaptive banner anchored below the piece tray, in a **reserved layout slot** that exists in v1 (empty in v1) so its appearance never shifts gameplay layout or violates the 44 px touch-target rule.
- Visible only on the Game screen; hidden on home, pause, and game over (those belong to interstitials/UX).
- Disabled entirely for the first session ever, and whenever Remove Ads is owned.

### 9.5 IAP

- **v1.1 launch SKU — `remove_ads` (one-time, non-consumable, $3.99 default):** permanently disables interstitials and banners. **Rewarded placements remain available** (they're player-positive features, not ads-as-tax), and continue/streak-repair/second-try are granted **without** showing an ad for owners. Purchase entry points: settings, a small "No ads" pill on the game-over screen, and the post-interstitial close moment (a one-line "Remove ads forever — $3.99" link, never a popup).
- Ownership is a persisted boolean behind a `Purchases` interface (mock in v1, StoreKit/Play Billing via Capacitor in v1.1). Must include a Restore Purchases button in settings.
- **v1.2+ (do not build yet, just don't preclude):** cosmetic block skins / board themes / cascade particle styles as IAP or rewarded-ad-earnable. Cosmetics must remain strictly visual — anything affecting rules, RNG, or scoring is forbidden permanently.

### 9.6 Retention guardrails & instrumentation

- All frequency constants live in `MonetizationConfig` with the defaults above; ship a debug panel to edit them at runtime for tuning.
- Log (locally in v1, analytics SDK in v1.1) a minimal event set: `game_start`, `game_over(score, chain_max)`, `interstitial_shown/skipped`, `rewarded_offered/completed/dismissed(placement)`, `remove_ads_purchased`, `daily_played(streak)`. No PII, no device fingerprinting.
- **Kill-switch criteria for tuning (documented for the operator, not enforced in code):** if D1 retention drops > 10% relative after enabling interstitials, halve frequency; rewarded placements are never the suspect first.

### 9.7 Monetization verification (added to the Definition of Done)

Automated (extends §7.1/§7.3):

1. `MonetizationDirector` unit tests: grace period (games 1–3 never show), every-2nd-game-over cadence, 90 s cooldown, daily cap, no-interstitial-after-rewarded rule — all driven by a mocked clock and event sequences, asserting exact decision outputs.
2. Continue flow: eligibility thresholds (just below/above 50% of best and the 500 floor), one-per-run enforcement, exact 2-row selection on a crafted board (including tie-break), zero points awarded for the reward clears, cascade behavior after the reward clear, and correct resume state.
3. Ad failure matrix: for each placement × {`unavailable`, `dismissed`, provider exception}, the game proceeds without reward, without crash, and without blocked UI (E2E with `MockAdProvider` configured per case).
4. Remove Ads: owning the flag suppresses interstitials and banner, keeps rewarded features and grants them ad-free; restore-purchase path sets the flag; persistence round-trips it.
5. Kill-proof reward grant: E2E that simulates app kill between `'rewarded'` resolution and UI continuation, asserting post-relaunch state contains the grant.
6. Soak extension: the §7.2 random-agent soak runs with `MonetizationDirector` attached and asserts its invariants (caps and cooldowns never violated across 10,000 games).

Manual (extends §7.5):

- [ ] Play 10 games as a brand-new profile: no ads in games 1–3, then interstitials at the specified cadence, never mid-play.
- [ ] Continue offer appears only on qualifying runs and the button states the reward.
- [ ] With Remove Ads owned: zero interstitials/banners across a full session; continue still offered and granted instantly.
- [ ] Banner slot never overlaps the tray or shifts the board.

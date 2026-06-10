// Bootstrap + game flow orchestration. All rules live in src/engine; all ad policy in
// src/monetization. This file wires them to the renderer, screens and persistence.
import '../style.css';
import { Game } from '../engine/game';
import { hashStringToSeed } from '../engine/rng';
import { findFullLines } from '../engine/board';
import { anyPlacementAnyRotation, shapeFor } from '../engine/pieces';
import { idx, type Board, type ChainStep } from '../engine/types';
import { DEFAULT_CONFIG, type MonetizationConfig } from '../monetization/config';
import { MonetizationDirector, createInitialMonetizationState } from '../monetization/director';
import { MockAdProvider, SafeAdProvider } from '../monetization/adProvider';
import { MockPurchases } from '../monetization/purchases';
import { UiAdProvider } from './adUi';
import { HydratedNativeStorage, LocalStorageImpl, type Storage } from './storage';
import { Persistence } from './persistence';
import { initNativeChrome } from './native';
import { GameAudio } from './audio';
import { Haptics } from './haptics';
import { Renderer } from './renderer';
import { InputHandler } from './input';
import { Screens } from './screens';
import { mountDebugPanel } from './debugPanel';
import {
  dateKey,
  currentStreak,
  streakBrokeYesterdayOnly,
  recordDailyPlayed,
  applyStreakRepair,
} from './daily';
import { STR } from '../strings';

const params = new URLSearchParams(location.search);
const TEST_MODE = params.get('test') === '1';
const DEBUG_MODE = params.get('debug') === '1';

class App {
  storage: Storage;
  persist: Persistence;
  settings: ReturnType<Persistence['loadSettings']>;
  stats: ReturnType<Persistence['loadStats']>;
  daily: ReturnType<Persistence['loadDaily']>;
  audio = new GameAudio();
  haptics = new Haptics();
  screens = new Screens();
  config: MonetizationConfig = { ...DEFAULT_CONFIG };
  director: MonetizationDirector;
  adProvider: MockAdProvider;
  safeAds: SafeAdProvider;
  purchases: MockPurchases;
  renderer: Renderer;
  input: InputHandler;
  game: Game | null = null;
  firstSessionEver: boolean;
  private clockOverride: (() => number) | null = null;
  private todayOverride: string | null = null;
  private rewardedWatchedThisGameOver = false;
  private displayedScore = 0;
  private lastFrame = 0;
  private gameOverPending = false;
  private bannerEl: HTMLElement;
  // Bumped on every navigation away from a game-over moment (new game, home, second
  // try). A pending deferred interstitial compares epochs and silently cancels —
  // an ad must never appear after the player already moved on (§9 design law).
  private gameOverEpoch = 0;
  // one-per-run undo (gameplay update): snapshot taken before every placement
  private undoUsed = false;
  private prevSnapshot: string | null = null;
  private newBestCelebrated = false;
  private lastInteractionAt = performance.now();

  constructor(storage: Storage) {
    this.storage = storage;
    this.persist = new Persistence(storage);
    this.settings = this.persist.loadSettings();
    this.stats = this.persist.loadStats();
    this.daily = this.persist.loadDaily();
    this.firstSessionEver = this.stats.firstSessionAt === null;
    if (this.firstSessionEver) {
      this.stats.firstSessionAt = Date.now();
      this.persist.saveStats(this.stats);
    }
    this.audio.muted = !this.settings.sound;
    this.haptics.enabled = this.settings.haptics;

    const monState = this.persist.loadMonetization();
    this.director = new MonetizationDirector(
      this.config,
      monState ?? createInitialMonetizationState(),
      () => this.now(),
    );
    this.adProvider = new MockAdProvider();
    // §9.1: the visible 2s placeholder is a debug/test affordance. Without the flag
    // the mock resolves invisibly — v1 production shows no fake ads to players.
    this.safeAds = new SafeAdProvider(
      DEBUG_MODE || TEST_MODE ? new UiAdProvider(this.adProvider, this.screens) : this.adProvider,
    );
    const ownedSkus = this.director.state.removeAdsOwned ? ['remove_ads'] : [];
    this.purchases = new MockPurchases({ owned: ownedSkus, restoreSkus: ownedSkus });

    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new Renderer(canvas, {
      onStepFx: (step) => this.onStepFx(step),
      onAllClearFx: () => {
        this.audio.allClear();
        this.haptics.cascade(5);
      },
      onTimelineDone: () => this.onTimelineDone(),
    });
    this.input = new InputHandler(canvas, this.renderer, {
      getTraySlot: (i) => this.traySlotView(i),
      canPlace: (i, col, row) => this.canPlaceTray(i, col, row),
      wouldClear: (i, col, row) => this.wouldClear(i, col, row),
      onDrop: (i, col, row) => this.dropPiece(i, col, row),
      onPickup: () => {
        this.touch();
        this.audio.pickup();
      },
      onCancelDrag: () => {
        this.touch(); // a released drag restarts the idle-hint window
        this.audio.illegal();
      },
      onTapTraySlot: (i) => this.rotateSlot(i),
      enabled: () => this.game !== null && !this.game.state.over && !this.gameOverPending,
    });

    this.bannerEl = document.getElementById('banner-slot') ?? this.makeBannerSlot();
    this.screens.onPause = (): void => {
      // the run is already over — pausing would let the player dodge the game-over commit
      if (this.gameOverPending || this.game === null || this.game.state.over) return;
      this.showPause();
    };
    this.screens.onUndo = (): void => this.undo();

    window.addEventListener('resize', () => this.renderer.resize());
    window.visualViewport?.addEventListener('resize', () => this.renderer.resize());
    document.addEventListener('pointerdown', () => this.audio.unlock(), { capture: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    requestAnimationFrame((t) => this.loop(t));
  }

  private makeBannerSlot(): HTMLElement {
    const div = document.createElement('div');
    div.id = 'banner-slot';
    document.getElementById('app')?.appendChild(div);
    return div;
  }

  now(): number {
    return this.clockOverride ? this.clockOverride() : Date.now();
  }
  todayKey(): string {
    return this.todayOverride ?? dateKey(new Date(this.now()));
  }

  // ---------------- boot routing ----------------
  start(): void {
    const saved = this.persist.loadRun();
    if (saved !== null) {
      try {
        const game = Game.deserialize(saved.engine);
        this.game = game;
        this.undoUsed = saved.undoUsed;
        this.prevSnapshot = saved.prev;
        // strict >, matching the live trigger — a run sitting exactly at best
        // has not earned its moment yet
        this.newBestCelebrated = game.state.score > this.stats.best;
        this.enterGameScreen();
        if (game.state.over) {
          // Killed between the game-ending placement and the game-over commit:
          // recover the full flow (continue offer, stats/streak commit, screen)
          // instead of silently discarding the run's score (§7.5 kill-proofness).
          void this.gameOverFlow();
        }
        return;
      } catch {
        this.persist.clearRun();
      }
    }
    if (!this.stats.tutorialDone) {
      this.screens.showTutorial(() => {
        this.stats.tutorialDone = true;
        this.persist.saveStats(this.stats);
        this.showHome();
      });
      return;
    }
    this.showHome();
  }

  showHome(): void {
    this.gameOverEpoch++;
    this.game = null;
    this.screens.setHudVisible(false);
    this.updateBanner('home');
    const repairEligible =
      streakBrokeYesterdayOnly(this.daily, this.todayKey()) &&
      this.director.canOfferStreakRepair(true);
    if (repairEligible) {
      // §9.6: rewarded_offered fires when the offer is PRESENTED, not when tapped
      this.persist.appendEvent({ name: 'rewarded_offered', t: this.now(), data: { placement: 'streak_repair' } });
    }
    this.screens.showHome(
      {
        best: this.stats.best,
        streak: currentStreak(this.daily, this.todayKey()),
        dailyDoneToday: this.dailyPlayedToday(),
        repairOffer: repairEligible ? this.daily.streak : null,
      },
      {
        onPlay: () => this.resumeOrNew('normal'),
        onDaily: () => this.resumeOrNew('daily'),
        onSettings: () => this.showSettings(),
        onStreakRepair: () => void this.streakRepairFlow(),
      },
    );
  }

  private dailyPlayedToday(): boolean {
    return this.daily.lastPlayedDate === this.todayKey();
  }

  /** Home buttons resume a matching in-progress run instead of discarding it (§6). */
  private resumeOrNew(mode: 'normal' | 'daily'): void {
    const saved = this.persist.loadRun();
    if (saved !== null) {
      try {
        const game = Game.deserialize(saved.engine);
        const matchesToday = mode !== 'daily' || game.state.dailyDate === this.todayKey();
        if (!game.state.over && game.state.mode === mode && matchesToday) {
          this.game = game;
          this.undoUsed = saved.undoUsed;
          this.prevSnapshot = saved.prev;
          this.newBestCelebrated = game.state.score > this.stats.best;
          this.enterGameScreen();
          return;
        }
      } catch {
        this.persist.clearRun();
      }
    }
    if (mode === 'daily' && this.dailyPlayedToday()) {
      // §4.2: one seeded run per calendar day (the ad-gated second try is the only retry)
      this.screens.toast(STR.daily.doneToday);
      return;
    }
    this.newGame(mode);
  }

  newGame(mode: 'normal' | 'daily', dailyDateKey?: string): void {
    this.gameOverEpoch++;
    const dateKey = dailyDateKey ?? this.todayKey();
    const seed = mode === 'daily' ? hashStringToSeed(dateKey) : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.game = mode === 'daily' ? Game.create(seed, 'daily', dateKey) : Game.create(seed, 'normal');
    this.undoUsed = false;
    this.prevSnapshot = null;
    this.newBestCelebrated = false;
    this.saveRunState();
    this.persist.appendEvent({ name: 'game_start', t: this.now(), data: { mode } });
    this.enterGameScreen();
  }

  /** Persist the resolved run + undo bookkeeping in one place. */
  private saveRunState(): void {
    const game = this.game;
    if (!game) return;
    this.persist.saveRun({ engine: game.serialize(), undoUsed: this.undoUsed, prev: this.prevSnapshot });
  }

  private enterGameScreen(): void {
    const game = this.game;
    if (!game) return;
    this.gameOverPending = false;
    this.displayedScore = game.state.score;
    this.touch();
    this.screens.clear();
    this.screens.setHudVisible(true);
    this.updateBanner('game');
    this.renderer.fx.clearAll();
    this.renderer.reset(); // a stale timeline from a previous run must never replay here
    this.input.cancelActive();
    this.renderer.setBoard(game.state.board);
    this.syncTray();
    this.updateUndoButton();
    this.renderer.resize();
  }

  // ---------------- gameplay ----------------
  private touch(): void {
    this.lastInteractionAt = performance.now();
    this.renderer.hintSlot = null;
  }

  private traySlotView(i: number): { piece: ReturnType<typeof shapeFor>; color: number } | null {
    const slot = this.game?.state.tray[i] ?? null;
    if (!slot) return null;
    return { piece: shapeFor(slot.pieceId, slot.rot), color: slot.color };
  }

  private canPlaceTray(i: number, col: number, row: number): boolean {
    return this.game?.canPlace(i, col, row) ?? false; // rotation-aware via the slot's rot
  }

  private wouldClear(i: number, col: number, row: number): { rows: number[]; cols: number[] } {
    const game = this.game;
    const slot = game?.state.tray[i];
    if (!game || !slot) return { rows: [], cols: [] };
    const piece = shapeFor(slot.pieceId, slot.rot);
    const board: Board = game.state.board.slice();
    for (const [dx, dy] of piece.cells) board[idx(col + dx, row + dy)] = slot.color;
    return findFullLines(board);
  }

  private syncTray(): void {
    const game = this.game;
    if (!game) return;
    this.renderer.setTray(
      game.state.tray.map((slot) => {
        if (!slot) return null;
        return {
          piece: shapeFor(slot.pieceId, slot.rot),
          color: slot.color,
          // dim only when NO rotation fits — the player can always tap-rotate
          placeable: anyPlacementAnyRotation(game.state.board, slot.pieceId),
        };
      }),
    );
  }

  /** Tap on a tray piece: rotate it a quarter turn (gameplay update). */
  private rotateSlot(i: number): void {
    const game = this.game;
    if (!game || game.state.over || this.gameOverPending) return;
    if (!game.state.tray[i]) return;
    this.touch();
    game.rotateTray(i);
    this.saveRunState(); // rotation must survive refresh
    this.syncTray();
    this.renderer.spinSlot(i);
    this.audio.rotate();
    this.haptics.placement();
  }

  private undo(): void {
    const game = this.game;
    if (!game || game.state.over || this.gameOverPending) return;
    if (this.undoUsed || this.prevSnapshot === null) return;
    this.touch();
    let restored: Game;
    try {
      restored = Game.deserialize(this.prevSnapshot);
    } catch {
      // corrupt persisted snapshot — drop it instead of throwing in the click handler
      this.prevSnapshot = null;
      this.saveRunState();
      this.updateUndoButton();
      return;
    }
    this.game = restored;
    this.undoUsed = true;
    this.prevSnapshot = null;
    // re-arm the new-best moment if the rolled-back score no longer beats best
    this.newBestCelebrated = restored.state.score > this.stats.best;
    this.saveRunState();
    this.displayedScore = restored.state.score;
    this.renderer.fx.clearAll();
    this.renderer.reset();
    this.renderer.setBoard(restored.state.board);
    this.syncTray();
    this.updateUndoButton();
    this.audio.illegal(); // soft "rewind" cue
  }

  private updateUndoButton(): void {
    // never render the button enabled in states where undo() refuses
    const blocked = !this.game || this.game.state.over || this.gameOverPending;
    this.screens.setUndoEnabled(!blocked && !this.undoUsed && this.prevSnapshot !== null);
  }

  private dropPiece(i: number, col: number, row: number): void {
    const game = this.game;
    const slot = game?.state.tray[i];
    if (!game || !slot || !game.canPlace(i, col, row)) {
      this.audio.illegal();
      return;
    }
    this.touch();
    const piece = shapeFor(slot.pieceId, slot.rot);
    const color = slot.color;
    const before: Board = game.state.board.slice();
    if (!this.undoUsed) this.prevSnapshot = game.serialize(); // pre-placement undo point
    const result = game.place(i, col, row);
    // board right after the piece landed, before any clear — animation start state
    const afterPlacement = before.slice();
    const placedCells: Array<{ col: number; row: number }> = [];
    for (const [dx, dy] of piece.cells) {
      afterPlacement[idx(col + dx, row + dy)] = color;
      placedCells.push({ col: col + dx, row: row + dy });
    }
    this.renderer.startSteps(
      afterPlacement,
      result.steps,
      placedCells,
      result.allClearBonus > 0,
      result.streakMultiplier,
    );
    this.audio.place();
    this.haptics.placement();
    // resolved state persists IMMEDIATELY — kill mid-animation restores post-cascade state (§7.5)
    this.saveRunState();
    this.syncTray();
    this.updateUndoButton();

    // lifetime stats (settings screen)
    if (result.steps.length > 0) {
      for (const s of result.steps) this.stats.linesCleared += s.linesCleared;
      if (result.allClearBonus > 0) this.stats.allClears += 1;
      this.persist.saveStats(this.stats);
    }
    // one-time "New best!" moment while playing (not on the very first run ever)
    if (!this.newBestCelebrated && this.stats.best > 0 && result.scoreAfter > this.stats.best) {
      this.newBestCelebrated = true;
      this.renderer.fx.showCallout(STR.newBest, 3, performance.now());
      this.audio.newBest();
    }

    if (result.gameOver) {
      this.gameOverPending = true; // flow continues in onTimelineDone
    }
  }

  private onStepFx(step: ChainStep): void {
    this.audio.clear(step.step, step.linesCleared);
    if (step.step > 1) this.haptics.cascade(step.step);
    else this.haptics.clear();
  }

  private onTimelineDone(): void {
    if (this.gameOverPending) {
      this.gameOverPending = false;
      void this.gameOverFlow();
    }
  }

  // ---------------- game over + monetization flow ----------------
  private async gameOverFlow(): Promise<void> {
    const game = this.game;
    if (!game) return;
    const epoch = ++this.gameOverEpoch; // invalidates any previous pending flow
    const score = game.state.score;
    this.rewardedWatchedThisGameOver = false;

    // 1) Continue offer (§9.3.1) — before the run is committed as over.
    if (this.director.shouldOfferContinue(score, this.stats.best, game.state.continueUsed)) {
      this.persist.appendEvent({ name: 'rewarded_offered', t: this.now(), data: { placement: 'continue' } });
      const choice = await this.screens.showContinueOffer(this.director.state.removeAdsOwned);
      if (choice === 'watch') {
        const outcome = this.director.state.removeAdsOwned
          ? 'rewarded'
          : await this.safeAds.showRewarded();
        if (outcome === 'rewarded') {
          // Grant is applied and persisted synchronously BEFORE any UI continues (§9.3 kill-proof).
          const boardBefore: Board = game.state.board.slice();
          const res = game.applyContinueReward();
          this.prevSnapshot = null; // undo can never cross a continue grant
          this.saveRunState();
          // reward clears count toward lifetime stats like any visual clear
          if (res.steps.length > 0) {
            for (const s of res.steps) this.stats.linesCleared += s.linesCleared;
            if (res.boardAfter.every((c) => c === 0)) this.stats.allClears += 1;
            this.persist.saveStats(this.stats);
          }
          this.persist.appendEvent({ name: 'rewarded_completed', t: this.now(), data: { placement: 'continue' } });
          this.rewardedWatchedThisGameOver = true;
          if (!game.state.over) {
            this.enterGameScreen();
            // reward clears award zero points → no "+N" flyers (§9.3.1)
            this.renderer.startSteps(boardBefore, res.steps, [], false, 1, false);
            return; // run resumes
          }
          // The reward cleared 2 rows but no tray piece fits even now — fall
          // through to the normal game over (continueUsed blocks a second offer).
        } else {
          this.persist.appendEvent({ name: 'rewarded_dismissed', t: this.now(), data: { placement: 'continue' } });
        }
      }
    }

    // 2) Commit the game over. Everything before clearRun() must stay IDEMPOTENT:
    // a kill in this block replays the whole commit on the next boot (recovery).
    const isNewBest = score > this.stats.best;
    this.stats.best = Math.max(this.stats.best, score);
    this.stats.maxChainEver = Math.max(this.stats.maxChainEver, game.state.maxChain);
    this.persist.saveStats(this.stats);
    const isDaily = game.state.mode === 'daily';
    // a daily counts for the day it was SEEDED, even when finished after midnight
    const dailyKey = game.state.dailyDate ?? this.todayKey();
    if (isDaily) {
      this.daily = recordDailyPlayed(this.daily, dailyKey, score);
      this.persist.saveDaily(this.daily);
      this.persist.appendEvent({
        name: 'daily_played',
        t: this.now(),
        data: { streak: this.daily.streak },
      });
    }
    this.persist.clearRun();
    // non-idempotent counter AFTER clearRun: a recovery replay can never double-count
    this.stats.gamesPlayed += 1;
    this.persist.saveStats(this.stats);
    this.director.recordGameOver();
    this.persist.saveMonetization(this.director.state);
    this.persist.appendEvent({
      name: 'game_over',
      t: this.now(),
      data: { score, chain_max: game.state.maxChain },
    });
    this.audio.gameOver();

    // 3) Game-over screen — score presentation first (§9.2).
    const maxChain = game.state.maxChain;
    this.updateBanner('gameover');
    const offerSecondTry = isDaily && this.director.canOfferDailySecondTry();
    if (offerSecondTry) {
      this.persist.appendEvent({ name: 'rewarded_offered', t: this.now(), data: { placement: 'daily_second_try' } });
    }
    this.screens.showGameOver(
      {
        score,
        best: this.stats.best,
        isNewBest,
        maxChain,
        isDaily,
        offerSecondTry,
        showNoAdsPill: !this.director.state.removeAdsOwned,
      },
      {
        onReplay: () => this.newGame('normal'), // fresh run in < 1s (§2.7); a daily is once per day
        onShare: () => void this.share(score, maxChain),
        onHome: () => this.showHome(),
        onRemoveAds: () => void this.purchaseRemoveAds(),
        onDailySecondTry: () => void this.dailySecondTryFlow(dailyKey),
      },
    );

    // 4) Interstitial AFTER the score presentation finishes (§9.2) — but only if the
    // player is still on this game-over moment (epoch guard).
    await sleep(1400);
    if (epoch !== this.gameOverEpoch || !document.querySelector('[data-screen="gameover"]')) return;
    if (this.director.shouldShowInterstitial(this.rewardedWatchedThisGameOver)) {
      const result = await this.safeAds.showInterstitial();
      if (epoch !== this.gameOverEpoch) return;
      if (result === 'shown') {
        this.director.recordInterstitialShown();
        this.persist.saveMonetization(this.director.state);
        this.persist.appendEvent({ name: 'interstitial_shown', t: this.now() });
        // post-interstitial close moment: one-line remove-ads link, never a popup (§9.5)
        const screenEl = document.querySelector('[data-screen="gameover"]');
        if (screenEl && !this.director.state.removeAdsOwned) {
          const link = document.createElement('button');
          link.className = 'link-line';
          link.dataset['testid'] = 'post-ad-removeads';
          link.textContent = STR.ads.removeAds;
          link.addEventListener('click', () => void this.purchaseRemoveAds());
          screenEl.appendChild(link);
        }
      } else {
        // a DUE interstitial the provider could not fill — the §9.2 'skipped' signal
        this.persist.appendEvent({ name: 'interstitial_skipped', t: this.now(), data: { reason: result } });
      }
    }
    // not-due game overs log nothing: 'skipped' is a provider outcome, not a cadence miss
  }

  private async share(score: number, maxChain: number): Promise<void> {
    const text = STR.sharePayload.payload(score, maxChain, currentStreak(this.daily, this.todayKey()));
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text });
        return;
      }
    } catch (err) {
      // the player closed the share sheet on purpose — do not force the clipboard
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.screens.toast(STR.shareCopied);
    } catch {
      this.screens.toast(text);
    }
  }

  private async streakRepairFlow(): Promise<void> {
    this.persist.appendEvent({ name: 'rewarded_offered', t: this.now(), data: { placement: 'streak_repair' } });
    const outcome = this.director.state.removeAdsOwned ? 'rewarded' : await this.safeAds.showRewarded();
    if (outcome === 'rewarded') {
      this.daily = applyStreakRepair(this.daily, this.todayKey());
      this.director.recordStreakRepair();
      this.persist.saveDaily(this.daily);
      this.persist.saveMonetization(this.director.state);
      this.persist.appendEvent({ name: 'rewarded_completed', t: this.now(), data: { placement: 'streak_repair' } });
    } else {
      this.persist.appendEvent({ name: 'rewarded_dismissed', t: this.now(), data: { placement: 'streak_repair' } });
    }
    this.showHome();
  }

  private async dailySecondTryFlow(dailyKey: string): Promise<void> {
    if (!this.director.canOfferDailySecondTry()) return;
    this.gameOverEpoch++; // cancels the pending deferred interstitial for this game over
    const outcome = this.director.state.removeAdsOwned ? 'rewarded' : await this.safeAds.showRewarded();
    if (outcome === 'rewarded') {
      this.director.recordDailySecondTry();
      this.persist.saveMonetization(this.director.state);
      this.persist.appendEvent({ name: 'rewarded_completed', t: this.now(), data: { placement: 'daily_second_try' } });
      this.newGame('daily', dailyKey); // the SAME seed, even across midnight; best of two counts (§9.3.3)
    } else {
      this.persist.appendEvent({ name: 'rewarded_dismissed', t: this.now(), data: { placement: 'daily_second_try' } });
    }
  }

  private async purchaseRemoveAds(): Promise<void> {
    if (this.director.state.removeAdsOwned) return; // non-consumable: one-time only (§9.5)
    const result = await this.purchases.purchase('remove_ads');
    if (result === 'purchased') {
      this.director.setRemoveAdsOwned(true);
      this.persist.saveMonetization(this.director.state);
      this.persist.appendEvent({ name: 'remove_ads_purchased', t: this.now() });
      this.screens.toast(STR.ads.purchaseThanks);
      document.querySelector('[data-testid="noads-pill"]')?.remove();
      document.querySelector('[data-testid="post-ad-removeads"]')?.remove();
      this.updateBanner(this.game ? 'game' : 'home');
    }
  }

  // ---------------- pause / settings ----------------
  private showPause(): void {
    this.updateBanner('pause');
    this.screens.showPause({
      // §4.2: a daily is one seeded run per day — restarting it would be a free retry
      canRestart: this.game?.state.mode !== 'daily',
      onResume: () => {
        this.screens.clear();
        this.updateBanner('game');
      },
      onRestart: () => this.newGame('normal'),
      onHome: () => this.showHome(),
      sound: () => this.settings.sound,
      haptics: () => this.settings.haptics,
      onToggleSound: () => this.toggleSound(),
      onToggleHaptics: () => this.toggleHaptics(),
    });
  }

  private toggleSound(): boolean {
    this.settings.sound = !this.settings.sound;
    this.audio.muted = !this.settings.sound;
    this.persist.saveSettings(this.settings);
    return this.settings.sound;
  }
  private toggleHaptics(): boolean {
    this.settings.haptics = !this.settings.haptics;
    this.haptics.enabled = this.settings.haptics;
    this.persist.saveSettings(this.settings);
    return this.settings.haptics;
  }

  private showSettings(): void {
    this.screens.showSettings({
      sound: () => this.settings.sound,
      haptics: () => this.settings.haptics,
      onToggleSound: () => this.toggleSound(),
      onToggleHaptics: () => this.toggleHaptics(),
      onReset: () => {
        this.persist.resetAll();
        location.reload();
      },
      onBack: () => this.showHome(),
      onRemoveAds: () => void this.purchaseRemoveAds(),
      onRestore: () => void this.restorePurchases(),
      removeAdsOwned: () => this.director.state.removeAdsOwned,
      stats: () => ({
        gamesPlayed: this.stats.gamesPlayed,
        allClears: this.stats.allClears,
        maxChainEver: this.stats.maxChainEver,
        linesCleared: this.stats.linesCleared,
      }),
    });
  }

  private async restorePurchases(): Promise<void> {
    const owned = await this.purchases.restore();
    if (owned.includes('remove_ads')) {
      this.director.setRemoveAdsOwned(true);
      this.persist.saveMonetization(this.director.state);
      this.screens.toast(STR.ads.restored);
      this.showSettings();
    } else {
      this.screens.toast(STR.ads.nothingToRestore);
    }
  }

  // ---------------- banner (§9.4: reserved slot, mock content) ----------------
  private updateBanner(screen: 'home' | 'game' | 'pause' | 'gameover'): void {
    const visible = this.director.bannerVisible(screen, this.firstSessionEver);
    this.adProvider.setBannerVisible(visible);
    // The reserved layout slot exists on the game screen in v1 (empty), so a real banner
    // in v1.1 never shifts gameplay layout (§9.4).
    this.bannerEl.classList.toggle('reserved', screen === 'game' || screen === 'pause');
    this.bannerEl.textContent = visible && DEBUG_MODE ? '· banner ad slot ·' : '';
    this.renderer.resize(); // the slot changes the canvas height — relayout the board
  }

  // ---------------- frame loop ----------------
  private loop(t: number): void {
    const dt = this.lastFrame === 0 ? 16 : Math.min(t - this.lastFrame, 50);
    this.lastFrame = t;
    const game = this.game;
    if (game) {
      const target = game.state.score;
      if (this.displayedScore !== target) {
        const diff = target - this.displayedScore;
        this.displayedScore = Math.abs(diff) < 1 ? target : this.displayedScore + diff * Math.min(1, dt / 180);
      }
      this.screens.updateHud(this.displayedScore, this.stats.best, game.state.streak);
      // idle hint (gameplay update): after 8s without input, pulse a placeable piece
      if (
        !game.state.over &&
        !this.gameOverPending &&
        !this.renderer.animating &&
        this.renderer.drag === null && // an active touch is input, not idleness
        t - this.lastInteractionAt > 8000
      ) {
        if (this.renderer.hintSlot === null) {
          const idxHint = game.state.tray.findIndex(
            (slot) => slot !== null && anyPlacementAnyRotation(game.state.board, slot.pieceId),
          );
          if (idxHint >= 0) this.renderer.hintSlot = idxHint;
        }
      }
      // NOTE: the renderer owns the visual board; it is only re-synced on state changes
      // (placements, continue reward, injectState) — never per frame, or the cascade
      // animation timeline would be clobbered mid-flight.
      this.renderer.frame(t, dt);
    }
    requestAnimationFrame((t2) => this.loop(t2));
  }

  /** Android hardware back: behave like a native app would (§ store-readiness). */
  handleBackButton(): 'minimize' | 'handled' {
    const screen = document.querySelector('[data-screen]')?.getAttribute('data-screen');
    if (screen === 'home') return 'minimize';
    if (screen === 'pause') {
      this.screens.clear();
      this.updateBanner('game');
      return 'handled';
    }
    if (screen === 'settings' || screen === 'gameover') {
      this.showHome();
      return 'handled';
    }
    if (screen === 'tutorial' || screen === 'continue-offer') return 'handled'; // explicit choice required
    if (this.game && !this.game.state.over && !this.gameOverPending) {
      this.screens.onPause?.(); // in-game back = pause, never data loss
      return 'handled';
    }
    return 'minimize';
  }

  // ---------------- test hooks ----------------
  mountTestHooks(): void {
    const hooks = {
      app: this,
      injectState: (json: string): void => {
        this.game = Game.deserialize(json);
        this.undoUsed = false;
        this.prevSnapshot = null;
        this.saveRunState();
        this.enterGameScreen();
      },
      getState: (): string | null => this.game?.serialize() ?? null,
      place: (i: number, col: number, row: number): void => this.dropPiece(i, col, row),
      forceGameOver: (): void => {
        this.gameOverPending = false;
        void this.gameOverFlow();
      },
      setNow: (fn: (() => number) | null): void => {
        this.clockOverride = fn;
      },
      setToday: (key: string | null): void => {
        this.todayOverride = key;
      },
      fastForward: (): void => this.renderer.fastForward(),
      trayRect: (i: number): { x: number; y: number; w: number; h: number } | null =>
        this.renderer.trayRects()[i] ?? null,
      cellCenter: (col: number, row: number): { x: number; y: number } =>
        this.renderer.cellCenter(col, row),
      canvasOffset: (): { x: number; y: number } => {
        const r = (document.getElementById('game-canvas') as HTMLCanvasElement).getBoundingClientRect();
        return { x: r.left, y: r.top };
      },
      // Finger position (canvas-relative) that makes the dragged piece's origin land
      // exactly on (col,row) — inverse of Renderer.dragOriginCell.
      dragPointFor: (i: number, col: number, row: number): { x: number; y: number } | null => {
        const slot = this.traySlotView(i);
        if (!slot) return null;
        const { boardX, boardY, cell } = this.renderer.layout;
        const size = cell * 1.08;
        return {
          x: boardX + col * cell - (size - cell) / 2 + (slot.piece.w * size) / 2,
          y: boardY + row * cell - (size - cell) / 2 + 60 + slot.piece.h * size,
        };
      },
      director: this.director,
      config: this.config,
      adProvider: this.adProvider,
      purchases: this.purchases,
      newGame: (mode: 'normal' | 'daily'): void => this.newGame(mode),
      goHome: (): void => this.showHome(),
    };
    (window as unknown as { __cascade: typeof hooks }).__cascade = hooks;
  }
}

async function boot(): Promise<void> {
  const { Capacitor } = await import('@capacitor/core');
  const native = Capacitor.isNativePlatform();
  // Native: durable Preferences-backed storage, hydrated before anything reads.
  const storage: Storage = native ? await HydratedNativeStorage.create() : new LocalStorageImpl();
  const app = new App(storage);
  if (native) {
    void app.haptics.useNative();
    void initNativeChrome({ onBackButton: () => app.handleBackButton() });
  } else if ('serviceWorker' in navigator) {
    // web/PWA only — a service worker inside the Capacitor shell is pointless
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  }
  if (TEST_MODE || DEBUG_MODE) app.mountTestHooks();
  if (DEBUG_MODE) {
    mountDebugPanel(app.config, {
      gamesCompleted: () => String(app.director.state.totalGamesCompleted),
      sinceInterstitial: () => String(app.director.state.gameOversSinceInterstitial),
      removeAds: () => String(app.director.state.removeAdsOwned),
    });
  }
  app.start();
}
void boot();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

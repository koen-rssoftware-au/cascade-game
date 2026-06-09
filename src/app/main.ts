// Bootstrap + game flow orchestration. All rules live in src/engine; all ad policy in
// src/monetization. This file wires them to the renderer, screens and persistence.
import '../style.css';
import { Game } from '../engine/game';
import { hashStringToSeed } from '../engine/rng';
import { canPlace, anyLegalPlacement, findFullLines } from '../engine/board';
import { pieceById } from '../engine/pieces';
import { idx, type Board, type ChainStep } from '../engine/types';
import { DEFAULT_CONFIG, type MonetizationConfig } from '../monetization/config';
import { MonetizationDirector, createInitialMonetizationState } from '../monetization/director';
import { MockAdProvider, SafeAdProvider } from '../monetization/adProvider';
import { MockPurchases } from '../monetization/purchases';
import { UiAdProvider } from './adUi';
import { LocalStorageImpl } from './storage';
import { Persistence } from './persistence';
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
  storage = new LocalStorageImpl();
  persist = new Persistence(this.storage);
  settings = this.persist.loadSettings();
  stats = this.persist.loadStats();
  daily = this.persist.loadDaily();
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

  constructor() {
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
    this.safeAds = new SafeAdProvider(new UiAdProvider(this.adProvider, this.screens));
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
      onPickup: () => this.audio.pickup(),
      onCancelDrag: () => this.audio.illegal(),
      enabled: () => this.game !== null && !this.game.state.over && !this.gameOverPending,
    });

    this.bannerEl = document.getElementById('banner-slot') ?? this.makeBannerSlot();
    this.screens.onPause = (): void => this.showPause();

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
        const game = Game.deserialize(saved);
        if (!game.state.over) {
          this.game = game;
          this.enterGameScreen();
          return;
        }
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
    this.game = null;
    this.screens.setHudVisible(false);
    this.updateBanner('home');
    const repairEligible =
      streakBrokeYesterdayOnly(this.daily, this.todayKey()) &&
      this.director.canOfferStreakRepair(true);
    this.screens.showHome(
      {
        best: this.stats.best,
        streak: currentStreak(this.daily, this.todayKey()),
        dailyDoneToday: (this.daily.bestByDate[this.todayKey()] ?? 0) > 0 || this.daily.lastPlayedDate === this.todayKey(),
        repairOffer: repairEligible ? this.daily.streak : null,
      },
      {
        onPlay: () => this.newGame('normal'),
        onDaily: () => this.newGame('daily'),
        onSettings: () => this.showSettings(),
        onStreakRepair: () => void this.streakRepairFlow(),
      },
    );
  }

  newGame(mode: 'normal' | 'daily'): void {
    const today = this.todayKey();
    const seed = mode === 'daily' ? hashStringToSeed(today) : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.game = mode === 'daily' ? Game.create(seed, 'daily', today) : Game.create(seed, 'normal');
    this.persist.saveRun(this.game.serialize());
    this.persist.appendEvent({ name: 'game_start', t: this.now(), data: { mode } });
    this.enterGameScreen();
  }

  private enterGameScreen(): void {
    const game = this.game;
    if (!game) return;
    this.gameOverPending = false;
    this.rewardedWatchedThisGameOver = false;
    this.displayedScore = game.state.score;
    this.screens.clear();
    this.screens.setHudVisible(true);
    this.updateBanner('game');
    this.renderer.fx.clearAll();
    this.renderer.setBoard(game.state.board);
    this.syncTray();
    this.renderer.resize();
  }

  // ---------------- gameplay ----------------
  private traySlotView(i: number): { piece: ReturnType<typeof pieceById>; color: number } | null {
    const slot = this.game?.state.tray[i] ?? null;
    if (!slot) return null;
    return { piece: pieceById(slot.pieceId), color: slot.color };
  }

  private canPlaceTray(i: number, col: number, row: number): boolean {
    const game = this.game;
    const slot = game?.state.tray[i];
    if (!game || !slot) return false;
    return canPlace(game.state.board, pieceById(slot.pieceId), col, row);
  }

  private wouldClear(i: number, col: number, row: number): { rows: number[]; cols: number[] } {
    const game = this.game;
    const slot = game?.state.tray[i];
    if (!game || !slot) return { rows: [], cols: [] };
    const piece = pieceById(slot.pieceId);
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
        const piece = pieceById(slot.pieceId);
        return { piece, color: slot.color, placeable: anyLegalPlacement(game.state.board, piece) };
      }),
    );
  }

  private dropPiece(i: number, col: number, row: number): void {
    const game = this.game;
    const slot = game?.state.tray[i];
    if (!game || !slot || !game.canPlace(i, col, row)) {
      this.audio.illegal();
      return;
    }
    const piece = pieceById(slot.pieceId);
    const color = slot.color;
    const before: Board = game.state.board.slice();
    const result = game.place(i, col, row);
    // board right after the piece landed, before any clear — animation start state
    const afterPlacement = before.slice();
    const placedCells: Array<{ col: number; row: number }> = [];
    for (const [dx, dy] of piece.cells) {
      afterPlacement[idx(col + dx, row + dy)] = color;
      placedCells.push({ col: col + dx, row: row + dy });
    }
    this.renderer.startSteps(afterPlacement, result.steps, placedCells, result.allClearBonus > 0);
    this.audio.place();
    this.haptics.placement();
    // resolved state persists IMMEDIATELY — kill mid-animation restores post-cascade state (§7.5)
    this.persist.saveRun(game.serialize());
    this.syncTray();
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
          this.persist.saveRun(game.serialize());
          this.persist.appendEvent({ name: 'rewarded_completed', t: this.now(), data: { placement: 'continue' } });
          this.rewardedWatchedThisGameOver = true;
          this.enterGameScreen();
          this.renderer.startSteps(boardBefore, res.steps, [], false);
          return; // run resumes
        }
        this.persist.appendEvent({ name: 'rewarded_dismissed', t: this.now(), data: { placement: 'continue' } });
      }
    }

    // 2) Commit the game over.
    const isNewBest = score > this.stats.best;
    this.stats.best = Math.max(this.stats.best, score);
    this.stats.maxChainEver = Math.max(this.stats.maxChainEver, game.state.maxChain);
    this.persist.saveStats(this.stats);
    const isDaily = game.state.mode === 'daily';
    if (isDaily) {
      this.daily = recordDailyPlayed(this.daily, this.todayKey(), score);
      this.persist.saveDaily(this.daily);
      this.persist.appendEvent({
        name: 'daily_played',
        t: this.now(),
        data: { streak: this.daily.streak },
      });
    }
    this.persist.clearRun();
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
    const showScreen = (): void =>
      this.screens.showGameOver(
        {
          score,
          best: this.stats.best,
          isNewBest,
          maxChain,
          isDaily,
          offerSecondTry: isDaily && this.director.canOfferDailySecondTry(),
          showNoAdsPill: !this.director.state.removeAdsOwned,
        },
        {
          onReplay: () => this.replay(),
          onShare: () => void this.share(score, maxChain),
          onHome: () => this.showHome(),
          onRemoveAds: () => void this.purchaseRemoveAds(),
          onDailySecondTry: () => void this.dailySecondTryFlow(),
        },
      );
    showScreen();

    // 4) Interstitial AFTER the score presentation finishes (§9.2).
    await sleep(1400);
    if (this.director.shouldShowInterstitial(this.rewardedWatchedThisGameOver)) {
      const result = await this.safeAds.showInterstitial();
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
        this.persist.appendEvent({ name: 'interstitial_skipped', t: this.now() });
      }
    } else {
      this.persist.appendEvent({ name: 'interstitial_skipped', t: this.now() });
    }
  }

  private replay(): void {
    const mode = this.game?.state.mode ?? 'normal';
    this.newGame(mode); // fresh run in < 1s (§2.7)
  }

  private async share(score: number, maxChain: number): Promise<void> {
    const text = STR.sharePayload.payload(score, maxChain, currentStreak(this.daily, this.todayKey()));
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text });
        return;
      }
    } catch {
      /* fall through to clipboard */
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

  private async dailySecondTryFlow(): Promise<void> {
    if (!this.director.canOfferDailySecondTry()) return;
    this.persist.appendEvent({ name: 'rewarded_offered', t: this.now(), data: { placement: 'daily_second_try' } });
    const outcome = this.director.state.removeAdsOwned ? 'rewarded' : await this.safeAds.showRewarded();
    if (outcome === 'rewarded') {
      this.director.recordDailySecondTry();
      this.persist.saveMonetization(this.director.state);
      this.persist.appendEvent({ name: 'rewarded_completed', t: this.now(), data: { placement: 'daily_second_try' } });
      this.rewardedWatchedThisGameOver = true;
      this.newGame('daily'); // same date → same seed; best of two counts (§9.3.3)
    } else {
      this.persist.appendEvent({ name: 'rewarded_dismissed', t: this.now(), data: { placement: 'daily_second_try' } });
    }
  }

  private async purchaseRemoveAds(): Promise<void> {
    const result = await this.purchases.purchase('remove_ads');
    if (result === 'purchased') {
      this.director.setRemoveAdsOwned(true);
      this.persist.saveMonetization(this.director.state);
      this.persist.appendEvent({ name: 'remove_ads_purchased', t: this.now() });
      this.screens.toast(STR.ads.purchaseThanks);
      this.updateBanner(this.game ? 'game' : 'home');
    }
  }

  // ---------------- pause / settings ----------------
  private showPause(): void {
    this.updateBanner('pause');
    this.screens.showPause({
      onResume: () => {
        this.screens.clear();
        this.updateBanner('game');
      },
      onRestart: () => {
        const mode = this.game?.state.mode ?? 'normal';
        this.newGame(mode);
      },
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
      // NOTE: the renderer owns the visual board; it is only re-synced on state changes
      // (placements, continue reward, injectState) — never per frame, or the cascade
      // animation timeline would be clobbered mid-flight.
      this.renderer.frame(t, dt);
    }
    requestAnimationFrame((t2) => this.loop(t2));
  }

  // ---------------- test hooks ----------------
  mountTestHooks(): void {
    const hooks = {
      app: this,
      injectState: (json: string): void => {
        this.game = Game.deserialize(json);
        this.persist.saveRun(json);
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

const app = new App();
if (TEST_MODE || DEBUG_MODE) app.mountTestHooks();
if (DEBUG_MODE) {
  mountDebugPanel(app.config, {
    gamesCompleted: () => String(app.director.state.totalGamesCompleted),
    sinceInterstitial: () => String(app.director.state.gameOversSinceInterstitial),
    removeAds: () => String(app.director.state.removeAdsOwned),
  });
}
app.start();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

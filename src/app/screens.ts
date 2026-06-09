// DOM overlay screens (spec §5). DOM (not canvas) so buttons are native ≥44px touch targets.
import { STR } from '../strings';

const SVG = {
  pause:
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19.4 13a7.7 7.7 0 0 0 .1-1 7.7 7.7 0 0 0-.1-1l2.1-1.6a.5.5 0 0 0 .1-.7l-2-3.4a.5.5 0 0 0-.6-.2l-2.5 1a7.6 7.6 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.4L9 5.1a7.6 7.6 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.4a.5.5 0 0 0 .1.7L4.5 11a7.7 7.7 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.7l2 3.4c.1.2.4.3.6.2l2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6c0 .2.2.4.5.4h4c.2 0 .4-.2.5-.4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.4a.5.5 0 0 0-.1-.7L19.4 13zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>',
  flame:
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="fill:#ffa94d"><path d="M13.5 0s.8 2.6.8 4.7c0 2-1.3 3.7-3.4 3.7C8.8 8.4 7.3 6.7 7.3 4.6l0-.4C5.3 6.6 4 9.6 4 12.9 4 17.4 7.6 21 12 21s8-3.6 8-8.1c0-5.5-2.6-10.3-6.5-12.9zM11.7 18c-1.8 0-3.3-1.4-3.3-3.2 0-1.7 1.1-2.8 2.9-3.2 1.8-.4 3.7-1.3 4.7-2.7.4 1.3.6 2.6.6 4 0 2.8-2.2 5.1-4.9 5.1z"/></svg>',
} as const;

function el(tag: string, className: string, html?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function btn(label: string, className: string, onTap: () => void, testId?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `btn ${className}`;
  b.innerHTML = label;
  if (testId !== undefined) b.dataset['testid'] = testId;
  b.addEventListener('click', onTap);
  return b;
}

export interface HomeCallbacks {
  onPlay(): void;
  onDaily(): void;
  onSettings(): void;
  onStreakRepair(): void;
}
export interface HomeModel {
  best: number;
  streak: number;
  dailyDoneToday: boolean;
  repairOffer: number | null; // broken streak value when repair is offered (§9.3.2)
}

export interface GameOverCallbacks {
  onReplay(): void;
  onShare(): void;
  onHome(): void;
  onRemoveAds(): void;
  onDailySecondTry(): void;
}
export interface GameOverModel {
  score: number;
  best: number;
  isNewBest: boolean;
  maxChain: number;
  isDaily: boolean;
  offerSecondTry: boolean;
  showNoAdsPill: boolean;
}

export class Screens {
  private root: HTMLElement;
  private hud: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer: number | undefined;
  hudScore!: HTMLElement;
  hudBest!: HTMLElement;
  hudStreak!: HTMLElement;

  constructor() {
    this.root = document.getElementById('overlay-root') as HTMLElement;
    this.hud = document.getElementById('hud') as HTMLElement;
    this.buildHudSkeleton();
    this.toastEl = el('div', '');
    this.toastEl.id = 'toast';
    document.body.appendChild(this.toastEl);
  }

  private buildHudSkeleton(): void {
    this.hud.innerHTML = '';
    const pauseBtn = btn(SVG.pause, 'btn-icon', () => this.onPause?.(), 'pause');
    pauseBtn.setAttribute('aria-label', STR.pause);
    const scoreWrap = el('div', 'hud-score-wrap');
    this.hudScore = el('div', '');
    this.hudScore.id = 'hud-score';
    this.hudScore.textContent = '0';
    this.hudBest = el('div', '');
    this.hudBest.id = 'hud-best';
    scoreWrap.append(this.hudScore, this.hudBest);
    this.hudStreak = el('div', 'idle');
    this.hudStreak.id = 'hud-streak';
    this.hud.append(pauseBtn, scoreWrap, this.hudStreak);
  }

  onPause: (() => void) | null = null;

  setHudVisible(v: boolean): void {
    this.hud.classList.toggle('visible', v);
  }

  updateHud(score: number, best: number, streak: number): void {
    this.hudScore.textContent = Math.round(score).toLocaleString('en-US');
    this.hudBest.textContent = `${STR.best} ${best.toLocaleString('en-US')}`;
    this.hudStreak.innerHTML = streak >= 2 ? `×${Math.min(streak, 5)} combo` : '';
    this.hudStreak.classList.toggle('idle', streak < 2);
  }

  clear(): void {
    this.root.innerHTML = '';
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }

  showHome(model: HomeModel, cb: HomeCallbacks): void {
    this.clear();
    this.setHudVisible(false);
    const s = el('div', 'screen screen-solid');
    s.dataset['screen'] = 'home';
    const logo = el('div', 'logo', STR.appName);
    const tagline = el('div', 'tagline', STR.tagline);
    const stats = el('div', 'stat-row');
    const bestStat = el('div', 'stat');
    bestStat.append(
      Object.assign(el('div', 'stat-value'), { textContent: model.best.toLocaleString('en-US') }),
      Object.assign(el('div', 'stat-label'), { textContent: STR.highScore }),
    );
    stats.append(bestStat);
    if (model.streak > 0) {
      const streakStat = el('div', 'stat');
      streakStat.append(
        Object.assign(el('div', 'stat-value'), { innerHTML: `${SVG.flame.replace('<svg', '<svg width="20" height="20"')} ${model.streak}` }),
        Object.assign(el('div', 'stat-label'), { textContent: STR.daily.streakLabel }),
      );
      stats.append(streakStat);
    }
    const menu = el('div', 'menu-col');
    menu.append(btn(STR.play, 'btn-primary', cb.onPlay, 'play'));
    const dailyLabel = model.dailyDoneToday
      ? `${STR.dailyChallenge} ✓`
      : model.streak > 0
        ? `${STR.dailyChallenge} · 🔥${model.streak}`
        : STR.dailyChallenge;
    menu.append(btn(dailyLabel, 'btn-gold', cb.onDaily, 'daily'));
    if (model.repairOffer !== null) {
      const repair = btn(STR.daily.repairOffer(model.repairOffer), 'btn-ghost', cb.onStreakRepair, 'streak-repair');
      repair.style.fontSize = '14px';
      menu.append(repair);
    }
    const gear = btn(SVG.gear, 'btn-icon', cb.onSettings, 'settings');
    gear.setAttribute('aria-label', STR.settings);
    gear.style.position = 'absolute';
    gear.style.top = 'calc(env(safe-area-inset-top, 0px) + 14px)';
    gear.style.right = '14px';
    s.append(gear, logo, tagline, stats, menu);
    this.root.appendChild(s);
  }

  showPause(cb: { onResume(): void; onRestart(): void; onHome(): void; sound(): boolean; haptics(): boolean; onToggleSound(): boolean; onToggleHaptics(): boolean }): void {
    this.clear();
    const s = el('div', 'screen');
    s.dataset['screen'] = 'pause';
    s.append(el('div', 'gameover-title', STR.pause));
    const menu = el('div', 'menu-col');
    menu.append(btn(STR.resume, 'btn-primary', cb.onResume, 'resume'));
    menu.append(btn(STR.restart, '', cb.onRestart, 'restart'));
    menu.append(btn(STR.home, 'btn-ghost', cb.onHome, 'pause-home'));
    s.append(menu);
    s.append(this.toggleRow(STR.sound, cb.sound(), cb.onToggleSound, 'sound-toggle'));
    s.append(this.toggleRow(STR.haptics, cb.haptics(), cb.onToggleHaptics, 'haptics-toggle'));
    this.root.appendChild(s);
  }

  private toggleRow(label: string, initial: boolean, onToggle: () => boolean, testId: string): HTMLElement {
    const row = el('div', 'setting-row');
    row.append(Object.assign(el('span', ''), { textContent: label }));
    const t = document.createElement('button');
    t.className = `toggle ${initial ? 'on' : ''}`;
    t.dataset['testid'] = testId;
    t.setAttribute('role', 'switch');
    t.setAttribute('aria-checked', String(initial));
    t.setAttribute('aria-label', label);
    t.addEventListener('click', () => {
      const now = onToggle();
      t.classList.toggle('on', now);
      t.setAttribute('aria-checked', String(now));
    });
    row.append(t);
    return row;
  }

  /** Game over (spec §5.4): score presented FIRST; interstitial decision happens after via flow in main. */
  showGameOver(model: GameOverModel, cb: GameOverCallbacks): void {
    this.clear();
    this.setHudVisible(false);
    const s = el('div', 'screen');
    s.dataset['screen'] = 'gameover';
    s.append(el('div', 'gameover-title', STR.gameOver));
    const scoreEl = el('div', 'gameover-score', '0');
    scoreEl.dataset['testid'] = 'final-score';
    s.append(scoreEl);
    if (model.isNewBest) s.append(el('div', 'newbest-badge', '★ New best!'));
    const stats = el('div', 'stat-row');
    const bestStat = el('div', 'stat');
    bestStat.append(
      Object.assign(el('div', 'stat-value'), { textContent: model.best.toLocaleString('en-US') }),
      Object.assign(el('div', 'stat-label'), { textContent: STR.best }),
    );
    const chainStat = el('div', 'stat');
    chainStat.append(
      Object.assign(el('div', 'stat-value'), { textContent: `×${model.maxChain}` }),
      Object.assign(el('div', 'stat-label'), { textContent: STR.maxChain }),
    );
    stats.append(bestStat, chainStat);
    s.append(stats);
    const menu = el('div', 'menu-col');
    menu.append(btn(STR.replay, 'btn-primary', cb.onReplay, 'replay'));
    if (model.isDaily && model.offerSecondTry) {
      const st = btn(STR.daily.secondTry, 'btn-gold', cb.onDailySecondTry, 'second-try');
      menu.append(st);
    }
    menu.append(btn(STR.share, '', cb.onShare, 'share'));
    menu.append(btn(STR.home, 'btn-ghost', cb.onHome, 'gameover-home'));
    s.append(menu);
    if (model.showNoAdsPill) {
      const pill = el('button', 'pill', STR.ads.removeAdsShort);
      pill.dataset['testid'] = 'noads-pill';
      pill.addEventListener('click', cb.onRemoveAds);
      s.append(pill);
    }
    this.root.appendChild(s);
    // score counts up rather than jumping (spec §3.7)
    const start = performance.now();
    const dur = Math.min(900, 300 + model.score / 10);
    const tick = (now: number): void => {
      const t = Math.min((now - start) / dur, 1);
      const v = Math.round(model.score * (1 - Math.pow(1 - t, 3)));
      scoreEl.textContent = v.toLocaleString('en-US');
      if (t < 1 && scoreEl.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Continue offer (§9.3.1) — opt-in, reward stated on the button. Returns user choice. */
  showContinueOffer(adFree: boolean): Promise<'watch' | 'decline'> {
    return new Promise((resolve) => {
      this.clear();
      const s = el('div', 'screen');
      s.dataset['screen'] = 'continue-offer';
      const card = el('div', 'tut-card');
      card.append(el('div', 'tut-title', STR.continueOffer.title));
      card.append(el('div', 'tut-body', STR.continueOffer.body));
      const watch = btn(adFree ? STR.continueOffer.free : `▶ ${STR.continueOffer.watch}`, 'btn-gold', () => {
        resolve('watch');
      }, 'continue-watch');
      const decline = btn(STR.continueOffer.noThanks, 'btn-ghost', () => {
        resolve('decline');
      }, 'continue-decline');
      watch.style.width = '100%';
      decline.style.width = '100%';
      card.append(watch, decline);
      s.append(card);
      this.root.appendChild(s);
    });
  }

  showSettings(cb: {
    sound(): boolean;
    haptics(): boolean;
    onToggleSound(): boolean;
    onToggleHaptics(): boolean;
    onReset(): void;
    onBack(): void;
    onRemoveAds(): void;
    onRestore(): void;
    removeAdsOwned(): boolean;
  }): void {
    this.clear();
    const s = el('div', 'screen screen-solid');
    s.dataset['screen'] = 'settings';
    s.append(el('div', 'gameover-title', STR.settings));
    s.append(this.toggleRow(STR.sound, cb.sound(), cb.onToggleSound, 'sound-toggle'));
    s.append(this.toggleRow(STR.haptics, cb.haptics(), cb.onToggleHaptics, 'haptics-toggle'));
    const menu = el('div', 'menu-col');
    const iapLabel = cb.removeAdsOwned() ? STR.ads.removeAdsOwned : STR.ads.removeAds;
    const iap = btn(iapLabel, 'btn-gold', cb.onRemoveAds, 'remove-ads');
    if (cb.removeAdsOwned()) iap.disabled = true;
    menu.append(iap);
    menu.append(btn(STR.ads.restorePurchases, '', cb.onRestore, 'restore'));
    const reset = btn(STR.resetData, 'btn-ghost', () => {
      if (window.confirm(STR.resetConfirm)) cb.onReset();
    }, 'reset-data');
    reset.style.color = 'var(--danger)';
    menu.append(reset);
    menu.append(btn(STR.home, '', cb.onBack, 'settings-back'));
    s.append(menu);
    this.root.appendChild(s);
  }

  /** First-launch 3-step overlay (spec §5.5), dismissible instantly. */
  showTutorial(onDone: () => void): void {
    this.clear();
    const steps = [
      { title: STR.tutorial.step1Title, body: STR.tutorial.step1Body, art: tutorialArt(1) },
      { title: STR.tutorial.step2Title, body: STR.tutorial.step2Body, art: tutorialArt(2) },
      { title: STR.tutorial.step3Title, body: STR.tutorial.step3Body, art: tutorialArt(3) },
    ];
    let i = 0;
    const s = el('div', 'screen');
    s.dataset['screen'] = 'tutorial';
    const card = el('div', 'tut-card');
    const render = (): void => {
      const step = steps[i];
      if (!step) return;
      card.innerHTML = '';
      card.append(Object.assign(el('div', 'tut-art'), { innerHTML: step.art }));
      card.append(el('div', 'tut-title', step.title));
      card.append(el('div', 'tut-body', step.body));
      const dots = el('div', 'tut-dots');
      for (let d = 0; d < 3; d++) dots.append(el('span', d === i ? 'active' : ''));
      card.append(dots);
      const next = btn(i < 2 ? STR.tutorial.next : STR.tutorial.gotIt, 'btn-primary', () => {
        if (i < 2) {
          i++;
          render();
        } else {
          onDone();
        }
      }, 'tut-next');
      next.style.width = '100%';
      card.append(next);
      const skip = el('button', 'link-line', STR.tutorial.skip);
      skip.dataset['testid'] = 'tut-skip';
      skip.addEventListener('click', onDone);
      card.append(skip);
    };
    render();
    s.append(card);
    this.root.appendChild(s);
  }

  /** Visible fake ad (§9.1 debug flag): 2s placeholder so flows are testable end to end. */
  showFakeAd(kind: 'interstitial' | 'rewarded', durationMs: number): Promise<'completed' | 'dismissed'> {
    return new Promise((resolve) => {
      const wrap = el('div', '');
      wrap.id = 'fake-ad';
      wrap.dataset['testid'] = `fake-ad-${kind}`;
      const box = el('div', 'ad-box');
      box.append(el('div', '', STR.ads.fakeAdTitle));
      const count = el('div', 'ad-count', String(Math.ceil(durationMs / 1000)));
      box.append(count, el('div', '', STR.ads.fakeAdBody));
      wrap.append(box);
      const finish = (result: 'completed' | 'dismissed'): void => {
        wrap.remove();
        resolve(result);
      };
      const start = performance.now();
      const timer = window.setInterval(() => {
        const left = durationMs - (performance.now() - start);
        if (left <= 0) {
          window.clearInterval(timer);
          if (kind === 'interstitial') {
            const closeBtn = btn('✕', 'btn-icon', () => finish('completed'), 'ad-close');
            wrap.append(closeBtn);
          } else {
            finish('completed');
          }
          count.textContent = '0';
        } else {
          count.textContent = String(Math.ceil(left / 1000));
        }
      }, 100);
      if (kind === 'rewarded') {
        const dismiss = el('button', 'link-line', '✕ Skip ad (no reward)');
        dismiss.dataset['testid'] = 'ad-dismiss';
        dismiss.addEventListener('click', () => {
          window.clearInterval(timer);
          finish('dismissed');
        });
        wrap.append(dismiss);
      }
      document.body.appendChild(wrap);
    });
  }
}

function tutorialArt(step: number): string {
  const block = (x: number, y: number, c: string, s = 22): string =>
    `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="5" fill="${c}"/>`;
  if (step === 1) {
    return `<svg width="180" height="90" viewBox="0 0 180 90" xmlns="http://www.w3.org/2000/svg">
      ${block(20, 55, '#5c7cfa')}${block(44, 55, '#5c7cfa')}
      <path d="M75 66 C 100 66, 110 40, 135 30" stroke="#9aa3c7" stroke-width="3" fill="none" stroke-dasharray="6 5" marker-end="none"/>
      ${block(130, 10, '#5c7cfa')}${block(154, 10, '#5c7cfa')}
    </svg>`;
  }
  if (step === 2) {
    let cells = '';
    for (let i = 0; i < 8; i++) cells += block(8 + i * 21, 35, i < 6 ? '#51cf66' : 'rgba(154,163,199,0.25)', 18);
    return `<svg width="180" height="90" viewBox="0 0 180 90" xmlns="http://www.w3.org/2000/svg">${cells}
      <text x="90" y="78" fill="#ffd43b" font-size="13" font-weight="700" text-anchor="middle" font-family="sans-serif">Fill the line!</text></svg>`;
  }
  let art = '';
  for (let i = 0; i < 3; i++) art += block(60 + i * 24, 8, '#f783ac', 20);
  art += `<path d="M95 36 L95 56" stroke="#ffd43b" stroke-width="3" marker-end="none"/>
    <path d="M88 49 L95 58 L102 49" stroke="#ffd43b" stroke-width="3" fill="none"/>`;
  for (let i = 0; i < 3; i++) art += block(60 + i * 24, 62, '#3bc9db', 20);
  return `<svg width="180" height="90" viewBox="0 0 180 90" xmlns="http://www.w3.org/2000/svg">${art}</svg>`;
}

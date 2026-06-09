// §9.7.3–5 — ad failure matrix, kill-proof reward grant, remove-ads suppression,
// interstitial flow, banner slot geometry.
import { test, expect, seedProfile, gotoTest, injectState, getGameState } from './helpers';
import type { Page } from '@playwright/test';

async function setAdBehavior(page: Page, behavior: string): Promise<void> {
  await page.evaluate(
    (b) =>
      (window as never as { __cascade: { adProvider: { setBehavior(b: string): void } } }).__cascade.adProvider.setBehavior(b),
    behavior,
  );
}
async function setToday(page: Page, key: string): Promise<void> {
  await page.evaluate(
    (k) => (window as never as { __cascade: { setToday(k: string): void } }).__cascade.setToday(k),
    key,
  );
}
async function goHome(page: Page): Promise<void> {
  await page.evaluate(() => (window as never as { __cascade: { goHome(): void } }).__cascade.goHome());
}
/** Live director state (the in-memory truth) for budget assertions. */
async function directorState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() =>
    JSON.parse(
      JSON.stringify(
        (window as never as { __cascade: { director: { state: Record<string, unknown> } } }).__cascade.director.state,
      ),
    ),
  );
}
async function forceGameOver(page: Page): Promise<void> {
  await page.evaluate(() => (window as never as { __cascade: { forceGameOver(): void } }).__cascade.forceGameOver());
}

/** Inject an eligible-for-continue run: score 600 vs best 1000 (§9.3.1). */
async function injectEligibleRun(page: Page): Promise<void> {
  const board = new Array<number>(64).fill(0);
  for (let c = 0; c < 6; c++) board[7 * 8 + c] = 3; // bottom row partially filled
  for (let c = 0; c < 4; c++) board[6 * 8 + c] = 4;
  await injectState(page, { board, score: 600 });
}

for (const behavior of ['unavailable', 'dismiss', 'throw'] as const) {
  test(`continue ad failure (${behavior}): game proceeds without reward, no crash`, async ({ page }) => {
    await seedProfile(page, { best: 1000 });
    await gotoTest(page);
    await page.locator('[data-testid="play"]').click();
    await injectEligibleRun(page);
    await setAdBehavior(page, behavior);
    await forceGameOver(page);

    await expect(page.locator('[data-screen="continue-offer"]')).toBeVisible();
    await page.locator('[data-testid="continue-watch"]').click();
    // no reward: run ends normally; UI never blocks (§9.1 failure rule)
    await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
    const state = await getGameState(page);
    expect(state?.['continueUsed']).toBe(false);
  });
}

test('continue success: reward is granted, persisted kill-proof, run resumes', async ({ page }) => {
  await seedProfile(page, { best: 1000 });
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();
  await injectEligibleRun(page);
  await setAdBehavior(page, 'reward');
  await forceGameOver(page);

  await page.locator('[data-testid="continue-watch"]').click();
  await expect(page.locator('[data-testid="fake-ad-rewarded"]')).toBeVisible();
  // wait for the rewarded resolution: grant is saved synchronously at that moment
  await expect(page.locator('[data-testid="fake-ad-rewarded"]')).toHaveCount(0, { timeout: 5000 });

  // simulate app kill between the 'rewarded' resolution and UI continuation (§9.7.5)
  await page.reload();
  await page.waitForFunction(() => '__cascade' in window);
  await expect(page.locator('#hud')).toBeVisible();
  const state = await getGameState(page);
  expect(state?.['continueUsed']).toBe(true);
  expect(state?.['over']).toBe(false);
  expect(state?.['score']).toBe(600); // reward clears award NO points (§9.3.1)
  // the 2 fullest rows were cleared: bottom two rows are emptier now
  const board = state?.['board'] as number[];
  const row7 = board.slice(56, 64).filter((c) => c !== 0).length;
  expect(row7).toBeLessThan(6);
});

test('continue declined: normal game over, no grant', async ({ page }) => {
  await seedProfile(page, { best: 1000 });
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();
  await injectEligibleRun(page);
  await forceGameOver(page);
  await page.locator('[data-testid="continue-decline"]').click();
  await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
});

test('interstitial shows on cadence and offers the remove-ads line after close', async ({ page }) => {
  await seedProfile(page, {
    monetization: {
      totalGamesCompleted: 5,
      gameOversSinceInterstitial: 1,
      lastInterstitialAt: null,
      interstitialDates: [],
      removeAdsOwned: false,
      lastStreakRepairWeek: null,
      secondTryDate: null,
    },
  });
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();
  await injectState(page, { score: 10 }); // below continue threshold → no offer
  await forceGameOver(page);

  await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
  // interstitial only AFTER the score presentation (§9.2)
  await expect(page.locator('[data-testid="fake-ad-interstitial"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-testid="ad-close"]')).toBeVisible({ timeout: 5000 });
  await page.locator('[data-testid="ad-close"]').click();
  await expect(page.locator('[data-testid="post-ad-removeads"]')).toBeVisible();
});

test('grace period: a brand-new profile sees no interstitial', async ({ page }) => {
  await seedProfile(page); // fresh monetization state
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();
  await injectState(page, { score: 10 });
  await forceGameOver(page);
  await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
  await page.waitForTimeout(2500); // longer than score presentation + decision point
  await expect(page.locator('[data-testid="fake-ad-interstitial"]')).toHaveCount(0);
});

test('remove ads owned: zero interstitials, continue still offered and granted ad-free', async ({ page }) => {
  await seedProfile(page, {
    best: 1000,
    monetization: {
      totalGamesCompleted: 10,
      gameOversSinceInterstitial: 5,
      lastInterstitialAt: null,
      interstitialDates: [],
      removeAdsOwned: true,
      lastStreakRepairWeek: null,
      secondTryDate: null,
    },
  });
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();
  await injectEligibleRun(page);
  await forceGameOver(page);

  // continue offered ad-free (§9.5: rewarded features stay, granted without an ad)
  await expect(page.locator('[data-testid="continue-watch"]')).toContainText('ad-free');
  await page.locator('[data-testid="continue-watch"]').click();
  await expect(page.locator('[data-testid="fake-ad-rewarded"]')).toHaveCount(0);
  await expect(page.locator('#hud')).toBeVisible();
  const state = await getGameState(page);
  expect(state?.['continueUsed']).toBe(true);

  // and the next game over shows no interstitial
  await forceGameOver(page);
  await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.locator('[data-testid="fake-ad-interstitial"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="noads-pill"]')).toHaveCount(0);
});

test('purchase remove ads from settings persists and disables the button', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);
  await page.locator('[data-testid="settings"]').click();
  await page.locator('[data-testid="remove-ads"]').click();
  await expect(page.locator('#toast')).toHaveClass(/show/);

  await page.reload();
  await page.waitForFunction(() => '__cascade' in window);
  await page.locator('[data-testid="settings"]').click();
  await expect(page.locator('[data-testid="remove-ads"]')).toBeDisabled();
  const mon = await page.evaluate(() => JSON.parse(localStorage.getItem('cascade:monetization.v1') ?? '{}'));
  expect(mon.removeAdsOwned).toBe(true);
});

test('banner slot is reserved on the game screen and never overlaps the tray', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();
  const slot = page.locator('#banner-slot');
  await expect(slot).toHaveClass(/reserved/);
  const geom = await page.evaluate(() => {
    const w = window as never as {
      __cascade: { canvasOffset(): { x: number; y: number }; trayRect(i: number): { y: number; h: number } | null };
    };
    const off = w.__cascade.canvasOffset();
    const tray = w.__cascade.trayRect(2);
    const banner = document.getElementById('banner-slot')?.getBoundingClientRect();
    return { trayBottom: tray ? off.y + tray.y + tray.h : null, bannerTop: banner?.top ?? null };
  });
  expect(geom.trayBottom).not.toBeNull();
  expect(geom.bannerTop).not.toBeNull();
  expect(geom.trayBottom as number).toBeLessThanOrEqual(geom.bannerTop as number);
});

// §9.7.3 — ad failure matrix for the two remaining rewarded placements.
for (const behavior of ['unavailable', 'dismiss', 'throw'] as const) {
  test(`streak repair ad failure (${behavior}): home stays interactive, no repair, budget kept`, async ({ page }) => {
    await seedProfile(page, {
      daily: { streak: 6, lastPlayedDate: '20260608', bestByDate: {}, secondTryUsedDate: null },
    });
    await gotoTest(page);
    await setToday(page, '20260610'); // broke yesterday only (last played the 8th)
    await goHome(page);
    await setAdBehavior(page, behavior);
    await page.locator('[data-testid="streak-repair"]').click();

    // failure path lands straight back home; the offer is NOT consumed (§9.1)
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    await expect(page.locator('[data-testid="streak-repair"]')).toBeVisible();
    const daily = await page.evaluate(() => JSON.parse(localStorage.getItem('cascade:daily.v1') ?? '{}'));
    expect(daily.lastPlayedDate).toBe('20260608'); // no repair applied
    const director = await directorState(page);
    expect(director['lastStreakRepairWeek']).toBeNull(); // weekly budget not consumed
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cascade:monetization.v1') ?? '{}'));
    expect(stored.lastStreakRepairWeek ?? null).toBeNull();
    // home remains fully interactive: starting a run still works
    await page.locator('[data-testid="play"]').click();
    await expect(page.locator('#hud')).toBeVisible();
  });

  test(`daily second try ad failure (${behavior}): game over stays responsive, try not consumed`, async ({ page }) => {
    await seedProfile(page);
    await gotoTest(page);
    await setToday(page, '20260610');
    await page.locator('[data-testid="daily"]').click();
    await expect(page.locator('#hud')).toBeVisible();
    await forceGameOver(page);
    await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
    await setAdBehavior(page, behavior);
    await page.locator('[data-testid="second-try"]').click();

    // no reward → no replay run may start
    await page.waitForTimeout(1500);
    await expect(page.locator('#hud')).not.toBeVisible();
    await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
    await expect(page.locator('[data-testid="replay"]')).toBeEnabled();
    const director = await directorState(page);
    expect(director['secondTryDate']).toBeNull(); // daily budget not consumed
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cascade:monetization.v1') ?? '{}'));
    expect(stored.secondTryDate).toBeNull();
  });
}

for (const behavior of ['unavailable', 'throw'] as const) {
  test(`interstitial failure (${behavior}): due ad is skipped silently, UI never blocks`, async ({ page }) => {
    await seedProfile(page, {
      monetization: {
        totalGamesCompleted: 5,
        gameOversSinceInterstitial: 1,
        lastInterstitialAt: null,
        interstitialDates: [],
        removeAdsOwned: false,
        lastStreakRepairWeek: null,
        secondTryDate: null,
      },
    });
    await gotoTest(page);
    await page.locator('[data-testid="play"]').click();
    await injectState(page, { score: 10 }); // below continue threshold → no offer
    await setAdBehavior(page, behavior);
    await forceGameOver(page);

    await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
    // past the score presentation + interstitial decision point: nothing rendered
    await page.waitForTimeout(2500);
    await expect(page.locator('[data-testid="fake-ad-interstitial"]')).toHaveCount(0);
    const mon = await page.evaluate(() => JSON.parse(localStorage.getItem('cascade:monetization.v1') ?? '{}'));
    expect(mon.lastInterstitialAt).toBeNull(); // never recorded as shown
    // a DUE-but-failed interstitial logs the §9.2 'skipped' signal with the reason
    const events = await page.evaluate(
      () => JSON.parse(localStorage.getItem('cascade:events.v1') ?? '[]') as Array<{ name: string; data?: { reason?: string } }>,
    );
    expect(events.filter((e) => e.name === 'interstitial_shown')).toHaveLength(0);
    const skipped = events.filter((e) => e.name === 'interstitial_skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.data?.reason).toBe('unavailable'); // 'throw' is caught → 'unavailable' (§9.1)
    // game-over screen stays fully responsive
    await page.locator('[data-testid="replay"]').click();
    await expect(page.locator('#hud')).toBeVisible();
  });
}

test('daily second try: offered once, replays the same seed, best of two counts', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);
  await page.evaluate(() => (window as never as { __cascade: { setToday(k: string): void } }).__cascade.setToday('20260610'));
  await page.locator('[data-testid="daily"]').click();
  await expect(page.locator('#hud')).toBeVisible();
  const tray1 = (await getGameState(page))?.['tray'];
  await forceGameOver(page);
  await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
  await page.locator('[data-testid="second-try"]').click();
  await expect(page.locator('[data-testid="fake-ad-rewarded"]')).toBeVisible();
  await expect(page.locator('#hud')).toBeVisible({ timeout: 6000 });
  const tray2 = (await getGameState(page))?.['tray'];
  expect(tray2).toEqual(tray1); // same seed (§9.3.3)
  // second try consumed → not offered again today
  await forceGameOver(page);
  await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
  await expect(page.locator('[data-testid="second-try"]')).toHaveCount(0);
});

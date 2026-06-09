// §7.3.4 — daily challenge: seeded run, streak increments once per simulated day,
// resets after a skipped day (mocked clock via test hooks).
import { test, expect, seedProfile, gotoTest, getGameState } from './helpers';
import type { Page } from '@playwright/test';

async function setToday(page: Page, key: string): Promise<void> {
  await page.evaluate(
    (k) => (window as never as { __cascade: { setToday(k: string): void } }).__cascade.setToday(k),
    key,
  );
}
async function finishDaily(page: Page): Promise<void> {
  await page.locator('[data-testid="daily"]').click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.evaluate(() => (window as never as { __cascade: { forceGameOver(): void } }).__cascade.forceGameOver());
  await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
  await page.locator('[data-testid="gameover-home"]').click();
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
}

test('daily run uses the date seed and is deterministic', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);
  await setToday(page, '20260610');
  await page.locator('[data-testid="daily"]').click();
  await expect(page.locator('#hud')).toBeVisible();
  const tray1 = (await getGameState(page))?.['tray'];

  // restart the same daily → identical seeded tray (fixed piece sequence §4.2)
  await page.evaluate(() => (window as never as { __cascade: { newGame(m: string): void } }).__cascade.newGame('daily'));
  const tray2 = (await getGameState(page))?.['tray'];
  expect(tray2).toEqual(tray1);
});

test('streak increments per day and resets after a skipped day', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);

  await setToday(page, '20260610');
  await finishDaily(page);
  await expect(page.locator('[data-screen="home"]')).toContainText('1');

  await setToday(page, '20260611');
  await page.evaluate(() => (window as never as { __cascade: { goHome(): void } }).__cascade.goHome());
  await finishDaily(page);
  const daily = await page.evaluate(() => JSON.parse(localStorage.getItem('cascade:daily.v1') ?? '{}'));
  expect(daily.streak).toBe(2);

  // same-day replay is blocked (§4.2: one seeded run per day) → no run starts,
  // a toast explains, and the streak cannot double-increment
  await page.evaluate(() => (window as never as { __cascade: { goHome(): void } }).__cascade.goHome());
  await page.locator('[data-testid="daily"]').click();
  await expect(page.locator('#toast')).toHaveClass(/show/);
  await page.waitForTimeout(1000);
  await expect(page.locator('#hud')).not.toBeVisible();
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  const dailyReplay = await page.evaluate(() => JSON.parse(localStorage.getItem('cascade:daily.v1') ?? '{}'));
  expect(dailyReplay.streak).toBe(2);

  // skip 20260612 → streak shows 0 and repair offer appears (broke yesterday only)
  await setToday(page, '20260613');
  await page.evaluate(() => (window as never as { __cascade: { goHome(): void } }).__cascade.goHome());
  await expect(page.locator('[data-testid="streak-repair"]')).toBeVisible();

  // play today → streak restarts at 1
  await finishDaily(page);
  const daily2 = await page.evaluate(() => JSON.parse(localStorage.getItem('cascade:daily.v1') ?? '{}'));
  expect(daily2.streak).toBe(1);
});

test('streak repair restores the streak after watching a rewarded ad', async ({ page }) => {
  await seedProfile(page, {
    daily: { streak: 6, lastPlayedDate: '20260608', bestByDate: {}, secondTryUsedDate: null },
  });
  await gotoTest(page);
  await setToday(page, '20260610'); // broke yesterday (last played the 8th, today the 10th)
  await page.evaluate(() => (window as never as { __cascade: { goHome(): void } }).__cascade.goHome());
  await page.locator('[data-testid="streak-repair"]').click();
  await expect(page.locator('[data-testid="fake-ad-rewarded"]')).toBeVisible();
  // rewarded fake ad auto-completes after the countdown; the repair is applied only then
  await expect(page.locator('[data-testid="fake-ad-rewarded"]')).toHaveCount(0, { timeout: 6000 });
  const daily = await page.evaluate(() => JSON.parse(localStorage.getItem('cascade:daily.v1') ?? '{}'));
  expect(daily.lastPlayedDate).toBe('20260609'); // as if yesterday was played (§9.3.2)
  await expect(page.locator('[data-screen="home"]')).toContainText('6');
});

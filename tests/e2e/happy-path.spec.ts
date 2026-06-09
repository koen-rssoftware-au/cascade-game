// §7.3.1 — full happy path: home → play → drag-place 3 pieces → score updates →
// pause/resume → force game over via injected state → replay.
import { test, expect, seedProfile, gotoTest, injectState, getGameState, dragTrayToCell } from './helpers';

test('full happy path', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);

  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await page.locator('[data-testid="play"]').click();
  await expect(page.locator('#hud')).toBeVisible();

  // Controlled state: empty board, known tray.
  await injectState(page, {
    tray: [
      { pieceId: 'P1', color: 1 },
      { pieceId: 'P2', color: 2 },
      { pieceId: 'P4', color: 3 },
    ],
  });

  await dragTrayToCell(page, 0, 0, 0); // P1 at (0,0): +1
  let state = await getGameState(page);
  expect(state?.['score']).toBe(1);

  await dragTrayToCell(page, 1, 2, 0); // P2 at (2,0)-(3,0): +2
  state = await getGameState(page);
  expect(state?.['score']).toBe(3);

  await dragTrayToCell(page, 2, 4, 2); // P4 at (4,2)-(6,2): +3
  state = await getGameState(page);
  expect(state?.['score']).toBe(6);
  // tray consumed → engine refilled all 3 slots
  const tray = state?.['tray'] as Array<unknown | null>;
  expect(tray.filter((t) => t !== null)).toHaveLength(3);

  // score visible in HUD (ticks up; wait for it to settle)
  await expect(page.locator('#hud-score')).toHaveText('6');

  // pause / resume
  await page.locator('[data-testid="pause"]').click();
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await page.locator('[data-testid="resume"]').click();
  await expect(page.locator('[data-screen="pause"]')).toHaveCount(0);

  // force game over via injected state (score below continue threshold)
  await page.evaluate(() => (window as never as { __cascade: { forceGameOver(): void } }).__cascade.forceGameOver());
  await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
  await expect(page.locator('[data-testid="final-score"]')).toHaveText('6');

  // replay: fresh run, reachable in a single tap, < 1s (§2.7)
  const t0 = Date.now();
  await page.locator('[data-testid="replay"]').click();
  await expect(page.locator('#hud')).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(1000);
  state = await getGameState(page);
  expect(state?.['score']).toBe(0);
  expect((state?.['board'] as number[]).every((c) => c === 0)).toBe(true);
});

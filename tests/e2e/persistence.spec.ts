// §7.3.3 — refresh mid-game restores identical board/score/tray.
import { test, expect, seedProfile, gotoTest, injectState, getGameState, dragTrayToCell } from './helpers';

test('refresh mid-game restores identical state', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();
  await injectState(page, {
    tray: [
      { pieceId: 'P10', color: 4 },
      { pieceId: 'P2', color: 2 },
      { pieceId: 'P4', color: 3 },
    ],
  });
  await dragTrayToCell(page, 0, 1, 1); // P10 (2×2) at (1,1): +4
  await dragTrayToCell(page, 1, 5, 5); // P2 at (5,5): +2

  const before = await getGameState(page);
  expect(before?.['score']).toBe(6);

  await page.reload();
  await page.waitForFunction(() => '__cascade' in window);

  // restores straight into the run (no home screen detour for state loss)
  await expect(page.locator('#hud')).toBeVisible();
  const after = await getGameState(page);
  expect(after).toEqual(before);
  await expect(page.locator('#hud-score')).toHaveText('6');
});

// §7.3.2 — drag cancel: drop on an illegal cell returns the piece to the tray,
// board unchanged.
import { test, expect, seedProfile, gotoTest, injectState, getGameState, dragTrayToCell, dragTrayToPoint } from './helpers';

test('illegal drop returns piece to tray and leaves board unchanged', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();

  const board = new Array<number>(64).fill(0);
  board[0] = 5; // (0,0) occupied
  await injectState(page, {
    board,
    tray: [
      { pieceId: 'P1', color: 1 },
      { pieceId: 'P10', color: 2 },
      { pieceId: 'P4', color: 3 },
    ],
  });
  const before = await getGameState(page);

  // Drop P1 exactly on the occupied cell → illegal → cancel.
  await dragTrayToCell(page, 0, 0, 0);
  let after = await getGameState(page);
  expect(after).toEqual(before);

  // Drop far off the board (on the HUD area) → cancel.
  await dragTrayToPoint(page, 0, 10, 10);
  after = await getGameState(page);
  expect(after).toEqual(before);

  // The piece is still usable afterwards: place it legally now.
  await dragTrayToCell(page, 0, 3, 3);
  after = await getGameState(page);
  expect(after?.['score']).toBe(1);
});

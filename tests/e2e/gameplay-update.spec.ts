// Gameplay update e2e: tap-to-rotate, one-per-run undo, legacy save migration.
import { test, expect, seedProfile, gotoTest, injectState, getGameState, dragTrayToCell } from './helpers';
import type { Page } from '@playwright/test';

async function tapTraySlot(page: Page, i: number): Promise<void> {
  const pt = await page.evaluate((slot) => {
    const w = window as never as {
      __cascade: {
        canvasOffset(): { x: number; y: number };
        trayRect(i: number): { x: number; y: number; w: number; h: number } | null;
      };
    };
    const off = w.__cascade.canvasOffset();
    const tray = w.__cascade.trayRect(slot);
    if (!tray) return null;
    return { x: off.x + tray.x + tray.w / 2, y: off.y + tray.y + tray.h / 2 };
  }, i);
  if (!pt) throw new Error(`tray slot ${i} empty`);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.up(); // quick tap, no movement → rotate
}

test('tap rotates a tray piece and the rotated shape places correctly', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();
  await injectState(page, {
    tray: [
      { pieceId: 'P4', color: 3 }, // 1×3 horizontal
      { pieceId: 'P2', color: 2 },
      { pieceId: 'P10', color: 4 },
    ],
  });

  await tapTraySlot(page, 0);
  let state = await getGameState(page);
  expect((state?.['tray'] as Array<{ rot: number }>)[0]?.rot).toBe(1);

  // four taps cycle back to the catalog orientation
  await tapTraySlot(page, 0);
  await tapTraySlot(page, 0);
  await tapTraySlot(page, 0);
  state = await getGameState(page);
  expect((state?.['tray'] as Array<{ rot: number }>)[0]?.rot).toBe(0);

  // rotate once and place vertically at column 7 (horizontal would not matter here,
  // but the placed cells prove the vertical shape was used)
  await tapTraySlot(page, 0);
  await dragTrayToCell(page, 0, 7, 0);
  state = await getGameState(page);
  const board = state?.['board'] as number[];
  expect(board[7]).toBe(3); // (7,0)
  expect(board[15]).toBe(3); // (7,1)
  expect(board[23]).toBe(3); // (7,2)
  expect(state?.['score']).toBe(3);
});

test('a slow, stationary press rotates — it never places the piece', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();
  await injectState(page, {
    tray: [
      { pieceId: 'P5', color: 2 },
      { pieceId: 'P2', color: 3 },
      { pieceId: 'P10', color: 4 },
    ],
  });
  const pt = await page.evaluate(() => {
    const w = window as never as {
      __cascade: { canvasOffset(): { x: number; y: number }; trayRect(i: number): { x: number; y: number; w: number; h: number } | null };
    };
    const off = w.__cascade.canvasOffset();
    const tray = w.__cascade.trayRect(0);
    return tray ? { x: off.x + tray.x + tray.w / 2, y: off.y + tray.y + tray.h / 2 } : null;
  });
  if (!pt) throw new Error('tray empty');
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.waitForTimeout(400); // slow press — used to fall through to a drop
  await page.mouse.up();
  const state = await getGameState(page);
  expect((state?.['board'] as number[]).every((c) => c === 0)).toBe(true); // nothing placed
  expect((state?.['tray'] as Array<{ rot: number }>)[0]?.rot).toBe(1); // rotated instead
  expect(state?.['score']).toBe(0);
});

test('rotation survives a refresh', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();
  await injectState(page, {
    tray: [
      { pieceId: 'P19', color: 8 },
      { pieceId: 'P2', color: 2 },
      { pieceId: 'P10', color: 4 },
    ],
  });
  await tapTraySlot(page, 0);
  await page.reload();
  await page.waitForFunction(() => '__cascade' in window);
  const state = await getGameState(page);
  expect((state?.['tray'] as Array<{ rot: number }>)[0]?.rot).toBe(1);
});

test('undo restores the pre-placement state once per run', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();
  await injectState(page, {
    tray: [
      { pieceId: 'P10', color: 4 },
      { pieceId: 'P2', color: 2 },
      { pieceId: 'P1', color: 1 },
    ],
  });
  const undoBtn = page.locator('[data-testid="undo"]');
  await expect(undoBtn).toBeDisabled(); // no placement yet

  const before = await getGameState(page);
  await dragTrayToCell(page, 0, 2, 2);
  const placed = await getGameState(page);
  expect(placed?.['score']).toBe(4);
  await expect(undoBtn).toBeEnabled();

  await undoBtn.click();
  const restored = await getGameState(page);
  expect(restored).toEqual(before);
  await expect(undoBtn).toBeDisabled(); // one per run

  // a further placement does not re-arm the undo this run
  await dragTrayToCell(page, 0, 2, 2);
  await expect(undoBtn).toBeDisabled();

  // the spent undo survives refresh
  await page.reload();
  await page.waitForFunction(() => '__cascade' in window);
  await expect(page.locator('[data-testid="undo"]')).toBeDisabled();

  // ...and a fresh run re-arms it after the first placement
  await page.evaluate(() => (window as never as { __cascade: { newGame(m: string): void } }).__cascade.newGame('normal'));
  await injectState(page, {
    tray: [
      { pieceId: 'P1', color: 1 },
      { pieceId: 'P2', color: 2 },
      { pieceId: 'P4', color: 3 },
    ],
  });
  await dragTrayToCell(page, 0, 0, 0);
  await expect(page.locator('[data-testid="undo"]')).toBeEnabled();
});

test('legacy (pre-update) saved runs still load', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);
  // a v1 save: the raw GameState JSON, tray slots without rot
  await page.evaluate(() => {
    const board = new Array(64).fill(0);
    board[0] = 5;
    localStorage.setItem(
      'cascade:run.v1',
      JSON.stringify({
        board,
        tray: [{ pieceId: 'P4', color: 7 }, null, { pieceId: 'P11', color: 2 }],
        score: 42,
        streak: 1,
        maxChain: 2,
        placements: 5,
        continueUsed: false,
        rngState: 777,
        mode: 'normal',
        dailyDate: null,
        over: false,
      }),
    );
  });
  await page.reload();
  await page.waitForFunction(() => '__cascade' in window);
  await expect(page.locator('#hud')).toBeVisible();
  const state = await getGameState(page);
  expect(state?.['score']).toBe(42);
  expect((state?.['tray'] as Array<{ rot: number } | null>)[0]?.rot).toBe(0);
});

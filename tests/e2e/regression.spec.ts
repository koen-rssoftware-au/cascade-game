// Regression pins for two fixed bugs:
// (a) a stale cascade timeline from an abandoned run replayed over the next run;
// (b) a run killed between the game-ending placement and the game-over commit
//     silently lost its score on the next boot (§7.5 kill-proofness).
import { test, expect, seedProfile, gotoTest, injectState, getGameState, dragTrayToCell } from './helpers';

test('stale timeline: abandoning a run mid-cascade never leaks into the next run', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);
  await page.locator('[data-testid="play"]').click();
  await expect(page.locator('#hud')).toBeVisible();

  // Chain-2 fixture: P1 at (7,7) completes row 7; gravity drops rows 5/6 and the
  // lone (7,4) block into row 7, which fills it again → second clear (chain 2).
  const board = new Array<number>(64).fill(0);
  for (let c = 0; c < 7; c++) {
    board[5 * 8 + c] = 5;
    board[6 * 8 + c] = 6;
    board[7 * 8 + c] = 3;
  }
  board[4 * 8 + 7] = 7; // col 7, row 4
  await injectState(page, {
    board,
    tray: [
      { pieceId: 'P1', color: 3 },
      { pieceId: 'P3', color: 2 },
      { pieceId: 'P10', color: 4 },
    ],
  });
  await dragTrayToCell(page, 0, 7, 7); // kicks off the multi-step cascade animation

  // Immediately abandon the run and start a new one while the timeline is mid-flight.
  await page.evaluate(() => {
    const w = window as never as { __cascade: { goHome(): void; newGame(m: string): void } };
    w.__cascade.goHome();
    w.__cascade.newGame('normal');
  });
  await page.waitForTimeout(500); // the stale timeline would have replayed by now

  // The new run is pristine: empty board, zero score, fully playable HUD —
  // previously the old run's cascade replayed over the new board here.
  await expect(page.locator('#hud')).toBeVisible();
  const state = await getGameState(page);
  expect(state?.['score']).toBe(0);
  expect((state?.['board'] as number[]).every((c) => c === 0)).toBe(true);
  // zero console errors is asserted by the helpers watchdog on teardown
});

test('game-over commit recovery: a kill before the commit still records the score', async ({ page }) => {
  await seedProfile(page); // best 0
  await gotoTest(page);

  // Persist a valid over:true run, exactly as saved by the game-ending placement
  // right before the app was killed (before the game-over commit could run).
  await page.evaluate(() => {
    // Diagonal of isolated single holes: no full lines (every row AND column has
    // a gap), and none of the 2+-cell tray pieces fits → over:true is consistent.
    const board: number[] = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        board.push(col === row ? 0 : ((row * 8 + col) % 7) + 1);
      }
    }
    const state = {
      board,
      tray: [
        { pieceId: 'P2', color: 2 },
        { pieceId: 'P3', color: 3 },
        { pieceId: 'P10', color: 4 },
      ],
      score: 250,
      streak: 0,
      maxChain: 2,
      placements: 30,
      continueUsed: false,
      rngState: 123456789,
      mode: 'normal',
      dailyDate: null,
      over: true,
    };
    localStorage.setItem('cascade:run.v1', JSON.stringify(state));
  });
  await page.reload();
  await page.waitForFunction(() => '__cascade' in window);

  // Boot recovery runs the full game-over flow instead of discarding the run.
  await expect(page.locator('[data-screen="gameover"]')).toBeVisible();
  await expect(page.locator('[data-testid="final-score"]')).toHaveText('250');
  const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('cascade:stats.v1') ?? '{}'));
  expect(stats.best).toBe(250); // the killed run's score was committed
  const run = await page.evaluate(() => localStorage.getItem('cascade:run.v1'));
  expect(run).toBeNull(); // committed run is cleared — no double commit on next boot
});

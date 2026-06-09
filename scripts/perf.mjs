// §7.4 performance checks against the built bundle (vite preview must be running on :4173):
//  1. fps under 4× CPU throttle during a 20-cascade stress scene (must stay ≥ 30)
//  2. JS heap growth across 30 consecutive games (must stay < 10 MB)
// Usage: node scripts/perf.mjs
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:4173/?test=1';

function chain2Board() {
  const b = new Array(64).fill(0);
  for (let c = 0; c < 7; c++) b[7 * 8 + c] = 3;
  for (let c = 0; c < 7; c++) {
    b[5 * 8 + c] = 5;
    b[6 * 8 + c] = 6;
  }
  b[4 * 8 + 7] = 7;
  return b;
}

async function boot(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'cascade:stats.v1',
      JSON.stringify({ best: 0, maxChainEver: 0, tutorialDone: true, firstSessionAt: 1 }),
    );
  });
  await page.goto(BASE);
  await page.waitForFunction(() => '__cascade' in window);
  await page.evaluate(() => {
    // suppress interstitials so the loop is not gated on fake-ad UI
    window.__cascade.config.gameOversPerInterstitial = 9_999_999;
  });
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const cdp = await page.context().newCDPSession(page);

  // ---------- 1) fps under 4× CPU throttle, 20 cascade resolutions ----------
  await boot(page);
  await page.evaluate(() => window.__cascade.newGame('normal'));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await page.evaluate(() => {
    window.__frames = 0;
    const count = () => {
      window.__frames++;
      requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
  });

  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    await page.evaluate((board) => {
      window.__cascade.injectState(
        JSON.stringify({
          board,
          tray: [
            { pieceId: 'P1', color: 1 },
            { pieceId: 'P3', color: 2 },
            { pieceId: 'P10', color: 4 },
          ],
          score: 0,
          streak: 0,
          maxChain: 0,
          placements: 0,
          continueUsed: false,
          rngState: 42,
          mode: 'normal',
          dailyDate: null,
          over: false,
        }),
      );
      window.__cascade.place(0, 7, 7); // triggers clear → fall → chain-2 clear → fall + particles
    }, chain2Board());
    await page.waitForTimeout(820); // let the full cascade animation + particles play
  }
  const seconds = (Date.now() - t0) / 1000;
  const frames = await page.evaluate(() => window.__frames);
  const fps = frames / seconds;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(`[fps] ${frames} frames in ${seconds.toFixed(1)}s under 4x throttle → ${fps.toFixed(1)} fps`);

  // ---------- 2) heap growth across 30 games ----------
  await boot(page);
  await cdp.send('HeapProfiler.enable');

  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(150);
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
  };
  await cdp.send('Performance.enable');

  // warm-up game so one-time allocations (audio buffers, layouts) are excluded
  await page.evaluate(() => window.__cascade.newGame('normal'));
  await page.evaluate(() => window.__cascade.place(0, 0, 0));
  await page.waitForTimeout(400);

  const before = await heap();
  for (let g = 0; g < 30; g++) {
    await page.evaluate((board) => {
      window.__cascade.newGame('normal');
      window.__cascade.injectState(
        JSON.stringify({
          board,
          tray: [
            { pieceId: 'P1', color: 1 },
            { pieceId: 'P3', color: 2 },
            { pieceId: 'P10', color: 4 },
          ],
          score: 0,
          streak: 0,
          maxChain: 0,
          placements: 0,
          continueUsed: false,
          rngState: 42,
          mode: 'normal',
          dailyDate: null,
          over: false,
        }),
      );
      window.__cascade.place(0, 7, 7);
    }, chain2Board());
    await page.waitForTimeout(850); // full cascade animation
    await page.evaluate(() => window.__cascade.forceGameOver());
    await page.waitForTimeout(250);
  }
  const after = await heap();
  const growthMb = (after - before) / 1024 / 1024;
  console.log(
    `[heap] before=${(before / 1048576).toFixed(1)}MB after=${(after / 1048576).toFixed(1)}MB growth=${growthMb.toFixed(2)}MB over 30 games`,
  );

  await browser.close();

  const fpsPass = fps >= 30;
  const heapPass = growthMb < 10;
  console.log(`[result] fps ${fpsPass ? 'PASS' : 'FAIL'} (≥30 required), heap ${heapPass ? 'PASS' : 'FAIL'} (<10MB required)`);
  process.exit(fpsPass && heapPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

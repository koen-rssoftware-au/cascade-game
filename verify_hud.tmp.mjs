import { chromium } from '@playwright/test';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const root = '/Users/koen/Cascade gamee/dist';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = createServer((req, res) => {
  let p = join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise(r => srv.listen(4199, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
await page.goto('http://localhost:4199/');
await page.waitForSelector('[data-testid="undo"]', { timeout: 10000, state: 'attached' });

const result = await page.evaluate(() => {
  const hud = document.getElementById('hud');
  hud.classList.add('visible');
  const score = document.getElementById('hud-score');
  const best = document.getElementById('hud-best');
  const undo = document.querySelector('[data-testid="undo"]');
  undo.disabled = false; // simulate enabled state mid-run
  const out = {};
  for (const digits of ['9,999', '99,999', '118,600']) {
    score.textContent = digits;
    best.textContent = 'Best ' + digits;
    const u = undo.getBoundingClientRect();
    const s = score.getBoundingClientRect();
    const overlap = Math.max(0, Math.min(u.right, s.right) - Math.max(u.left, s.left));
    // hit-test a point on the leftmost digit of the score, vertically centered
    const px = s.left + 5, py = s.top + s.height / 2;
    const hit = document.elementFromPoint(px, py);
    out[digits] = {
      undo: { left: u.left, right: u.right },
      score: { left: s.left, right: s.right, top: s.top, bottom: s.bottom },
      overlapPx: overlap,
      hitAt: { x: px, y: py, tag: hit?.tagName, testid: hit?.dataset?.testid ?? null },
    };
  }
  const wrapStyle = getComputedStyle(document.querySelector('.hud-score-wrap'));
  out.wrap = { position: wrapStyle.position, pointerEvents: wrapStyle.pointerEvents, zIndex: wrapStyle.zIndex };
  return out;
});
console.log(JSON.stringify(result, null, 2));

// click-through test: actually dispatch a click on the score's left digits and see if undo handler fires
await page.evaluate(() => {
  window.__undoClicked = false;
  document.querySelector('[data-testid="undo"]').addEventListener('click', () => { window.__undoClicked = true; });
  document.getElementById('hud-score').textContent = '118,600';
});
const s = await page.evaluate(() => {
  const r = document.getElementById('hud-score').getBoundingClientRect();
  return { x: r.left + 5, y: r.top + r.height / 2 };
});
await page.mouse.click(s.x, s.y);
console.log('undo handler fired after tapping score digits:', await page.evaluate(() => window.__undoClicked));

await page.screenshot({ path: '/tmp/hud_375.png', clip: { x: 0, y: 0, width: 375, height: 80 } });
await browser.close();
srv.close();

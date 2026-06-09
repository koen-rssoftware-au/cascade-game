# Cascade

Single-screen, offline, drag-and-drop block puzzle for mobile. Place pieces on an 8×8 grid,
clear full rows/columns — and after a clear, blocks **fall**, so new lines can complete and
chain ("cascades"). Built per [docs/cascade-game-scope.md](docs/cascade-game-scope.md);
verification report in [VERIFICATION.md](VERIFICATION.md).

**Play it:** https://koen-rssoftware-au.github.io/cascade-game/

## Install on your phone (PWA)

- **Android (Chrome):** open the link → menu (⋮) → *Add to Home screen* / *Install app*.
- **iPhone (Safari):** open the link → Share button (□↑) → *Add to Home Screen*.

After the first load the game works fully offline. Progress, high score and daily streak are
saved on the device.

## Development

```bash
npm install
npm run dev        # dev server
npm test           # unit + simulation suites (Vitest)
npm run test:e2e   # Playwright e2e on Pixel 7 + iPhone 14 profiles (builds first)
npm run build      # typecheck + production bundle (dist/)
node scripts/perf.mjs   # §7.4 fps/heap checks (needs `npx vite preview --port 4173`)
bash scripts/deploy.sh  # deploy dist/ to GitHub Pages (gh-pages branch)
```

Useful URLs: `?test=1` exposes `window.__cascade` test hooks and visible mock ads;
`?debug=1` adds the runtime MonetizationConfig panel and visible mock ads.

## Architecture

- `src/engine/` — pure rules engine, zero DOM imports, all randomness through one seeded RNG
  (mulberry32). Serializable mid-run, deterministic daily seeds (`FNV-1a(YYYYMMDD)`).
- `src/monetization/` — `AdProvider`/`Purchases` interfaces with mock implementations,
  pure `MonetizationDirector` (all ad policy), event log. Swap in real SDKs in v1.1 without
  touching game code.
- `src/app/` — canvas renderer + animation timeline, pointer input, DOM overlay screens,
  Web-Audio-synthesized sound, haptics, persistence, daily challenge.
- `src/sim/` — random/greedy agents for the 10,000-game soak suite.

Later store distribution: wrap with Capacitor; storage already sits behind a `Storage`
interface and the ad/IAP layers behind injectable interfaces.

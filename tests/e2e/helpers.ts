// Shared e2e utilities: console-error watchdog fixture, profile seeding,
// state injection, and deterministic canvas drags via the ?test=1 hooks.
import { test as base, expect, type Page } from '@playwright/test';

export interface ConsoleErrors {
  errors: string[];
}

/** Every test gets a console/pageerror watchdog; suite asserts zero errors (§7.3). */
export const test = base.extend<{ consoleErrors: ConsoleErrors }>({
  consoleErrors: [
    async ({ page }, use) => {
      const collected: ConsoleErrors = { errors: [] };
      page.on('console', (msg) => {
        if (msg.type() === 'error') collected.errors.push(msg.text());
      });
      page.on('pageerror', (err) => collected.errors.push(String(err)));
      await use(collected);
      expect(collected.errors, 'no console errors or unhandled rejections').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export interface ProfileSeed {
  tutorialDone?: boolean;
  best?: number;
  firstSessionAt?: number | null;
  monetization?: Record<string, unknown>;
  daily?: Record<string, unknown>;
  settings?: { sound: boolean; haptics: boolean };
}

/** Pre-seed localStorage before the app boots (runs on every navigation). */
export async function seedProfile(page: Page, seed: ProfileSeed = {}): Promise<void> {
  await page.addInitScript((s) => {
    const stats = {
      best: s.best ?? 0,
      maxChainEver: 0,
      tutorialDone: s.tutorialDone ?? true,
      firstSessionAt: s.firstSessionAt === undefined ? 1 : s.firstSessionAt,
    };
    localStorage.setItem('cascade:stats.v1', JSON.stringify(stats));
    if (s.monetization) localStorage.setItem('cascade:monetization.v1', JSON.stringify(s.monetization));
    if (s.daily) localStorage.setItem('cascade:daily.v1', JSON.stringify(s.daily));
    if (s.settings) localStorage.setItem('cascade:settings.v1', JSON.stringify(s.settings));
  }, seed);
}

export async function gotoTest(page: Page, extra = ''): Promise<void> {
  await page.goto(`/?test=1${extra}`);
  await page.waitForFunction(() => '__cascade' in window);
}

export interface StateOverrides {
  board?: number[];
  tray?: Array<{ pieceId: string; color: number } | null>;
  score?: number;
  streak?: number;
  maxChain?: number;
  placements?: number;
  continueUsed?: boolean;
  rngState?: number;
  mode?: 'normal' | 'daily';
  dailyDate?: string | null;
  over?: boolean;
}

/** Build a serialized GameState (plan contract) and inject it as the current run. */
export async function injectState(page: Page, overrides: StateOverrides): Promise<void> {
  await page.evaluate((o) => {
    const state = {
      board: o.board ?? new Array(64).fill(0),
      tray: o.tray ?? [
        { pieceId: 'P1', color: 1 },
        { pieceId: 'P2', color: 2 },
        { pieceId: 'P4', color: 3 },
      ],
      score: o.score ?? 0,
      streak: o.streak ?? 0,
      maxChain: o.maxChain ?? 0,
      placements: o.placements ?? 0,
      continueUsed: o.continueUsed ?? false,
      rngState: o.rngState ?? 123456789,
      mode: o.mode ?? 'normal',
      dailyDate: o.dailyDate ?? null,
      over: o.over ?? false,
    };
    (window as never as { __cascade: { injectState(j: string): void } }).__cascade.injectState(
      JSON.stringify(state),
    );
  }, overrides);
}

export async function getGameState(page: Page): Promise<Record<string, unknown> | null> {
  const raw = await page.evaluate(
    () => (window as never as { __cascade: { getState(): string | null } }).__cascade.getState(),
  );
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

/** Drag tray piece i so its origin cell lands on (col,row), via synthetic pointer moves. */
export async function dragTrayToCell(page: Page, trayIndex: number, col: number, row: number): Promise<void> {
  const pts = await page.evaluate(
    ([i, c, r]) => {
      const w = window as never as {
        __cascade: {
          canvasOffset(): { x: number; y: number };
          trayRect(i: number): { x: number; y: number; w: number; h: number } | null;
          dragPointFor(i: number, c: number, r: number): { x: number; y: number } | null;
        };
      };
      const off = w.__cascade.canvasOffset();
      const tray = w.__cascade.trayRect(i as number);
      const drop = w.__cascade.dragPointFor(i as number, c as number, r as number);
      if (!tray || !drop) return null;
      return {
        sx: off.x + tray.x + tray.w / 2,
        sy: off.y + tray.y + tray.h / 2,
        tx: off.x + drop.x,
        ty: off.y + drop.y,
      };
    },
    [trayIndex, col, row],
  );
  if (!pts) throw new Error(`tray slot ${trayIndex} is empty`);
  await page.mouse.move(pts.sx, pts.sy);
  await page.mouse.down();
  await page.mouse.move(pts.tx, pts.ty, { steps: 8 });
  // dragPointFor is computed against the live tray slot — re-evaluate once mid-drag
  // is unnecessary because layout is static during a drag.
  await page.mouse.up();
}

/** Drop a dragged piece on an arbitrary screen point (for illegal-drop tests). */
export async function dragTrayToPoint(page: Page, trayIndex: number, x: number, y: number): Promise<void> {
  const pts = await page.evaluate((i) => {
    const w = window as never as {
      __cascade: {
        canvasOffset(): { x: number; y: number };
        trayRect(i: number): { x: number; y: number; w: number; h: number } | null;
      };
    };
    const off = w.__cascade.canvasOffset();
    const tray = w.__cascade.trayRect(i);
    if (!tray) return null;
    return { sx: off.x + tray.x + tray.w / 2, sy: off.y + tray.y + tray.h / 2 };
  }, trayIndex);
  if (!pts) throw new Error(`tray slot ${trayIndex} is empty`);
  await page.mouse.move(pts.sx, pts.sy);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
}

/** A board where only (0,0) is empty and row 7 / col 7 are empty — handy fixtures. */
export function nearFullBoard(): number[] {
  const b = new Array<number>(64).fill(1);
  b[0] = 0;
  return b;
}

/** Board with bottom row filled except one gap at (gapCol, 7). */
export function bottomRowExceptOne(gapCol: number): number[] {
  const b = new Array<number>(64).fill(0);
  for (let c = 0; c < 8; c++) if (c !== gapCol) b[7 * 8 + c] = 2;
  return b;
}

// §7.3.5 — mute toggle persists across reload.
import { test, expect, seedProfile, gotoTest } from './helpers';

test('mute toggle persists across reload', async ({ page }) => {
  await seedProfile(page);
  await gotoTest(page);

  await page.locator('[data-testid="settings"]').click();
  const toggle = page.locator('[data-testid="sound-toggle"]');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  await page.reload();
  await page.waitForFunction(() => '__cascade' in window);
  await page.locator('[data-testid="settings"]').click();
  await expect(page.locator('[data-testid="sound-toggle"]')).toHaveAttribute('aria-checked', 'false');

  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('cascade:settings.v1') ?? '{}'));
  expect(settings.sound).toBe(false);
});

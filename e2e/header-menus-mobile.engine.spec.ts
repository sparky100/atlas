/**
 * The account menu, the Settings panel and the notifications panel open
 * fully on screen on a phone (390px): both used to hang off their own button's right edge and
 * grow leftwards past the screen's left edge (the account menu by 33px —
 * a long email address plus the Theme/Density pair side by side). On a
 * phone each is now pinned to the screen with a 16px gutter each side.
 */
import { expect, test, type Page } from '@playwright/test';
import { signUp } from './fixtures/goldenPath';

async function panelBox(page: Page, toggleName: RegExp) {
  const toggle = page.getByRole('button', { name: toggleName });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panelId = await toggle.getAttribute('aria-controls');
  const panel = page.locator(`[id="${panelId ?? ''}"]`);
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  await toggle.click();
  return box;
}

for (const width of [390, 320]) {
  test(`account menu, settings and notifications fit on a ${String(width)}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await signUp(page, `headermenus${String(width)}`);

    for (const name of [/Account menu/, /^Settings$/, /^Notifications/]) {
      const box = await panelBox(page, name);
      expect(box, String(name)).not.toBeNull();
      if (!box) continue;
      expect(box.x, `${String(name)} left edge`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${String(name)} right edge`).toBeLessThanOrEqual(width);
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);

    // Shared header pattern: every control stays visible on a phone — only
    // the name beside the avatar is dropped.
    for (const name of [/^Notifications/, /^Settings$/, /Account menu/]) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
  });
}

test('on a desktop the account menu still opens under its own button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUp(page, 'headermenusdesktop');
  const toggleBox = await page.getByRole('button', { name: /Account menu/ }).boundingBox();
  const box = await panelBox(page, /Account menu/);
  expect(box && toggleBox && Math.abs(box.x + box.width - (toggleBox.x + toggleBox.width))).toBeLessThan(2);
});

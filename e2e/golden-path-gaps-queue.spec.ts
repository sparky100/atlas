/**
 * F12 step 2 golden path, click-only from Home at 1280 and 390 (keyboard
 * for the walk itself, which is the point of it): a system supporting a
 * capability with no fit rating and no criticality → Reports → Gaps → fill
 * the fit with "2" (good), then the criticality with "2" (high) → both gaps
 * read as done, and the value is on the system.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('gaps queue: walk the fit and criticality gaps with the keyboard', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'gapsqueue');

  await addCapability(page, 'Pay People');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Payroll', description: 'Pays people.', capabilityName: 'Pay People' });

  await goToModelHome(page);
  await clickNavItem(page, 'Reports');
  await page.getByRole('link', { name: 'Open Gaps' }).click();
  await expect(page.getByRole('heading', { name: 'Gaps', level: 1 })).toBeVisible();

  // Fit: one unrated capability link.
  await page.getByRole('link', { name: 'Fill: 1 system has no fit rating' }).click();
  const walk = page.getByRole('region', { name: 'Gap walk' });
  await expect(walk.getByRole('heading', { name: 'How well does Payroll fit Pay People?' })).toBeVisible();
  await page.keyboard.press('2');
  await expect(walk.getByRole('heading', { name: 'All done' })).toBeVisible();
  await expect(walk.getByText('1 filled.')).toBeVisible();
  await walk.getByRole('link', { name: 'Back to all gaps' }).click();
  await expect(page.getByText('Every capability link has a fit rating')).toBeVisible();

  // Criticality: options run critical, high, medium, low — 2 is high.
  await page.getByRole('link', { name: 'Fill: 1 system has no criticality' }).click();
  await expect(walk.getByRole('heading', { name: 'How critical is Payroll?' })).toBeVisible();
  await page.keyboard.press('2');
  await expect(walk.getByRole('heading', { name: 'All done' })).toBeVisible();
  await walk.getByRole('link', { name: 'Back to all gaps' }).click();
  await expect(page.getByText('Every system has a criticality')).toBeVisible();

  // The value is on the system itself.
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Payroll');
  await page.getByRole('link', { name: 'Payroll' }).click();
  await expect(page.getByRole('heading', { name: 'Payroll' })).toBeVisible();
  await expect(page.getByText('high', { exact: true }).first()).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

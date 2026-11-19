/**
 * Vendor support end on the roadmap — click-only from Home. Support end is an
 * outside vendor's date, not the result of a change (Simon, 2026-11-19), so a
 * system with only a support end, and no planned change, still shows it as its
 * own marker on the roadmap.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

function isoDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('a vendor support end set on a system shows as its own marker on the roadmap', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'supportend');

  await addCapability(page, 'Maintain assets');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Asset Ledger', description: 'Keeps the asset register.', capabilityName: 'Maintain assets' });

  const supportEnd = isoDateDaysFromNow(200);
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Vendor support ends').fill(supportEnd);
  await page.getByRole('button', { name: 'Save' }).click();

  await goToModelHome(page);
  await clickNavItem(page, 'Roadmap');
  await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toBeVisible();
  await expect(page.getByText('Asset Ledger').first()).toBeVisible();
  await expect(page.locator(`[title="Vendor support ends ${supportEnd}"]`).first()).toBeVisible();
});

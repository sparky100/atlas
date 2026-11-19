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

test('a system still running after its vendor support ended shows an open unsupported run; one with support still to run does not', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'unsupportedrun');

  await addCapability(page, 'Bill customers');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Legacy Billing', description: 'Still bills customers.', capabilityName: 'Bill customers' });
  const ended = isoDateDaysFromNow(-90);
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Vendor support ends').fill(ended);
  await page.getByRole('button', { name: 'Save' }).click();

  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Current Billing', description: 'Supported for a while yet.', capabilityName: 'Bill customers' });
  const future = isoDateDaysFromNow(200);
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Vendor support ends').fill(future);
  await page.getByRole('button', { name: 'Save' }).click();

  await goToModelHome(page);
  await clickNavItem(page, 'Roadmap');
  await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toBeVisible();

  // Support already ended, no end planned: an open run with words, so it is never colour alone.
  const legacyRow = page.locator('[data-system-id]').filter({ hasText: 'Legacy Billing' });
  await expect(legacyRow.getByTestId('unsupported-run')).toBeVisible();
  await expect(legacyRow.getByText(`Unsupported since ${ended}, no end planned`)).toBeVisible();
  // Support still to run: the tick only, no run.
  const currentRow = page.locator('[data-system-id]').filter({ hasText: 'Current Billing' });
  await expect(currentRow.locator(`[title="Vendor support ends ${future}"]`)).toBeVisible();
  await expect(currentRow.getByTestId('unsupported-run')).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

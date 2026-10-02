/**
 * ADR-025 (F12 step 3) golden path, click-only from Home at 1280 and 390:
 * confirm a system "Still accurate" from its own page, then another from
 * the Elements grid — each saved as a confirmation, values unchanged.
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('still accurate: confirm a system from its page and another from the grid', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'stillaccurate');

  // From the element page.
  await addSystemFromHome(page, { name: 'Payroll', description: 'Pays people.' });
  await expect(page.getByRole('heading', { name: 'Payroll' })).toBeVisible();
  await page.getByRole('button', { name: '✓ Still accurate' }).click();
  await expect(page.getByText('Confirmed Payroll still accurate')).toBeVisible();
  // Its values are unchanged.
  await expect(page.getByText('Pays people.').first()).toBeVisible();

  // From the Elements grid.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Ledger', description: 'The general ledger.' });
  await goToModelHome(page);
  await clickNavItem(page, 'Elements');
  await page.getByRole('button', { name: 'Edit in grid' }).click();
  await page.getByRole('button', { name: 'Confirm Ledger still accurate' }).click();
  await expect(page.getByText('Confirmed Ledger still accurate')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

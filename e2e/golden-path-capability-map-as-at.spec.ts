/**
 * Capability map "View as at", click-only from Home at 1280 and 390: a system
 * supporting a capability → Capability map → View as at 1 year → the page says it
 * is read-only and the capability is still there → back to Today clears it.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('capability map: view as at a future date', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'mapasat');

  await addCapability(page, 'Pay People');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Payroll', description: 'Pays people.', capabilityName: 'Pay People' });

  await goToModelHome(page);
  await clickNavItem(page, 'Capability map');
  await expect(page.getByText('Pay People').first()).toBeVisible();

  const control = page.getByRole('group', { name: 'View the capability map as at a date' });
  await control.getByRole('button', { name: '1 year', exact: true }).click();
  await expect(page.getByTestId('future-summary')).toContainText('capability map as it is planned to be on');
  await expect(page.getByTestId('future-summary')).toContainText('Read-only');
  await expect(page.getByText('Pay People').first()).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);

  await control.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByTestId('future-summary')).toHaveCount(0);
});

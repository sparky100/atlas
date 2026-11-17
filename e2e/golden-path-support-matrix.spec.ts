/**
 * Landscape matrix, click-only from Home at 1280 and 390: a system supporting a
 * capability → Landscape → Matrix → the cell names the fit → opening the
 * capability's column works. On a phone there is no Matrix (the existing list
 * stays), so the switch is absent.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('landscape matrix: systems against capabilities', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'supportmatrix');

  await addCapability(page, 'Pay People');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Payroll', description: 'Pays people.', capabilityName: 'Pay People' });

  await goToModelHome(page);
  await clickNavItem(page, 'Landscape');
  await expect(page.getByRole('heading', { name: /Landscape/, level: 1 })).toBeVisible();

  const narrow = (page.viewportSize()?.width ?? 0) < 768;
  const matrixSwitch = page.getByRole('button', { name: 'Matrix', exact: true });
  if (narrow) {
    await expect(matrixSwitch).toHaveCount(0);
  } else {
    await matrixSwitch.click();
    const grid = page.getByRole('region', { name: 'Systems by capability' });
    await expect(grid.getByRole('link', { name: 'Payroll' })).toBeVisible();
    await expect(grid.getByRole('link', { name: 'Pay People' })).toBeVisible();
    await expect(grid.getByRole('button', { name: /Payroll supports Pay People: Not rated/ })).toBeVisible();
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Systems by capability' })).toHaveCount(0);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

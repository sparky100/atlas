/**
 * "4 of 6 recorded", click-only from Home at 1280 and 390: Home's missing-facts count
 * leads to Gaps; the system page's chip leads into Fill in on that system; Elements
 * shows a sortable Completeness column (a table at desktop width; phones show cards).
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, homeSearchResult, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('completeness: Home count, system chip, Elements column', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'completeness');

  await addCapability(page, 'Pay People');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Payroll', description: 'Pays people.', capabilityName: 'Pay People' });

  // Home: the count of missing key facts links to Gaps.
  await goToModelHome(page);
  await page.getByRole('link', { name: /key facts? missing/ }).click();
  await expect(page.getByRole('heading', { name: 'Gaps', level: 1 })).toBeVisible();

  // System page: the chip reads as a fraction and opens Fill in on this system.
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Payroll');
  await homeSearchResult(page, 'Payroll').click();
  await expect(page.getByRole('heading', { name: 'Payroll' })).toBeVisible();
  const chip = page.getByRole('link', { name: /\d of \d recorded/ });
  await expect(chip).toBeVisible();
  await expect(page.getByText(/Missing: /)).toBeVisible();
  await chip.click();
  await expect(page.getByRole('region', { name: 'Gap walk' })).toBeVisible();

  // Elements: the Completeness column sorts (desktop table only).
  await goToModelHome(page);
  await clickNavItem(page, 'Elements');
  if ((page.viewportSize()?.width ?? 0) >= 900) {
    const header = page.getByRole('button', { name: 'Completeness' });
    await expect(header).toBeVisible();
    await header.click();
    await expect(page.getByRole('cell', { name: /\d of \d/ }).first()).toBeVisible();
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

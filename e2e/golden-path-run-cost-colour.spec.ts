/**
 * Run cost on the capability map, click-only from Home at 1280 and 390: a system
 * with no run cost supporting a capability → Capability map → Colour by Run cost →
 * the capability says "no run cost recorded" (never looks cheap).
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('capability map: colour by run cost', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'runcostcolour');

  await addCapability(page, 'Pay People');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Payroll', description: 'Pays people.', capabilityName: 'Pay People' });

  await goToModelHome(page);
  await clickNavItem(page, 'Capability map');
  await expect(page.getByText('Pay People').first()).toBeVisible();

  // The Colour by control sits in the filters panel (a sheet on a phone, so open it if it is closed).
  const colourBy = page.getByLabel('Colour by');
  if (!(await colourBy.isVisible())) await page.getByRole('button', { name: /Filters/ }).first().click();
  await colourBy.selectOption({ label: 'Run cost' });
  await expect(page.getByText('no run cost recorded').first()).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

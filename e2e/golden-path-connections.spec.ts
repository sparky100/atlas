/**
 * Landscape connections overview, click-only from Home at 1280 and 390: two
 * systems in different areas, one relying on the other → Landscape →
 * Connections → Dependencies → the cell counts it and clicking lists the link.
 * On a phone there is no Connections view (the existing list stays), so the
 * switch is absent.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, addUsesRelationship, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('landscape connections overview: counts links between areas', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'connections');

  await addCapability(page, 'Pay People');
  await addCapability(page, 'Hire People');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Payroll', description: 'Pays people.', capabilityName: 'Pay People' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Recruiting', description: 'Hires people.', capabilityName: 'Hire People' });
  await addUsesRelationship(page, 'Payroll', 'sends new starters to');

  await goToModelHome(page);
  await clickNavItem(page, 'Landscape');
  await expect(page.getByRole('heading', { name: /Landscape/, level: 1 })).toBeVisible();

  const narrow = (page.viewportSize()?.width ?? 0) < 768;
  const connectionsSwitch = page.getByRole('button', { name: 'Connections', exact: true });
  if (narrow) {
    await expect(connectionsSwitch).toHaveCount(0);
  } else {
    await connectionsSwitch.click();
    const grid = page.getByRole('region', { name: 'Connections between areas' });
    await expect(grid).toBeVisible();
    await page.getByRole('button', { name: 'Dependencies', exact: true }).click();
    const cell = grid.getByRole('button', { name: /relies on .*: 1$/ });
    await expect(cell).toBeVisible();
    await cell.click();
    await expect(page.getByRole('link', { name: 'Recruiting' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Connections between areas' })).toHaveCount(0);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

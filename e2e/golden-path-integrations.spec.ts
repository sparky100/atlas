/**
 * Integrations golden path — click-only from Home, at both 1280 and 390
 * like every `golden-path-*` spec: add two systems and a direct `uses`
 * link between them, open Integrations from the nav, see the link listed
 * with "Direct (no platform)", expand it, filter by routing, and confirm
 * no horizontal overflow. (A link through a platform and an interface is
 * covered by the row/filter unit tests; the click path for creating one
 * has no golden-path fixture yet.)
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, addUsesRelationship, clickNavItem, expectNavCurrent, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('a direct link between two systems is listed on the Integrations page', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'integrations');

  await addSystemFromHome(page, { name: 'Council Tax System', description: 'Handles council tax accounts.' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Northgate', description: "The borough's revenues platform." });
  await addUsesRelationship(page, 'Council Tax System', 'shares address data with');

  await goToModelHome(page);
  await clickNavItem(page, 'Integrations');
  await expectNavCurrent(page, 'Integrations');
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();

  // The link is listed, and says plainly that no platform manages it.
  await expect(page.getByText('Direct (no platform)').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('Northgate').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('Council Tax System').filter({ visible: true }).first()).toBeVisible();

  // Expand the row: a direct link explains itself.
  await page.getByRole('button', { name: 'Expand Northgate to Council Tax System' }).click();
  await expect(page.getByText(/no integration platform managing it/)).toBeVisible();

  // Filtering to "Via platform" leaves nothing; clearing brings it back.
  await page.getByLabel('Routing').selectOption('platform');
  await expect(page.getByText('No integrations match this filter.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('Council Tax System').filter({ visible: true }).first()).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

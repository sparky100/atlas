/**
 * F14 step 7 golden path — click-only from Home, at 1280 and 390 like every
 * `golden-path-*` spec: save a report, build a dashboard from it, see the
 * tile, download the dashboard as a picture, present it full screen and
 * leave presenting again.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('build a dashboard from a saved report, export it and present it', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'dashboard');
  await addCapability(page, 'Finance');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Ledger System', description: 'The financial ledger system.', capabilityName: 'Finance' });

  await goToModelHome(page);
  await clickNavItem(page, 'Portfolio');
  await expect(page.getByText('Ledger System').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save as report…' }).click();
  await page.getByLabel('Report name').fill('Estate costs');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved “Estate costs”.')).toBeVisible();

  // A new dashboard from the Reports hub.
  await goToModelHome(page);
  await clickNavItem(page, 'Reports');
  await page.getByRole('button', { name: 'New dashboard…' }).click();
  await page.getByLabel('Dashboard name').fill('Estate overview');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Estate overview' })).toBeVisible();
  await expect(page.getByText('No tiles yet.', { exact: false })).toBeVisible();

  // Add the report as a tile.
  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  await page.getByLabel('Report', { exact: true }).selectOption({ label: 'Estate costs' });
  await page.getByRole('button', { name: 'Add tile' }).click();
  await expect(page.getByText('No tiles yet.', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done editing' }).click();
  await expect(page.getByRole('link', { name: /Estate costs|Open report/ }).first()).toBeVisible();

  // Download the dashboard as a stamped picture.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export dashboard as PNG' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-\d{4}-\d{2}-\d{2}\.png$/);
  expect((await readFile(await file.path())).subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

  // Present: editing controls go, and Exit presenting brings them back.
  await page.getByRole('button', { name: 'Present' }).click();
  await expect(page.getByRole('button', { name: 'Exit presenting' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit dashboard' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Exit presenting' }).click();
  await expect(page.getByRole('button', { name: 'Edit dashboard' })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

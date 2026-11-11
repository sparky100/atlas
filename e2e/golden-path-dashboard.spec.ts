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

  await goToModelHome(page);
  await clickNavItem(page, 'Elements');
  await page.getByRole('button', { name: 'Save as report…' }).click();
  await page.getByLabel('Report name').fill('Model inventory');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved “Model inventory”.')).toBeVisible();

  // A new dashboard from the Reports hub.
  await goToModelHome(page);
  await clickNavItem(page, 'Reports');
  let finishLoadingTiles: () => void = () => undefined;
  const waitForTiles = new Promise<void>((resolve) => { finishLoadingTiles = resolve; });
  const tileRequests = '**/rest/v1/dashboard_tiles?*';
  await page.route(tileRequests, async (route) => {
    await waitForTiles;
    await route.fulfill({ status: 400, json: { message: 'Temporary tile list failure' } });
  });
  await page.getByRole('button', { name: 'New dashboard…' }).click();
  await page.getByLabel('Dashboard name').fill('Estate overview');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Estate overview' })).toBeVisible();
  const exportPng = page.getByRole('button', { name: 'Export dashboard as PNG' });
  try {
    await expect(page.getByRole('status').filter({ hasText: 'Loading…' })).toBeVisible();
    await expect(page.getByText('No tiles yet.', { exact: false })).toHaveCount(0);
    await expect(exportPng).toBeDisabled();
  } finally {
    finishLoadingTiles();
  }
  await expect(page.getByRole('alert').getByText("Couldn't load the dashboard tiles and reports.")).toBeVisible();
  await expect(page.getByText('No tiles yet.', { exact: false })).toHaveCount(0);
  await page.unroute(tileRequests);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('No tiles yet.', { exact: false })).toBeVisible();

  // A portfolio fetch can fail while the element tile still loads.
  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  await page.getByLabel('Report', { exact: true }).selectOption({ label: 'Model inventory' });
  await page.locator('form').filter({ has: page.getByRole('button', { name: 'Add tile' }) }).getByLabel('Show as').selectOption('table');
  await page.getByRole('button', { name: 'Add tile' }).click();
  const inventory = page.getByRole('link', { name: 'Model inventory', exact: true });
  await expect(inventory).toBeVisible();
  await expect(exportPng).toBeEnabled();

  let failPortfolio = true;
  await page.route((url) => url.pathname.endsWith('/rest/v1/elements_head') && url.searchParams.get('element_type') === 'eq.system', async (route) => {
    if (failPortfolio) await route.fulfill({ status: 400, json: { message: 'Temporary portfolio data failure' } });
    else await route.continue();
  });
  await page.getByLabel('Report', { exact: true }).selectOption({ label: 'Estate costs' });
  await page.locator('form').filter({ has: page.getByRole('button', { name: 'Add tile' }) }).getByLabel('Show as').selectOption('table');
  await page.getByRole('button', { name: 'Add tile' }).click();
  await expect(page.getByRole('alert').getByText("Couldn't load portfolio report data.")).toBeVisible();
  await expect(inventory).toBeVisible();
  await expect(exportPng).toBeDisabled();
  failPortfolio = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('link', { name: 'Estate costs', exact: true })).toBeVisible();
  await expect(exportPng).toBeEnabled();
  await page.getByRole('button', { name: 'Done editing' }).click();

  // Download the dashboard as a stamped picture.
  const download = page.waitForEvent('download');
  await exportPng.click();
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

  failPortfolio = true;
  await page.getByRole('link', { name: 'Estate costs', exact: true }).click();
  await expect(page.getByRole('alert').getByText("Couldn't load portfolio report data.")).toBeVisible();
  const downloadCsv = page.getByRole('button', { name: 'Download CSV' });
  await expect(downloadCsv).toHaveCount(0);
  failPortfolio = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(downloadCsv).toBeEnabled();
});

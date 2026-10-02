/**
 * F13 step 1 golden path — click-only from Home, at 1280 and 390 like every
 * `golden-path-*` spec: export the capability map, the Portfolio and the
 * landscape as a stamped PNG and PDF, and check each download is a real
 * picture (PNG signature) or document (PDF header) named after the model,
 * the view and the date.
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function exportBoth(page: Page, what: string, viewSlug: RegExp): Promise<void> {
  for (const ext of ['PNG', 'PDF'] as const) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: `Export ${what} as ${ext}` }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(new RegExp(`${viewSlug.source}.*-\\d{4}-\\d{2}-\\d{2}\\.${ext.toLowerCase()}$`));
    const path = await download.path();
    const bytes = await readFile(path);
    if (ext === 'PNG') expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    else expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }
}

test('export the capability map, Portfolio and landscape as stamped PNG and PDF', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'exportview');

  await addCapability(page, 'Finance');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Ledger System', description: 'The financial ledger system.', capabilityName: 'Finance' });

  await goToModelHome(page);
  await clickNavItem(page, 'Capability map');
  await expect(page.getByText('Finance', { exact: true }).first()).toBeVisible();
  await exportBoth(page, 'capability map', /-capability-map/);

  await goToModelHome(page);
  await clickNavItem(page, 'Portfolio');
  await expect(page.getByText('Ledger System').first()).toBeVisible();
  await exportBoth(page, 'portfolio', /-portfolio/);

  await goToModelHome(page);
  await clickNavItem(page, 'Landscape');
  await expect(page.getByRole('heading', { name: 'Landscape' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export landscape as PNG' })).toBeVisible();
  await exportBoth(page, 'landscape', /-landscape/);

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

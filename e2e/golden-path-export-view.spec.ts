/**
 * F13 step 1 golden path — click-only from Home, at 1280 and 390 like every
 * `golden-path-*` spec: export the capability map, the Portfolio and the
 * landscape as a stamped PNG and PDF, and check each download is a real
 * picture (PNG signature), spreadsheet (Excel, the Portfolio's own) or document (PDF header) named after the model,
 * the view and the date.
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const XLSX_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // an .xlsx is a zip

const FILE_EXTENSION = { PNG: 'png', PDF: 'pdf', Excel: 'xlsx' } as const;

/** Downloads each format in `formats` from the view's own export buttons and checks it is a real file named after the model, the view and the date. The picture views offer PNG and PDF; the table-shaped Portfolio offers Excel and PDF, and no PNG. */
async function exportAs(page: Page, what: string, viewSlug: RegExp, formats: readonly (keyof typeof FILE_EXTENSION)[] = ['PNG', 'PDF']): Promise<void> {
  for (const format of formats) {
    const ext = FILE_EXTENSION[format];
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: `Export ${what} as ${format}` }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(new RegExp(`${viewSlug.source}.*-\\d{4}-\\d{2}-\\d{2}\\.${ext}$`));
    const path = await download.path();
    const bytes = await readFile(path);
    if (format === 'PNG') expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    else if (format === 'Excel') expect(bytes.subarray(0, 4).equals(XLSX_SIGNATURE)).toBe(true);
    else expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }
}

test('export the capability map, Portfolio and landscape as stamped files', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'exportview');

  await addCapability(page, 'Finance');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Ledger System', description: 'The financial ledger system.', capabilityName: 'Finance' });

  await goToModelHome(page);
  await clickNavItem(page, 'Elements');
  await expect(page.getByText('Ledger System').first()).toBeVisible();
  const elementsDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export XLSX', exact: true }).click();
  const spreadsheet = await elementsDownload;
  expect(spreadsheet.suggestedFilename()).toMatch(/-export\.xlsx$/);
  expect((await readFile(await spreadsheet.path())).subarray(0, 4).equals(XLSX_SIGNATURE)).toBe(true);

  await goToModelHome(page);
  await clickNavItem(page, 'Capability map');
  await expect(page.getByText('Finance', { exact: true }).first()).toBeVisible();
  await exportAs(page, 'capability map', /-capability-map/);

  await goToModelHome(page);
  await clickNavItem(page, 'Portfolio');
  await expect(page.getByText('Ledger System').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export portfolio as PNG' })).toHaveCount(0);
  await exportAs(page, 'portfolio', /-portfolio/, ['Excel', 'PDF']);

  await goToModelHome(page);
  await clickNavItem(page, 'Landscape');
  await expect(page.getByRole('heading', { name: 'Landscape' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export landscape as PNG' })).toBeVisible();
  await exportAs(page, 'landscape', /-landscape/);

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

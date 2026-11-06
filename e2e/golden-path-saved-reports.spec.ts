/**
 * F14 step 7 golden path — click-only from Home, at 1280 and 390 like every
 * `golden-path-*` spec: save the Portfolio's view as a report, find it in the
 * Reports hub, keep a frozen copy, open that copy, and download a stamped
 * picture and a spreadsheet of it.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const XLSX_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

test('save a view as a report, keep a copy of it, and download it', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'savedreport');
  await addCapability(page, 'Finance');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Ledger System', description: 'The financial ledger system.', capabilityName: 'Finance' });

  // Save the Portfolio's current view.
  await goToModelHome(page);
  await clickNavItem(page, 'Portfolio');
  await expect(page.getByText('Ledger System').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save as report…' }).click();
  await page.getByLabel('Report name').fill('Estate costs');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved “Estate costs”.')).toBeVisible();

  // It is in the Reports hub; open it.
  await goToModelHome(page);
  await clickNavItem(page, 'Reports');
  await page.getByRole('link', { name: 'Estate costs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Estate costs' })).toBeVisible();
  await expect(page.getByText('Ledger System').first()).toBeVisible();

  // Keep a copy: it appears under "Saved copies" and opens as a fixed record.
  await page.getByRole('button', { name: 'Save a copy now' }).click();
  await expect(page.getByText('Saved a copy. It will not change when the report or the model does.')).toBeVisible();
  await page.getByRole('heading', { name: 'Saved copies' }).scrollIntoViewIfNeeded();
  await page.getByRole('link', { name: 'Estate costs' }).last().click();
  await expect(page.getByText(/Saved copy, /).first()).toBeVisible();
  await expect(page.getByText('Ledger System').first()).toBeVisible();

  // Downloads from the copy: a stamped picture, a document and a spreadsheet.
  for (const [button, signature, ext] of [
    ['Export report as PNG', PNG_SIGNATURE, 'png'],
    ['Download Excel', XLSX_SIGNATURE, 'xlsx'],
  ] as const) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: button }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${ext}$`));
    expect((await readFile(await file.path())).subarray(0, signature.length).equals(signature)).toBe(true);
  }
  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export report as PDF' }).click();
  expect((await readFile(await (await pdf).path())).subarray(0, 5).toString('latin1')).toBe('%PDF-');

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

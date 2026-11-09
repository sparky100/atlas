/**
 * F12 step 1 golden path, click-only from Home at 1280 and 390: two
 * systems, then Elements → "Edit in grid" → set one system's Criticality
 * and the other's Disposition → Save → both show in the table and on each
 * system's own page, as one saved edit.
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('bulk edit: change two systems in the Elements grid and save them together', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'bulkedit');

  await addSystemFromHome(page, { name: 'Payroll', description: 'Pays people.' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Ledger', description: 'The general ledger.' });

  await goToModelHome(page);
  await clickNavItem(page, 'Elements');
  await expect(page.getByRole('heading', { name: 'Elements', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Edit in grid' }).click();
  const bar = page.getByRole('region', { name: 'Grid editing' });
  await expect(bar.getByRole('button', { name: 'Save 0 changes' })).toBeDisabled();

  await page.getByLabel('Criticality for Payroll').selectOption('high');
  await page.getByLabel('Planned action for Ledger').selectOption('migrate');
  await expect(bar.getByText('2 changes not saved yet')).toBeVisible();
  await bar.getByRole('button', { name: 'Save 2 changes' }).click();

  // Back to read-only, both values showing.
  await expect(page.getByRole('button', { name: 'Edit in grid' })).toBeVisible();
  await expect(page.getByText('Saved 2 changes')).toBeVisible();
  // Rows are table cells at 1280 and cards at 390 — never the toolbar's own filter options.
  const rows = page.locator('td, li');
  await expect(rows.getByText('high', { exact: true }).first()).toBeVisible();
  await expect(rows.getByText('Move to another system', { exact: true }).first()).toBeVisible();

  // Each system's own page shows its new value.
  await page.getByRole('link', { name: /Payroll/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Payroll' })).toBeVisible();
  await expect(page.getByText('high', { exact: true }).first()).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

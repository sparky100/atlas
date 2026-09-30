/**
 * Portfolio golden path — click-only from Home (S2's own rule), running at
 * both 1280 and 390 like every `golden-path-*` spec: set run cost and fit
 * on a couple of systems, open Portfolio, see the expected signal, sort by
 * cost (the default) and by name, filter by signal, expand a row for "why
 * this cost", and confirm no horizontal overflow at 390.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

async function setRunCost(page: Page, band: string): Promise<void> {
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Run cost').selectOption(band);
  await page.getByRole('button', { name: 'Save' }).click();
}

test('set run cost and fit, see the expected signal in Portfolio, sort, filter and expand', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'portfolio');

  await addCapability(page, 'Finance');

  // Ledger System: high run cost, poor fit into Finance — the "costly,
  // poor fit" signal's own combination.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Ledger System', description: 'The financial ledger system.', capabilityName: 'Finance' });
  await setRunCost(page, '1m_5m');
  await page.getByRole('button', { name: 'Show attributes' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Fit for purpose').selectOption('poor');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Fit for purpose: poor', { exact: false })).toBeVisible();

  // Cheap App: cheap, no capability — a plain, unremarkable row, cheaper
  // than Ledger System and alphabetically first.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Cheap App', description: 'A small, inexpensive system.' });
  await setRunCost(page, 'under_50k');

  await goToModelHome(page);
  await page.getByRole('link', { name: 'Portfolio' }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();

  // Default sort is cost band descending — Ledger System (£1m–£5m) before
  // Cheap App (Under £50k).
  const defaultOrderText = await page.locator('body').innerText();
  expect(defaultOrderText.indexOf('Ledger System')).toBeLessThan(defaultOrderText.indexOf('Cheap App'));

  // Ledger System's own signal chip is visible.
  await expect(page.getByText('Costly, poor fit', { exact: true }).first()).toBeVisible();

  // Sort by name: Cheap App (C) now comes before Ledger System (L).
  await page.getByLabel('Sort by').selectOption('name');
  const nameOrderText = await page.locator('body').innerText();
  expect(nameOrderText.indexOf('Cheap App')).toBeLessThan(nameOrderText.indexOf('Ledger System'));

  // Filter by signal: only Ledger System remains.
  await page.getByLabel('Signal').selectOption('costly_poor_fit');
  await expect(page.getByText('Ledger System', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Cheap App', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();

  // Expand Ledger System's row: "why this cost" shows the capability it
  // supports and (since none is set) "No business owner." Same button at
  // both viewports — the desktop table's own expand toggle and the mobile
  // card's own tap target share this accessible name.
  await page.getByRole('button', { name: 'Expand Ledger System' }).click();
  await expect(page.getByRole('link', { name: 'Finance', exact: true }).first()).toBeVisible();
  await expect(page.getByText('No business owner', { exact: true })).toBeVisible();

  // No horizontal overflow (checked at both 1280 and 390 — meaningful at
  // 390, where a wide table most easily spills past the viewport).
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

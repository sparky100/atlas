/**
 * F2 (narrowed capture pipeline), Phase 1 — "Import a spreadsheet…" on the
 * Changes page. Click-only from Home (S2 discipline); the file itself is
 * supplied in memory via `setInputFiles`'s buffer form — the standard,
 * and only, way Playwright drives a real `<input type="file">`, not a
 * `page.goto`/URL-construction shortcut.
 *
 * Covers: a new system created from the file, an existing one updated
 * (matched by exact name), a `supports` link resolved by exact capability
 * name, and the whole thing landing on an ordinary `record`-intent change
 * branch that the existing review flow already handles — no new review
 * queue exists for this.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('import a CSV of systems: one new, one matched by name and linked to a capability by name', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'importgolden');

  // The capability the file's own `supports` column names, and the
  // existing system the file both matches (by exact name) and updates.
  await addCapability(page, 'Billing');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Council Tax System', description: 'Old description.' });
  await goToModelHome(page);

  await page.getByRole('link', { name: 'Changes' }).click();
  await expect(page.getByRole('heading', { name: 'Import a spreadsheet' })).toBeVisible();

  const csv = ['name,description,supports', 'Council Tax System,Handles council tax accounts.,', 'Northgate,The borough’s new revenues platform.,Billing'].join('\n');
  await page.getByLabel('Choose a CSV or XLSX file to import').setInputFiles({ name: 'systems.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

  // Both rows resolve without needing a pick — "Council Tax System" is an
  // exact-name match, "Northgate" is new, and "Billing" resolves by exact
  // name too, so the Import button is enabled immediately.
  await expect(page.getByText('Matched: Council Tax System')).toBeVisible();
  await expect(page.getByText('supports: Billing')).toBeVisible();
  const importButton = page.getByRole('button', { name: 'Import' });
  await expect(importButton).toBeEnabled();
  await importButton.click();

  // Lands on the new change branch's own page — the ordinary change page,
  // not a bespoke review surface built for this feature. `record` intent
  // renders as "Recording: <title>" (branchIntent.ts's own wording).
  await expect(page.getByRole('heading', { name: /Recording: Import: systems\.csv/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Edits on this change' })).toBeVisible();
  await expect(page.getByText('Northgate', { exact: true })).toBeVisible();
  await expect(page.getByText('supports Northgate → Billing')).toBeVisible();
  await expect(page.getByText('Handles council tax accounts.')).toBeVisible();
});

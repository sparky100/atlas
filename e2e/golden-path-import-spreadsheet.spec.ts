/**
 * F2-lite ("spreadsheet import as reconciliation") — the two new entry
 * points (`SpreadsheetImportDialog.tsx`'s own doc comment on why it's a
 * dialog, reachable from the Landscape's empty state and its "+ Add" row,
 * and the Elements browse table's toolbar) replace F2 Phase 1/2's own
 * Changes-page-embedded panel. Click-only from Home (S2 discipline); the
 * file itself is supplied in memory via `setInputFiles`'s buffer form — the
 * standard, and only, way Playwright drives a real `<input type="file">`,
 * not a `page.goto`/URL-construction shortcut.
 *
 * Covers the user's own stated scenario: from an empty landscape, import a
 * three-row file, land on the change, submit, approve & merge (`record`
 * intent's own one-click path — never the shared review queue), see all
 * three systems on the landscape.
 */
import { expect, test } from '@playwright/test';
import { goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('import a CSV of three new systems from an empty landscape, then submit, approve and merge the change', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'importgolden');

  await goToModelHome(page);
  await page.getByRole('link', { name: 'Landscape' }).click();
  await expect(page.getByRole('heading', { name: 'Landscape' })).toBeVisible();
  await expect(page.getByText('No systems yet.')).toBeVisible();
  // Two entry points can both be on screen at once at desktop width (the
  // empty state's own affordance, and the page's standing "+ Add" row) —
  // either opens the identical dialog, so `.first()` rather than assuming
  // which one a given viewport renders.
  await page.getByRole('button', { name: 'Import model updates…' }).first().click();

  await expect(page.getByRole('dialog', { name: 'Import model updates' })).toBeVisible();
  const csv = ['name,description', 'Northgate,The borough’s new revenues platform.', 'Riverside Payments,Handles resident payments.', 'Council Tax System,Manages council tax accounts.'].join('\n');
  await page.getByLabel('Choose a CSV, XLSX, or JSON file to import').setInputFiles({ name: 'systems.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

  // Every row is a clean, unambiguous new system — nothing to pick, no failures — so the Import button is enabled immediately.
  await expect(page.getByText('3 new')).toBeVisible();
  const importButton = page.getByRole('button', { name: 'Import' });
  await expect(importButton).toBeEnabled();
  await importButton.click();

  // Lands on the new change branch's own page — the ordinary change page, not a bespoke review surface built for this feature. `record` intent renders as "Recording: <title>" (branchIntent.ts's own wording), and the branch's own title is "Imported from <file>".
  await expect(page.getByRole('heading', { name: 'Recording: Imported from systems.csv' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Edits on this change' })).toBeVisible();
  await expect(page.getByText('Northgate', { exact: true })).toBeVisible();
  await expect(page.getByText('Riverside Payments', { exact: true })).toBeVisible();
  await expect(page.getByText('Council Tax System', { exact: true })).toBeVisible();

  // `record` intent's own one-click review path (`useApproveAndMerge.ts`) — submit, then "Approve & merge" appears directly on this same page, never the shared /review queue.
  await page.getByRole('button', { name: 'Submit for review' }).click();
  const approveButton = page.getByRole('button', { name: 'Approve & merge' });
  await expect(approveButton).toBeVisible();
  await approveButton.click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  // Back on the Landscape, all three systems are there.
  await goToModelHome(page);
  await page.getByRole('link', { name: 'Landscape' }).click();
  await expect(page.getByText('No systems yet.')).toHaveCount(0);
  await expect(page.getByText('Northgate', { exact: true })).toBeVisible();
  await expect(page.getByText('Riverside Payments', { exact: true })).toBeVisible();
  await expect(page.getByText('Council Tax System', { exact: true })).toBeVisible();
});

test('unchecking a failed row lets the rest of the file import instead of being blocked entirely', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'importrowselect');

  await goToModelHome(page);
  await page.getByRole('link', { name: 'Landscape' }).click();
  await page.getByRole('button', { name: 'Import model updates…' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Import model updates' })).toBeVisible();

  // Row 2 is a clean new system; row 3 is a module naming a platform that
  // doesn't exist — a real, common shape (a full-inventory file's own
  // typo, or a platform not itself included in this file) that used to
  // block the *entire* import, not just this one row.
  const csv = ['name,description,platform', 'Northgate,The borough’s new revenues platform.,', 'PM,Project management module.,Nonexistent Platform'].join('\n');
  await page.getByLabel('Choose a CSV, XLSX, or JSON file to import').setInputFiles({ name: 'systems.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

  await expect(page.getByRole('button', { name: '1 row(s) failed' })).toBeDisabled();

  // Uncheck the failed row — it's excluded from the import entirely, not just hidden, so it can no longer block the rest.
  await page.getByRole('checkbox', { name: 'Include "PM" (row 3) in this import' }).uncheck();
  const importButton = page.getByRole('button', { name: 'Import' });
  await expect(importButton).toBeEnabled();
  await importButton.click();

  await expect(page.getByRole('heading', { name: 'Edits on this change' })).toBeVisible();
  await expect(page.getByText('Northgate', { exact: true })).toBeVisible();
  await expect(page.getByText('PM', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.getByRole('button', { name: 'Approve & merge' }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  await goToModelHome(page);
  await page.getByRole('link', { name: 'Landscape' }).click();
  await expect(page.getByText('Northgate', { exact: true })).toBeVisible();
  await expect(page.getByText('PM', { exact: true })).toHaveCount(0);
});

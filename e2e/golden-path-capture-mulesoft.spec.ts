/**
 * MuleSoft import step 3 (docs/import/mulesoft/, src/capture/adapters/): the
 * capture dialog's Source choice for a MuleSoft Anypoint export. From Home,
 * click-only: open a capture run, pick the MuleSoft source, download the
 * export script, choose an export file, see what it contains, start the run
 * and find the converted platform and interfaces in the review queue.
 *
 * Needs a real Supabase and a deployed `capture-run`, like every other spec
 * that starts a run — this repository's sandbox has neither, so this one is
 * written and reasoned through, not executed there. `pnpm db:start && pnpm
 * exec playwright test e2e/golden-path-capture-mulesoft.spec.ts` runs it for
 * real. The export file is written at test time (as the JSON spec beside it
 * does) in the shape the export script produces; no LLM call is involved
 * (no `capability`, no prose).
 */
import { promises as fs } from 'node:fs';
import { expect, test } from '@playwright/test';
import { goToModelHome, signUpCreateOrgAndModel, clickNavItem } from './fixtures/goldenPath';

test('choose the MuleSoft source card, read its guide, upload an export and review the converted platform', async ({ page }, testInfo) => {
  const exportPath = testInfo.outputPath('mulesoft-export.json');
  await fs.writeFile(
    exportPath,
    JSON.stringify({
      format: 'atlas-mulesoft-export',
      version: 1,
      exportedAt: '2026-10-17T13:26:25.478Z',
      organizationId: 'org-1',
      environments: [
        {
          name: 'Production',
          apis: [
            { id: 101, assetId: 'orders', assetVersion: '1.0.0', endpointUri: null, endpointType: 'http', deprecated: false, activeContractsCount: 1 },
            { id: 102, assetId: 'warehouse-stock', assetVersion: '1.0.0', endpointUri: null, endpointType: 'http', deprecated: false, activeContractsCount: 1 },
          ],
          contracts: {
            '101': [{ id: 9001, status: 'APPROVED', apiId: 101, application: { id: 1, name: 'Order Portal' } }],
            '102': [{ id: 9002, status: 'APPROVED', apiId: 102, application: { id: 2, name: 'Depot App' } }],
          },
        },
      ],
      warnings: [],
    }),
  );

  await signUpCreateOrgAndModel(page, 'capturemulesoft');

  await goToModelHome(page);
  await clickNavItem(page, 'Import');
  await page.getByRole('button', { name: 'New import' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start an import' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('radio', { name: /MuleSoft Anypoint/ }).click();
  await expect(dialog.getByText('Check the file for anything confidential', { exact: false })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download the export script' }).click()]);
  expect(download.suggestedFilename()).toBe('mulesoft-export.mjs');

  await dialog.getByLabel('Choose the MuleSoft export file').setInputFiles(exportPath);
  await expect(dialog.getByText('2 API interfaces, 2 client applications and 2 relationships on one MuleSoft platform.')).toBeVisible();
  const startButton = dialog.getByRole('button', { name: 'Start import' });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  await expect(page.getByRole('dialog', { name: 'Start an import' })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText('Parsed', { exact: true })).toBeVisible({ timeout: 120_000 });

  await page.getByRole('link', { name: 'Review →' }).click();
  await expect(page.getByRole('heading', { name: 'New', exact: false })).toBeVisible();
  await expect(page.getByText('MuleSoft Anypoint', { exact: true })).toBeVisible();
  await expect(page.getByText('Orders', { exact: true })).toBeVisible();
  await expect(page.getByText('Warehouse Stock', { exact: true })).toBeVisible();
});

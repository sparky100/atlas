/**
 * Read-only API (ADR-031), click-only from Home: an owner creates an API key
 * in Organisation settings, sees it once, then revokes it. The `api` edge
 * function itself is covered by `src/api/handler.test.ts` and the database
 * side by `src/db/apiKeys.integration.test.ts`; this spec is the UI path.
 * Runs at 1280 and 390 (`playwright.config.ts`).
 */
import { expect, test } from '@playwright/test';
import { signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('API access: an owner creates a key, sees it once, then revokes it', async ({ page }) => {
  const { orgName } = await signUpCreateOrgAndModel(page, 'goldenpath-apikeys');
  await page.getByRole('link', { name: 'Atlas' }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: 'Org settings' }).click();
  await expect(page.getByRole('heading', { name: 'API access' })).toBeVisible();
  await expect(page.getByText('No API keys yet.')).toBeVisible();

  await page.getByLabel('Key name').fill('Reporting tool');
  await page.getByRole('button', { name: 'Create key' }).click();
  const shown = page.getByTestId('new-api-key');
  await expect(shown).toHaveText(/^atl_[0-9a-f]{64}$/);
  await expect(page.getByText('Active')).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(shown).toHaveCount(0);

  await page.getByRole('button', { name: 'Revoke API key Reporting tool' }).click();
  await expect(page.getByText(/^Revoked /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revoke API key Reporting tool' })).toHaveCount(0);
});

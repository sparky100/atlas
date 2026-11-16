/**
 * S2 flow 6 (docs/prompts/atlas-prompt-pack.md): "cancel a change."
 * Click-only from Home; `cancel-change.spec.ts` already covers this exact
 * click path (S1 item 4) — this golden path is the same shape, entered
 * from Home rather than an existing fixture.
 */
import { expect, test } from '@playwright/test';
import { goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('cancel a change: collapsed section with a reason, active ref reset, duplicable into a new draft', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath6');

  await page.getByRole('link', { name: 'Changes' }).click();
  const changeTitle = 'Cancel Me';
  await page.getByPlaceholder("What's this change? (e.g. Retire the legacy CRM)").fill(changeTitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page.getByRole('heading', { name: changeTitle })).toBeVisible();
  await expect(page.getByText(`Editing in change: ${changeTitle}`)).toBeVisible();

  await page.getByRole('button', { name: 'Cancel this change…' }).click();
  await page.getByPlaceholder('Reason (required)').fill('No longer needed.');
  await page.getByRole('button', { name: 'Confirm cancel' }).click();

  await expect(page.getByText('cancelled', { exact: true })).toBeVisible();
  await expect(page.getByText('No longer needed.')).toBeVisible();
  await expect(page.getByText(`Editing in change: ${changeTitle}`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);

  await goToModelHome(page);
  await page.getByRole('link', { name: 'Changes' }).click();
  await expect(page.getByText(changeTitle)).toHaveCount(0);
  await page.getByRole('button', { name: /Cancelled/ }).click();
  const cancelledRow = page.locator('li').filter({ hasText: changeTitle });
  await expect(cancelledRow.getByText(changeTitle)).toBeVisible();
  await expect(cancelledRow.getByText(/Cancelled: No longer needed\./)).toBeVisible();

  await cancelledRow.getByRole('link', { name: 'Open →' }).click();
  await page.getByRole('button', { name: 'Duplicate into a new draft' }).click();
  await expect(page.getByText('draft', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`Editing in change: ${changeTitle}`)).toBeVisible();
});

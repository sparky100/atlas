/**
 * S1 item 4 (docs/prompts/atlas-prompt-pack.md, issue #97): "Cancel a
 * change: proposer or owner/architect, Draft or Proposed; status ->
 * cancelled; read-only; hidden from My changes and the queue; listed
 * under a collapsed 'Cancelled' section with a reason; resets the active
 * ref if it was selected; duplicable into a new draft."
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('cancelling a change: collapsed section with a reason, active ref reset, duplicable into a new draft', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'cancelchange', 'Ledger Service');
  const { orgSlug, modelSlug } = fixture;

  // 1. Create a change — the sticky-ref create flow selects it as the
  // session's own editing ref (ChangesView.tsx's own "lands you inside").
  const changeTitle = `Retire ${randomUUID().slice(0, 8)}`;
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  await page.getByPlaceholder('Name (e.g. retire-legacy-crm)').fill(`cancel-me-${randomUUID().slice(0, 8)}`);
  await page.getByPlaceholder('Title (e.g. Retire the legacy CRM)').fill(changeTitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page.getByRole('heading', { name: changeTitle })).toBeVisible();
  await expect(page.getByText(`Editing in change: ${changeTitle}`)).toBeVisible();

  // 2. Cancel it, with a reason.
  await page.getByRole('button', { name: 'Cancel this change…' }).click();
  await page.getByPlaceholder('Reason (required)').fill('No longer needed.');
  await page.getByRole('button', { name: 'Confirm cancel' }).click();

  // 3. Read-only now: cancelled, reason shown, no more Submit/Edit-metadata
  // affordance for this closed state — and the banner is gone, proving the
  // session's own active ref (which this branch was) reset.
  await expect(page.getByText('cancelled', { exact: true })).toBeVisible();
  await expect(page.getByText('No longer needed.')).toBeVisible();
  await expect(page.getByText(`Editing in change: ${changeTitle}`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);

  // 4. The Changes list: hidden from the active flat list (the
  // "Cancelled" section starts collapsed — CollapsibleSection.tsx unmounts
  // its content entirely while closed, not just CSS-hides it), present
  // only once expanded, reason included.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  await expect(page.getByText(changeTitle)).toHaveCount(0);
  await page.getByRole('button', { name: /Cancelled/ }).click();
  const cancelledRow = page.locator('li').filter({ hasText: changeTitle });
  await expect(cancelledRow.getByText(changeTitle)).toBeVisible();
  await expect(cancelledRow.getByText(/Cancelled: No longer needed\./)).toBeVisible();

  // 5. Duplicate into a new draft — a fresh branch, immediately selected
  // (same "lands you inside" convention as an ordinary create).
  await cancelledRow.getByRole('link', { name: 'Open →' }).click();
  await page.getByRole('button', { name: 'Duplicate into a new draft' }).click();
  await expect(page.getByText('draft', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`Editing in change: ${changeTitle}`)).toBeVisible();
});

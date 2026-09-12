/**
 * S1 item 2 (docs/prompts/atlas-prompt-pack.md, issue #95): "Reviewer
 * view: review request and change pages get 'View this change' ...
 * opening a read-only viewing ref with banner 'Viewing change: <name>
 * (read-only)', edit controls hidden, navigation keeps it, 'Back to
 * main' exits. Distinct from 'Work in this change'."
 *
 * The "distinct" half is the point of this test, not just the read-only
 * half: an owner already editing change B views a *different* change,
 * A, via "View this change" — the session's real editing selection (B)
 * must survive the visit untouched, proving the viewing ref is never
 * written to the same session storage `SelectedRefProvider.tsx` uses for
 * "Work in this change".
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('viewing a change read-only leaves the session\'s own editing selection untouched', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'viewchange', 'Ledger Service');
  const { orgSlug, modelSlug } = fixture;

  // 1. Create change A, then change B — creating B (ChangesView's own
  // "lands you inside" behaviour) makes B the session's editing
  // selection, superseding A.
  const changeATitle = `Change A ${randomUUID().slice(0, 8)}`;
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  await page.getByPlaceholder('Name (e.g. retire-legacy-crm)').fill(`change-a-${randomUUID().slice(0, 8)}`);
  await page.getByPlaceholder('Title (e.g. Retire the legacy CRM)').fill(changeATitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page.getByRole('heading', { name: changeATitle })).toBeVisible();
  const changeAId = /\/changes\/([^/?]+)/.exec(page.url())?.[1];
  if (!changeAId) throw new Error(`could not read change A's id out of ${page.url()}`);

  const changeBTitle = `Change B ${randomUUID().slice(0, 8)}`;
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  await page.getByPlaceholder('Name (e.g. retire-legacy-crm)').fill(`change-b-${randomUUID().slice(0, 8)}`);
  await page.getByPlaceholder('Title (e.g. Retire the legacy CRM)').fill(changeBTitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page.getByRole('heading', { name: changeBTitle })).toBeVisible();
  await expect(page.getByText(`Editing in change: ${changeBTitle}`)).toBeVisible();

  // 2. From change A's own page (still B selected underneath), "View
  // this change" opens A read-only — never "Edit in this change".
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${changeAId}`);
  await page.getByRole('link', { name: 'View this change' }).click();
  // `:` vs `%3A`: `setSearchParams`/react-router don't consistently decode
  // the ref param's own colon in the URL bar (the same encoding quirk
  // `changes-create.spec.ts`'s own `/ref=branch:/` assertion already has
  // to tolerate) — match either form rather than pin one.
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/landscape\\?ref=branch(:|%3A)${changeAId}&viewing=1`));
  await expect(page.getByText(`Viewing change: ${changeATitle} (read-only)`)).toBeVisible();
  // Read-only: no create affordance, unlike the editing banner's page.
  await expect(page.getByRole('button', { name: '+ Add system' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);

  // 3. "Back to main" exits the viewing ref — and since nothing was ever
  // written to storage for it, the page lands back on Landscape with no
  // ref/viewing at all, at which point `SelectedRefProvider`'s own
  // URL-silent reconciliation restores B, the real editing selection,
  // proving A's viewing episode never touched it.
  await page.getByRole('link', { name: 'Back to main' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/landscape\\?ref=branch(:|%3A)`));
  await expect(page).not.toHaveURL(/viewing=1/);
  await expect(page.getByText(`Editing in change: ${changeBTitle}`)).toBeVisible();
  await expect(page.getByText(`Viewing change:`)).toHaveCount(0);
});

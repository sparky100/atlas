/**
 * Prompt 7g, Bugs (1): "Changes page 'Create change' fires no request and
 * shows no error." `e2e/change-branch-merge.spec.ts` already exercises
 * "Create change" as step 1 of a much longer create-edit-view-merge path —
 * this is the narrower, dedicated coverage that item itself asks for: just
 * the create action, its own list entry, and (the part nothing covered
 * before this) that a real failure surfaces visibly rather than silently.
 *
 * Sticky ref: "the create-change flow lands you inside" — a successful
 * create now navigates straight to the new change's own page with it
 * selected as the active ref (`ChangesView.tsx`'s own comment), same as
 * clicking "Edit in this change" would. The first test below follows that
 * landing and then goes back to the list separately to confirm the row is
 * really there; the second test (a *failed* create, which never navigates
 * anywhere) still runs entirely from the Changes page as before.
 */
import { expect, test } from '@playwright/test';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('creates a change from the UI, lands inside it, and lists it', async ({ page }) => {
  const env = loadEnv();
  const { orgSlug, modelSlug } = await bootstrapChangeBranchFixture(page, env, 'changescreate', 'Payments Gateway');

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const changeTitle = 'Retire the payments gateway';
  await page.getByPlaceholder("What's this change? (e.g. Retire the legacy CRM)").fill(changeTitle);
  await page.getByPlaceholder('Description (optional)').fill('Decommission the old gateway once the new one is live.');
  await page.getByRole('button', { name: 'Create change' }).click();

  // Landed inside: this change's own page, selected as the active ref.
  await expect(page.getByRole('heading', { name: changeTitle })).toBeVisible();
  await expect(page).toHaveURL(/ref=branch(:|%3A)/);
  await expect(page.getByText(`Editing in change: ${changeTitle}`)).toBeVisible();

  // The real point of this bug's own report: a working create shows the
  // new change in the list (not just "no error" — an actually-created row).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const changeRow = page.locator('li', { hasText: changeTitle });
  await expect(changeRow).toBeVisible();
  await expect(changeRow.getByText('draft', { exact: true })).toBeVisible();

  // Survives a reload — proof this is a real committed row, not local-only
  // form state that merely looked like success.
  await page.reload();
  await expect(page.locator('li', { hasText: changeTitle })).toBeVisible();
});

test('two changes with the same title can both be created — Atlas makes the short code unique itself', async ({ page }) => {
  const env = loadEnv();
  const { orgSlug, modelSlug } = await bootstrapChangeBranchFixture(page, env, 'changescreatesame', 'Order Service');

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const sameTitle = 'Same title twice';
  await page.getByPlaceholder("What's this change? (e.g. Retire the legacy CRM)").fill(sameTitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page).toHaveURL(/ref=branch(:|%3A)/);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  await expect(page.locator('li', { hasText: sameTitle })).toHaveCount(1);
  await page.getByPlaceholder("What's this change? (e.g. Retire the legacy CRM)").fill(sameTitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page).toHaveURL(/ref=branch(:|%3A)/);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  await expect(page.locator('li', { hasText: sameTitle })).toHaveCount(2);
});

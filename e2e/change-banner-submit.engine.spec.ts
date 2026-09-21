/**
 * S1 item 1 (docs/prompts/atlas-prompt-pack.md, issue #94): "Banner while
 * in a change: ... 'Submit for review' (finish; Proposed; ref → main).
 * Never one button for both." Until this item, the only "Submit for
 * review" control lived on the change's own page (ChangeView.tsx) —
 * exercised end-to-end by e2e/changes-ux-lifecycle.spec.ts. This spec
 * exercises the *other* one: the banner's own copy of that action, used
 * from a page that isn't the change's own page at all (an element page),
 * which is the entire point of putting it in the banner in the first
 * place.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loadEnv } from '../src/db/env';
import { addArchitectMember, bootstrapChangeBranchFixture, submitForReviewWithReviewers } from './fixtures/changeBranchFixture';

test('submitting for review from the banner on an element page (not the change page) proposes the change', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'bannersubmit', 'Ledger Service');
  const { orgId, userId, orgSlug, modelSlug, systemId } = fixture;
  // F3a's own architect floor — see addArchitectMember's own doc comment.
  await addArchitectMember(env, orgId, userId);

  // 1. Owner creates a change from the Changes list — this already selects
  // it as the session ref and lands on the change's own page (ChangesView's
  // own `setRef` on create), same as clicking "Edit in this change" would.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const changeName = `retire-ledger-banner-${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Name (e.g. retire-legacy-crm)').fill(changeName);
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/changes/`));
  await expect(page.getByText(`Editing in change: ${changeName}`)).toBeVisible();

  // 2. Navigate to an element page — nowhere near the change's own page —
  // and edit while the change is still selected.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByText(`Editing in change: ${changeName}`)).toBeVisible();
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Vendor', { exact: true }).fill('Ridgeline Systems');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible({ timeout: 15_000 });

  // 3. The banner's own "Submit for review" — not the change page's copy —
  // finishes the change from right here.
  await expect(page.getByText(`Editing in change: ${changeName}`)).toBeVisible();
  await submitForReviewWithReviewers(page, false);
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/review/`));
  await expect(page.getByText('pending', { exact: true })).toBeVisible();

  // 4. "Finish," not "leave": the session ref is cleared back to main (no
  // more banner), and the change is Proposed, not still Draft.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByText(/^Editing in change:/)).toHaveCount(0);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  await expect(page.getByText(changeName)).toBeVisible();
  await expect(page.getByText('proposed', { exact: true }).first()).toBeVisible();
});

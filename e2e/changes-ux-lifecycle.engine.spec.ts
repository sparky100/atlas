/**
 * Sprint 7i item 6: "Playwright: create a change from an element page,
 * banner shown, edit, submit, approve as owner, merge; stepper correct at
 * each step." A contributor (no direct main-write path) proposes the
 * change from an element page's own "Propose a change" entry point — the
 * gap `ElementHeader.tsx`'s own `onEdit` comment used to name — edits and
 * submits it; the owner then approves and merges. Same owner/contributor
 * split `e2e/add-a-system-flow.spec.ts` already established for testing
 * this identical entry point (decision 5's propose-a-change path).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createSupabaseClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('propose a change from an element page as a contributor, edit, submit; approve and merge as owner; stepper correct at every step', async ({ page, browser }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'changesux', 'Ledger Service');
  const { signedIn: owner, orgId, orgSlug, modelSlug, userId: ownerId, systemId } = fixture;

  // A contributor, added directly (members_insert's RLS lets an owner
  // insert any member row) — same pattern e2e/add-a-system-flow.spec.ts
  // already uses for the identical propose-a-change entry point; there is
  // no invite UI yet (SPEC §11, target U4/Prompt 7j).
  const contributorContext = await browser.newContext();
  const contributorPage = await contributorContext.newPage();
  const contributorEmail = `changesux-contributor-${randomUUID()}@example.test`;
  const contributorPassword = `${randomUUID()}Aa1!`;
  await contributorPage.goto('/sign-in');
  await contributorPage.getByText("Don't have an account? Create one").click();
  await contributorPage.getByLabel('Email').fill(contributorEmail);
  await contributorPage.getByLabel('Password').fill(contributorPassword);
  await contributorPage.getByRole('button', { name: 'Create account' }).click();
  await expect(contributorPage.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const contributorAuth = createSupabaseClient(env);
  const { error: signInError } = await contributorAuth.auth.signInWithPassword({ email: contributorEmail, password: contributorPassword });
  if (signInError) throw new Error(`changes-ux fixture contributor sign-in: ${signInError.message}`);
  const { data: contributorData, error: getUserError } = await contributorAuth.auth.getUser();
  if (getUserError) throw new Error(`changes-ux fixture: could not read the contributor user: ${getUserError.message}`);
  const contributorId = contributorData.user.id;

  const { error: memberError } = await owner.from('members').insert({ org_id: orgId, user_id: contributorId, role: 'contributor', invited_by: ownerId });
  if (memberError) throw new Error(`changes-ux fixture: could not add contributor: ${memberError.message}`);

  // 1. Contributor at main: "Propose a change" appears instead of "Edit".
  await contributorPage.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(contributorPage.getByRole('heading', { name: 'Ledger Service' })).toBeVisible();
  await expect(contributorPage.getByRole('button', { name: '✎ Edit' })).toHaveCount(0);
  await contributorPage.getByRole('button', { name: 'Propose a change' }).click();

  const changeName = `retire-ledger-vendor-${randomUUID().slice(0, 8)}`;
  await contributorPage.getByLabel("What's this change?").fill(changeName);
  await contributorPage.getByRole('button', { name: 'Create & continue' }).click();

  // 2. Landed back on the same element, now selected into the new change —
  // "creates a change scoped to that element and selects it" (item 4). The
  // banner (item 2) shows it, with "Back to main".
  await expect(contributorPage).toHaveURL(/ref=branch:/);
  await expect(contributorPage.getByText(`Editing in change: ${changeName}`)).toBeVisible();
  await expect(contributorPage.getByRole('button', { name: 'Back to the live model' })).toBeVisible();

  const branchIdMatch = /ref=branch:([^&]+)/.exec(contributorPage.url());
  if (!branchIdMatch?.[1]) throw new Error(`could not read the branch id out of ${contributorPage.url()}`);
  const branchId = branchIdMatch[1];

  // 3. Edit while the change is selected — writes to the branch (now
  // draft/contributor-editable), and the save toast (item 2's other half)
  // says where it went.
  await contributorPage.getByRole('button', { name: '✎ Edit' }).click();
  await contributorPage.getByLabel('Vendor', { exact: true }).fill('Ridgeline Systems');
  await contributorPage.getByRole('button', { name: 'Save' }).click();
  await expect(contributorPage.getByRole('button', { name: '✎ Edit' })).toBeVisible({ timeout: 15_000 });
  await expect(contributorPage.getByText(`Saved to change: ${changeName}`)).toBeVisible();

  // 4. The change's own page: stepper reads Draft, current, not yet submitted.
  await contributorPage.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
  await expect(contributorPage.getByTestId('stepper-draft')).toHaveAttribute('data-step-state', 'current');
  // Prompt pack F0: an element page's own "Propose a change" defaults to
  // `correct` (`branchIntent.ts`'s `defaultIntentForEntryPoint('elementPage')`
  // — this flow never touches the toggle to `propose`), so the stepper's
  // sentence names the single-approver path (`changeStepper.ts`'s own
  // `singleApprover` branch) rather than the shared review queue's wording.
  // The mechanism underneath (submit → review page → approve → merge) is
  // still today's ordinary `merge_requests` flow, unchanged — only the
  // copy differs; PR3 is what actually skips the shared queue's UI.
  await expect(contributorPage.getByText('Not yet submitted. Once submitted, a single owner or architect approves and merges it directly — no shared review queue.')).toBeVisible();

  await contributorPage.getByRole('button', { name: 'Submit for review' }).click();
  await expect(contributorPage).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/review/`));
  await expect(contributorPage.getByText('pending', { exact: true }).first()).toBeVisible();

  // 5. Back on the change's own page: Draft/Proposed passed, In review current.
  await contributorPage.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
  await expect(contributorPage.getByTestId('stepper-proposed')).toHaveAttribute('data-step-state', 'passed');
  await expect(contributorPage.getByTestId('stepper-in_review')).toHaveAttribute('data-step-state', 'current');
  await expect(contributorPage.getByText('Awaiting a single approver — an owner or architect merges it directly, no shared review queue.')).toBeVisible();

  // 6. Approve as the owner — atlas.approve_merge_request is owner/architect
  // only, unlike submit (owner/architect/contributor); a contributor's own
  // session could get this far but no further, per role.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
  await page.getByRole('link', { name: 'Open review →' }).click();
  await expect(page.getByText('pending', { exact: true }).first()).toBeVisible();
  const approveButton = page.getByRole('button', { name: 'Approve' });
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();

  // 7. Stepper: Approved current, not yet merged.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
  await expect(page.getByTestId('stepper-approved')).toHaveAttribute('data-step-state', 'current');
  await expect(page.getByText('Approved, not yet merged. An owner or architect merges it into the live model.')).toBeVisible();

  await page.getByRole('link', { name: 'Open review →' }).click();
  await page.getByRole('button', { name: 'Merge' }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  // 8. Stepper: Merged, terminal; main now has the merged value.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
  await expect(page.getByTestId('stepper-merged')).toHaveAttribute('data-step-state', 'current');
  await expect(page.getByText('Merged into the live model.')).toBeVisible();

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByText('Ridgeline Systems', { exact: true })).toBeVisible();
});

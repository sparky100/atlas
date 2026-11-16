/**
 * Sticky ref close-out: "Contributors see 'read-only: under review' on
 * elements of a Proposed change." Once a branch leaves `draft`,
 * `canEditBranch` (roleGates.ts) already hides `Edit`/`Propose a change`
 * for everyone — this is the explanation that gap never had: neither
 * button is simply *missing* (as it would be for a viewer, or a
 * contributor at `main`), it's replaced by a chip naming why.
 *
 * Same "needs a real Supabase" limitation as every other spec here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { addArchitectMember, bootstrapChangeBranchFixture, submitForReviewWithReviewers } from './fixtures/changeBranchFixture';

test('a contributor sees "Read-only: under review" on an element of a Proposed change, not Edit or Propose a change', async ({ page, browser }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'readonlyreview', 'Ledger Service');
  const { signedIn: owner, userId: ownerId, orgId, orgSlug, modelId, modelSlug, seedSourceId } = fixture;
  // F3a's own architect floor — see addArchitectMember's own doc comment.
  await addArchitectMember(env, orgId, ownerId);

  // 1. Owner creates the change (lands inside) and seeds one delta on it
  // directly — `useSubmitForReview` refuses an empty change, and this test
  // is about the read-only chip, not the create-a-system UI.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const changeTitle = `Under review ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder("What's this change? (e.g. Retire the legacy CRM)").fill(changeTitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page.getByRole('heading', { name: changeTitle })).toBeVisible();
  const branchIdMatch = /\/changes\/([^/?]+)/.exec(page.url());
  if (!branchIdMatch?.[1]) throw new Error(`could not read the branch id out of ${page.url()}`);
  const branchId = branchIdMatch[1];

  const branch = await getBranch(owner, branchId);
  if (!branch?.head_commit_id) throw new Error('change branch has no head commit');
  const systemId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Under Review System', parentId: null, attributes: { lifecycleStatus: 'planned', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: branch.id, parentCommitId: branch.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'add a system', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: branch.id, expectedHeadCommitId: branch.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`under-review fixture: seeding a delta: ${seedResult.message}`);

  // 2. Submit for review — the branch leaves `draft`.
  await submitForReviewWithReviewers(page, false);
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/review/`));

  // 3. A contributor, added directly (`members_insert`'s RLS lets an owner
  // insert any member row — same pattern e2e/add-a-system-flow.spec.ts's
  // own contributor uses; there is no invite UI yet, SPEC §11).
  const contributorContext = await browser.newContext();
  const contributorPage = await contributorContext.newPage();
  const contributorEmail = `readonlyreview-contributor-${randomUUID()}@example.test`;
  const contributorPassword = `${randomUUID()}Aa1!`;
  await contributorPage.goto('/sign-in');
  await contributorPage.getByText("Don't have an account? Create one").click();
  await contributorPage.getByLabel('Email').fill(contributorEmail);
  await contributorPage.getByLabel('Password').fill(contributorPassword);
  await contributorPage.getByRole('button', { name: 'Create account' }).click();
  await expect(contributorPage.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const contributorAuth = createSupabaseClient(env);
  const { error: signInError } = await contributorAuth.auth.signInWithPassword({ email: contributorEmail, password: contributorPassword });
  if (signInError) throw new Error(`under-review fixture contributor sign-in: ${signInError.message}`);
  const { data: contributorData, error: getUserError } = await contributorAuth.auth.getUser();
  if (getUserError) throw new Error(`under-review fixture: could not read the contributor user: ${getUserError.message}`);
  const contributorId = contributorData.user.id;

  const { error: memberError } = await owner.from('members').insert({ org_id: orgId, user_id: contributorId, role: 'contributor', invited_by: ownerId });
  if (memberError) throw new Error(`under-review fixture: could not add contributor: ${memberError.message}`);

  // 4. The contributor views the system on the (now Proposed) branch.
  await contributorPage.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=branch:${branchId}`);
  await expect(contributorPage.getByRole('heading', { name: 'Under Review System' })).toBeVisible();
  await expect(contributorPage.getByText('Read-only: under review')).toBeVisible();
  await expect(contributorPage.getByRole('button', { name: '✎ Edit' })).toHaveCount(0);
  await expect(contributorPage.getByRole('button', { name: 'Propose a change' })).toHaveCount(0);

  await contributorContext.close();
});

/**
 * Sprint C2 (Prompt 7b) step 6: "Playwright for accept-subset -> preview
 * -> split -> merge, and for a blocked retract." Exercises
 * `SplitReviewPanel.tsx` through the real review-request page: two
 * independent systems on one change branch, accept only one, confirm the
 * preview shows nothing pulled in or blocked (they're independent), split
 * and merge, then confirm the accepted system is on main and the other is
 * not — while the original branch itself is untouched (still `proposed`,
 * still carrying both systems).
 *
 * Same "needs a real Supabase" limitation as e2e/change-branch-merge.spec.ts.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { getBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('review queue split: accept one of two independent systems, preview, split, merge — the other stays behind on the original branch', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'splitreview', 'Existing System');
  const { signedIn, orgSlug, modelSlug, modelId, seedSourceId } = fixture;

  // 1. Create the change branch through the real "Changes" form.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const changeTitle = 'Add two independent systems';
  await page.getByPlaceholder('Name (e.g. retire-legacy-crm)').fill(`split-review-${randomUUID().slice(0, 8)}`);
  await page.getByPlaceholder('Title (e.g. Retire the legacy CRM)').fill(changeTitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  const changeRow = page.locator('li', { hasText: changeTitle });
  await expect(changeRow).toBeVisible();
  await changeRow.getByRole('link', { name: 'Open →' }).click();
  await expect(page.getByRole('heading', { name: changeTitle })).toBeVisible();
  const branchIdMatch = /\/changes\/([^/?]+)/.exec(page.url());
  if (!branchIdMatch?.[1]) throw new Error(`could not read the branch id out of ${page.url()}`);
  const branchId = branchIdMatch[1];

  // Two independent systems, seeded directly onto the branch's own head —
  // this test is about the split review UI, not the system-creation UI.
  const branch = await getBranch(signedIn, branchId);
  if (!branch?.head_commit_id) throw new Error('change branch has no head commit');
  const acceptedSystemId = randomUUID();
  const remainderSystemId = randomUUID();
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: branch.id,
    parentCommitId: branch.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'two independent systems',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: acceptedSystemId, elementType: 'system', name: 'Accepted System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: remainderSystemId, elementType: 'system', name: 'Remainder System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: branch.id, expectedHeadCommitId: branch.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`split-review seeding two systems: ${seedResult.message}`);

  // 2. Submit for review.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/review/`));

  // 3. The split panel: two clean changes to choose between.
  const splitPanel = page.locator('section, div').filter({ hasText: 'Split — deliver part of this change now' }).last();
  await expect(splitPanel.getByText('created — Accepted System')).toBeVisible();
  await expect(splitPanel.getByText('created — Remainder System')).toBeVisible();

  await splitPanel.getByText('created — Accepted System').click();
  // Two independent systems pull nothing in and block nothing.
  await expect(splitPanel.getByText('pulled in', { exact: false })).toHaveCount(0);
  await expect(splitPanel.getByText('Blocked:')).toHaveCount(0);

  await splitPanel.getByRole('button', { name: /Split 1 item & merge now/ }).click();
  await expect(splitPanel.getByText('created — Accepted System')).not.toBeVisible({ timeout: 15_000 });

  // 4. Accepted System is on main; Remainder System is not.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  const searchBox = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await searchBox.fill('Accepted System');
  await expect(page.getByRole('link', { name: /Accepted System/ })).toBeVisible();
  await searchBox.fill('Remainder System');
  await expect(page.getByRole('link', { name: /Remainder System/ })).toHaveCount(0);

  // 5. The original branch is untouched — still open for review, still
  // carrying both systems in its own history (ADR-006 amendment rule 1):
  // its own To-be view (the landscape at this branch's own ref) still
  // shows all three systems (the fixture's own "Existing System", plus
  // both of this test's own) — Remainder System never landed on main, but
  // the branch's own history was never touched by the split either.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape?ref=branch:${branchId}`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /3 systems/, { timeout: 30_000 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
  await expect(page.getByText('proposed', { exact: true }).first()).toBeVisible();

  // Step 5's own "Delivered / remaining" panel (ChangeView.tsx,
  // resolveChangeLineage) — real data now that a real split exists, not
  // the always-empty state it rendered before any split mechanic did.
  const deliveredPanel = page.locator('section, div').filter({ hasText: 'Delivered / remaining' }).last();
  await expect(deliveredPanel.getByText('delivered', { exact: true })).toBeVisible();

});

/**
 * A merge conflict class, end to end through the real review-queue UI (the
 * user's brief: "Tests: engine merge classes end-to-end via UI"). Every
 * conflict class src/engine/merge.ts classifies is already exhaustively
 * unit-tested at the engine level (src/engine/merge.test.ts's 18 cases,
 * one describe block per class in SPEC §7.3's own table) — this is
 * deliberately not eight browser tests re-proving that same classification
 * logic. It proves the one thing the engine tests can't: that a real
 * `FIELD_CONFLICT` — the class SPEC §7.4 gives a bespoke one-click
 * resolution ("keep this change / keep main / enter a value") — actually
 * renders with its three-way context, blocks approval, resolves, and
 * produces the *chosen* value after merge, driven entirely through the
 * browser against a real Supabase.
 *
 * Sets up the conflict directly through the repository layer (two
 * independent edits to the same attribute, diverging from the same
 * `element.create` delta — exactly src/engine/branch.ts's `diffFacts`
 * FIELD_CONFLICT case) rather than through the UI a second time; Sprint
 * C1's own e2e/change-branch-merge.spec.ts already proves creating a
 * change and editing it through the browser. Same "needs a real Supabase"
 * limitation as every spec here (e2e/element-edit.spec.ts's own comment).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { createChangeBranch, getBranch } from '../src/db/branches';
import { loadEnv } from '../src/db/env';
import { commitToBranch } from '../src/db/commits';
import { computeMergeReviewForBranch, submitMergeRequest } from '../src/db/mergeRequests';
import { addArchitectMember, bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('a field conflict renders with its three-way context, resolves with one click, and the chosen value survives the merge', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'fieldconflict', 'Payments Service');
  const { signedIn, orgId, orgSlug, modelId, modelSlug, userId, main, seedCommitId, createDeltaId, seedSourceId, systemId } = fixture;
  // F3a's own architect floor — see addArchitectMember's own doc comment.
  // The owner (userId) is included in the reviewer set too: they cast the
  // approve verdict below, which needs them to actually be one.
  const architectUserId = await addArchitectMember(env, orgId, userId);

  // The change branch: forks at the seed commit, then edits vendor independently of main.
  const branchId = randomUUID();
  await createChangeBranch(signedIn, { id: branchId, orgId, modelId, name: 'change-vendor', title: 'Change the vendor', createdBy: userId, intent: 'propose', mainHeadCommitId: seedCommitId });

  const branchEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId,
    parentCommitId: seedCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'branch: set vendor to Branch Value',
    body: null,
    deltas: [{ kind: 'element.update', id: randomUUID(), elementId: systemId, elementType: 'system', attribute: 'vendor', value: 'Branch Value', previousDeltaId: createDeltaId, sourceId: seedSourceId, confidence: 1 }],
  };
  const branchResult = await commitToBranch(signedIn, { modelId, branchId, expectedHeadCommitId: seedCommitId, envelope: branchEnvelope });
  if (!branchResult.ok) throw new Error(`branch edit: ${branchResult.message}`);

  // Main, independently, sets the same attribute to a different value —
  // the FIELD_CONFLICT: both sides diverge from `createDeltaId`'s original
  // (absent) vendor value, to different values.
  const mainEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: seedCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'main: set vendor to Main Value',
    body: null,
    deltas: [{ kind: 'element.update', id: randomUUID(), elementId: systemId, elementType: 'system', attribute: 'vendor', value: 'Main Value', previousDeltaId: createDeltaId, sourceId: seedSourceId, confidence: 1 }],
  };
  const mainResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: seedCommitId, envelope: mainEnvelope });
  if (!mainResult.ok) throw new Error(`main edit: ${mainResult.message}`);

  // Submit for review through the same computation and RPC the change
  // page's own "Submit for review" button calls (src/ui/changes/useSubmitForReview.ts).
  const branch = await getBranch(signedIn, branchId);
  if (!branch) throw new Error('branch disappeared before submit');
  const computed = await computeMergeReviewForBranch(signedIn, modelId, branch);
  if (!computed) throw new Error('computeMergeReviewForBranch returned null');
  expect(computed.review.classification.hasBlockingConflict).toBe(true);
  const mergeRequestId = randomUUID();
  await submitMergeRequest(signedIn, mergeRequestId, branchId, computed.review, [
    { userId, required: true },
    { userId: architectUserId, required: true },
  ]);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/review/${mergeRequestId}`);

  // The field-conflict card, with its three-way context (SPEC §7.4).
  await expect(page.getByRole('heading', { name: 'Field conflicts' })).toBeVisible();
  const card = page.locator('li', { hasText: 'Payments Service' }).filter({ hasText: 'vendor' });
  await expect(card.getByText('Branch Value')).toBeVisible();
  await expect(card.getByText('Main Value')).toBeVisible();

  // Blocking: Approve is disabled until this resolves.
  const approveButton = page.getByRole('button', { name: 'Approve' });
  await expect(approveButton).toBeDisabled();

  // Root-caused (Sprint C1-H item 1): a branch under review only accepts a
  // new commit while `status = 'draft'` (SPEC S-18) — submitting moved it
  // to `proposed`, and ReviewRequestView.tsx's own resubmit button is
  // gated on that same `draft` status for the identical reason (the button
  // simply doesn't render on a `proposed` branch, which is what a bare
  // `getByRole('button', { name: /resubmit/ })` waiting forever turned out
  // to mean — not a stagedChoiceCount/state-sync bug). "Keep this change"
  // itself is plain client state and stages fine on a `proposed` branch,
  // but pushing that resolution needs the branch reopened first, exactly
  // as docs/SPEC-data-model.md's §7.4 implementation note and
  // useReviewRequest.ts's own `pushRefreshAndResubmit` doc comment say.
  await page.getByRole('button', { name: 'Reopen for edits' }).click();
  await expect(page.getByText('changes requested', { exact: true })).toBeVisible();

  // One-click resolution: "keep this change" (SPEC §7.4's first action).
  await card.getByRole('button', { name: 'Keep this change' }).click();
  await expect(card.getByText('Staged: keep this change')).toBeVisible();
  await page.getByRole('button', { name: /Push refresh \(1 resolved\) & resubmit/ }).click();

  // Refreshed: the conflict is gone, Approve is enabled.
  await expect(page.getByRole('heading', { name: 'Field conflicts' })).toHaveCount(0);
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Merge' }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  // Main now carries the *chosen* value — not main's own, not a silent
  // overwrite (src/engine/mergeResolution.ts's own reasoning for why this
  // needs an explicit resolution delta at all). `exact: true`, not a bare
  // substring match: HistoryTimeline.tsx renders every delta ever asserted
  // about this subject as `${attribute}: ${JSON.stringify(value)}` — both
  // the branch's original edit and the merge's own resolution delta assert
  // "Branch Value" (two rows), and main's own superseded edit still shows
  // "Main Value" in that same audit trail (Playwright strict mode rejects
  // a bare substring match resolving any of that); the exact node text is
  // what actually distinguishes "the value now says this" from "some delta
  // somewhere mentions this".
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByText('Branch Value', { exact: true })).toBeVisible();
  await expect(page.getByText('Main Value', { exact: true })).toHaveCount(0);
});

/**
 * Prompt pack F0/PR3: review weight per intent. `record`/`correct`
 * changes get a one-click "Approve & merge" on their own page and never
 * appear in the shared review queue at `/review`; `propose`/`explore`
 * keep today's ordinary two-step flow (open the request, Approve, then
 * Merge) completely unchanged. The underlying `merge_requests` mechanism
 * is identical either way — `atlas.approve_merge_request`'s own lack of a
 * self-review check (confirmed by reading it directly, PR1's own research)
 * is what lets the same owner user submit, approve and merge a record
 * change from one session, exactly as a solo maintainer would today.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

function seedSystemDelta(elementId: string, name: string, sourceId: string): Delta {
  return { kind: 'element.create', id: randomUUID(), elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 };
}

test('a record change merges in one click from its own page and never appears in /review; a propose change is unaffected', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'reviewweight', 'Ledger Service');
  const { signedIn: owner, orgSlug, modelId, modelSlug, seedSourceId } = fixture;

  // 1. Record: "What happened" (F0's own record-default entry point).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await page.getByRole('button', { name: 'What happened' }).click();
  const recordName = `deployed-ledger-${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Name (e.g. retire-northgate)').fill(recordName);
  await page.getByRole('button', { name: 'Create & continue' }).click();

  // Lands on the change's own page — the header names its own intent
  // (`intentHeaderLine`'s "Recording: {title}", PR2).
  await expect(page.getByRole('heading', { name: new RegExp(`Recording: ${recordName}`) })).toBeVisible();
  const recordBranchIdMatch = /\/changes\/([^/?]+)/.exec(page.url());
  if (!recordBranchIdMatch?.[1]) throw new Error(`could not read the record branch id out of ${page.url()}`);
  const recordBranchId = recordBranchIdMatch[1];

  // useSubmitForReview refuses an empty change — seeded directly, same
  // precedent as e2e/element-read-only-under-review.spec.ts.
  const recordBranch = await getBranch(owner, recordBranchId);
  if (!recordBranch?.head_commit_id) throw new Error('record branch has no head commit');
  const recordSystemId = randomUUID();
  const recordEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: recordBranch.id,
    parentCommitId: recordBranch.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'record a deployed system',
    body: null,
    deltas: [seedSystemDelta(recordSystemId, 'Recorded System', seedSourceId)],
  };
  const recordSeedResult = await commitToBranch(owner, { modelId, branchId: recordBranch.id, expectedHeadCommitId: recordBranch.head_commit_id, envelope: recordEnvelope });
  if (!recordSeedResult.ok) throw new Error(`reviewweight fixture: seeding the record branch: ${recordSeedResult.message}`);

  await page.reload();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/review/`));
  await expect(page.getByText('pending', { exact: true })).toBeVisible();

  // While pending, this record change is real and open, but never listed
  // in the shared queue (`useReviewQueue.ts`'s own intent filter) — the
  // point this test exists to prove, distinct from "a merged request isn't
  // listed either," which would be true regardless of any filter.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/review`);
  await expect(page.getByText(recordName)).toHaveCount(0);

  // Back on its own page: the one-click action, gated on role
  // (`canApproveOrMergeRequest`) exactly like the queue's own Approve —
  // this owner is also the one who just submitted it, which is legal
  // today (no self-review check, confirmed directly against
  // `atlas.approve_merge_request`).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${recordBranchId}`);
  const approveAndMergeButton = page.getByRole('button', { name: 'Approve & merge' });
  await expect(approveAndMergeButton).toBeVisible();
  await approveAndMergeButton.click();
  await expect(page.getByTestId('stepper-merged')).toHaveAttribute('data-step-state', 'current', { timeout: 15_000 });
  await expect(page.getByText('Merged into main.')).toBeVisible();

  // 2. Propose: today's ordinary flow, completely unaffected — the queue
  // still lists it, and its own page offers "Open review →" only, never
  // the one-click action.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await page.getByRole('button', { name: 'Propose a change' }).click();
  const proposeName = `replace-ledger-vendor-${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Name (e.g. retire-northgate)').fill(proposeName);
  await page.getByRole('button', { name: 'Create & continue' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Proposing: ${proposeName}`) })).toBeVisible();
  const proposeBranchIdMatch = /\/changes\/([^/?]+)/.exec(page.url());
  if (!proposeBranchIdMatch?.[1]) throw new Error(`could not read the propose branch id out of ${page.url()}`);
  const proposeBranchId = proposeBranchIdMatch[1];

  const proposeBranch = await getBranch(owner, proposeBranchId);
  if (!proposeBranch?.head_commit_id) throw new Error('propose branch has no head commit');
  const proposeSystemId = randomUUID();
  const proposeEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: proposeBranch.id,
    parentCommitId: proposeBranch.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'propose a new vendor',
    body: null,
    deltas: [seedSystemDelta(proposeSystemId, 'Proposed System', seedSourceId)],
  };
  const proposeSeedResult = await commitToBranch(owner, { modelId, branchId: proposeBranch.id, expectedHeadCommitId: proposeBranch.head_commit_id, envelope: proposeEnvelope });
  if (!proposeSeedResult.ok) throw new Error(`reviewweight fixture: seeding the propose branch: ${proposeSeedResult.message}`);

  await page.reload();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/review/`));

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/review`);
  await expect(page.getByText(proposeName)).toBeVisible();

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${proposeBranchId}`);
  await expect(page.getByRole('button', { name: 'Approve & merge' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open review →' })).toBeVisible();
});

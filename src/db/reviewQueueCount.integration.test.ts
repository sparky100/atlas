/**
 * F9 step 2: the review queue's count, behind the Changes nav badge and
 * the Changes page's "Review queue" tab (UI-principles §2.0). Proves the
 * two count queries agree with what `ReviewQueueView` lists — open
 * requests for propose/explore changes count, a correct change's request
 * doesn't (F0: record/correct merge from the change page), a closed
 * request doesn't, and a capture draft waiting for review (`parsed`) does —
 * against a real local Supabase with real RLS.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UUID } from '../contracts/delta';
import { cancelChange, createChangeBranch, getBranch, getMainBranch } from './branches';
import { countCaptureDraftsAwaitingReview } from './captureJobs';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { computeMergeReviewForBranch, countReviewQueueMergeRequests, submitMergeRequest } from './mergeRequests';
import { createModel } from './models';
import { createOrganisation } from './organisations';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  client: Client;
}

async function createSignedInUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);

  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);

  return { id: created.user.id, client: signIn };
}

describe('review queue count against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let contributor: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let modelId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('rqcount-owner');
    architect = await createSignedInUser('rqcount-architect');
    contributor = await createSignedInUser('rqcount-contributor');
    viewer = await createSignedInUser('rqcount-viewer');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Review Queue Count Test Org', slug: `rqcount-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      // F3a's architect floor: a propose-intent submit needs an architect in the reviewer set.
      { org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id },
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Review Queue Count Test Model', slug: `rqcount-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  async function submittedChange(intent: 'propose' | 'explore' | 'correct'): Promise<UUID> {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    const branchId = randomUUID();
    await createChangeBranch(owner.client, { id: branchId, orgId, modelId, name: `rq-${intent}-${randomUUID().slice(0, 8)}`, createdBy: owner.id, intent, mainHeadCommitId: main.head_commit_id });
    const branch = await getBranch(owner.client, branchId);
    if (!branch) throw new Error('branch missing');
    const computed = await computeMergeReviewForBranch(owner.client, modelId, branch);
    if (!computed) throw new Error('could not compute a merge review');
    // F0: propose/explore carry a reviewer set; correct goes the single-approver way with none.
    const reviewers = intent === 'correct' ? null : [{ userId: architect.id, required: true }];
    await submitMergeRequest(owner.client, randomUUID(), branchId, computed.review, reviewers);
    return branchId;
  }

  it('starts at zero for a new model', async () => {
    expect(await countReviewQueueMergeRequests(owner.client, modelId)).toBe(0);
    expect(await countCaptureDraftsAwaitingReview(owner.client, modelId)).toBe(0);
  });

  it('counts open propose and explore requests, never a correct change\'s, and drops a request once its change is cancelled', async () => {
    const proposeBranchId = await submittedChange('propose');
    await submittedChange('explore');
    await submittedChange('correct');

    expect(await countReviewQueueMergeRequests(owner.client, modelId)).toBe(2);
    // A contributor sees the same queue, so the same number.
    expect(await countReviewQueueMergeRequests(contributor.client, modelId)).toBe(2);
    // A viewer can't read merge requests at all (`merge_requests_select`),
    // so their queue is empty (UI-principles §3.3) — and so is their count:
    // the badge never claims items the queue it leads to won't show.
    expect(await countReviewQueueMergeRequests(viewer.client, modelId)).toBe(0);

    await cancelChange(owner.client, proposeBranchId, 'No longer needed.');
    expect(await countReviewQueueMergeRequests(owner.client, modelId)).toBe(1);
  });

  it('counts capture drafts waiting for review (parsed), not pending or reviewed ones', async () => {
    const jobIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const jobId of jobIds) {
      const inputName = `Applications-${jobId.slice(0, 8)}.xlsx`;
      const { error } = await owner.client.from('capture_jobs').insert({
        id: jobId,
        org_id: orgId,
        model_id: modelId,
        input_kind: 'spreadsheet',
        input_name: inputName,
        input_ref: `capture-inputs/${orgId}/${modelId}/${jobId}/${inputName}`,
        input_sha256: '\\x' + '00'.repeat(32),
        document_date: '2026-02-01',
        created_by: owner.id,
      });
      if (error) throw new Error(`insert capture job: ${error.message}`);
    }
    // Status moves are the capture pipeline's (service role) job, never a client's — set directly here as test setup only.
    const [parsedId, reviewedId] = jobIds;
    await service.from('capture_jobs').update({ status: 'parsed' }).eq('id', parsedId);
    await service.from('capture_jobs').update({ status: 'reviewed' }).eq('id', reviewedId);

    expect(await countCaptureDraftsAwaitingReview(owner.client, modelId)).toBe(1);
  });

  it('a non-member counts nothing (RLS)', async () => {
    const outsider = await createSignedInUser('rqcount-outsider');
    expect(await countReviewQueueMergeRequests(outsider.client, modelId)).toBe(0);
    expect(await countCaptureDraftsAwaitingReview(outsider.client, modelId)).toBe(0);
  });
});

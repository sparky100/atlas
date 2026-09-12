/**
 * S1 item 4: "Cancel a change: proposer or owner/architect, Draft or
 * Proposed; status -> cancelled." CLAUDE.md rule 1's round-trip test for
 * the new `branch_status` enum value + `atlas.cancel_change` RPC, same
 * shape as `modelArchive.integration.test.ts`'s own archive/restore
 * coverage — real Supabase, real RLS, no shortcuts.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelChange, createChangeBranch, getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { computeMergeReviewForBranch, listOpenMergeRequestsForModel, submitMergeRequest } from './mergeRequests';
import { createModel } from './models';
import { createOrganisation } from './organisations';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  email: string;
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

  return { id: created.user.id, email, client: signIn };
}

describe('cancel a change against a real local Supabase', () => {
  let owner: TestUser;
  let contributor: TestUser;
  let bystander: TestUser;
  let orgId: string;
  let modelId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('cancelchange-owner');
    contributor = await createSignedInUser('cancelchange-contributor');
    bystander = await createSignedInUser('cancelchange-bystander');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Cancel Change Test Org', slug: `cancelchange-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: bystander.id, role: 'contributor', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Cancel Change Test Model', slug: `cancelchange-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  async function newDraftBranch(createdBy: TestUser): Promise<string> {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    const branchId = randomUUID();
    await createChangeBranch(createdBy.client, { id: branchId, orgId, modelId, name: `doomed-${randomUUID().slice(0, 8)}`, createdBy: createdBy.id, mainHeadCommitId: main.head_commit_id });
    return branchId;
  }

  it('a reason is required', async () => {
    const branchId = await newDraftBranch(contributor);
    await expect(cancelChange(contributor.client, branchId, '')).rejects.toThrow(/reason is required/);
    await expect(cancelChange(contributor.client, branchId, '   ')).rejects.toThrow(/reason is required/);
  });

  it('the proposer can cancel their own draft — status, reason, and actor round-trip', async () => {
    const branchId = await newDraftBranch(contributor);
    const cancelled = await cancelChange(contributor.client, branchId, 'No longer needed.');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancel_reason).toBe('No longer needed.');
    expect(cancelled.cancelled_by).toBe(contributor.id);
    expect(cancelled.cancelled_at).not.toBeNull();

    const refetched = await getBranch(owner.client, branchId);
    expect(refetched?.status).toBe('cancelled');
    expect(refetched?.cancel_reason).toBe('No longer needed.');
  });

  it('a bystander contributor (not the proposer, not owner/architect) is refused', async () => {
    const branchId = await newDraftBranch(contributor);
    await expect(cancelChange(bystander.client, branchId, 'Trying anyway.')).rejects.toThrow(/only the proposer or an owner\/architect/);
  });

  it('an owner can cancel a Proposed branch that isn\'t theirs — its open merge request closes too, dropping it from the queue', async () => {
    const branchId = await newDraftBranch(contributor);
    const branch = await getBranch(contributor.client, branchId);
    if (!branch) throw new Error('branch missing');
    const computed = await computeMergeReviewForBranch(contributor.client, modelId, branch);
    if (!computed) throw new Error('nothing to submit — branch has no commits of its own');
    await submitMergeRequest(contributor.client, randomUUID(), branchId, computed.review);

    const beforeCancel = await listOpenMergeRequestsForModel(owner.client, modelId);
    expect(beforeCancel.some((r) => r.branch_id === branchId)).toBe(true);

    const cancelled = await cancelChange(owner.client, branchId, 'Superseded by another change.');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelled_by).toBe(owner.id);

    const afterCancel = await listOpenMergeRequestsForModel(owner.client, modelId);
    expect(afterCancel.some((r) => r.branch_id === branchId)).toBe(false);
  });

  it('cancelling an already-cancelled (or otherwise closed) branch is refused', async () => {
    const branchId = await newDraftBranch(contributor);
    await cancelChange(contributor.client, branchId, 'First cancel.');
    await expect(cancelChange(contributor.client, branchId, 'Second cancel.')).rejects.toThrow(/must be draft or proposed/);
  });

  it('cancelling main is refused (not a change branch)', async () => {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    await expect(cancelChange(owner.client, main.id, 'Not a real change.')).rejects.toThrow(/not a change branch/);
  });
});

/**
 * Integration tests for F3a's multiple-reviewer verdict flow against a real
 * local Supabase — the submit-side reviewer set, the per-reviewer verdict
 * RPC (`atlas.set_review_verdict`), the merge gate ("every required reviewer
 * approved"), and the any-request-changes reset. Needs `pnpm db:start`
 * (a running local Supabase), like repository.integration.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { createChangeBranch, getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { computeMergeReviewForBranch, getMergeRequestById, submitMergeRequest } from './mergeRequests';
import { createModel } from './models';
import { getUnreadNotificationCount, listMyNotifications } from './notifications';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';
import { listReviewVerdictsForRequest, setReviewVerdict } from './reviewVerdicts';
import { upsertUserPreferences } from './userPreferences';

const env = loadEnv();
const service = createServiceRoleClient(env);

async function createSignedInUser(label: string): Promise<{ id: string; client: Client }> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);
  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);
  return { id: created.user.id, client: signIn };
}

function makeSystem(id: string, elementId: string, name: string, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 };
}

describe('F3a review verdicts against a real local Supabase', () => {
  let owner: { id: string; client: Client };
  let architect: { id: string; client: Client };
  let orgId: string;
  let modelId: string;
  let sourceId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('verdict-owner');
    architect = await createSignedInUser('verdict-architect');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Verdict Test Org', slug: `verdict-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert({ org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id });
    if (memberError) throw new Error(`add architect: ${memberError.message}`);
    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Verdict Test Model', slug: `verdict-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    sourceId = source.id;
  });

  afterAll(async () => {
    await service.auth.admin.deleteUser(owner.id);
    await service.auth.admin.deleteUser(architect.id);
  });

  async function proposeChange(name: string): Promise<{ branchId: string; requestId: string }> {
    const main = await getMainBranch(owner.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const branch = await createChangeBranch(owner.client, { id: randomUUID(), orgId, modelId, name, createdBy: owner.id, intent: 'propose', mainHeadCommitId: main.head_commit_id });
    if (!branch.head_commit_id) throw new Error('branch has no head at creation');
    const commitResult = await commitToBranch(owner.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: branch.head_commit_id,
      envelope: { id: randomUUID(), branchId: branch.id, parentCommitId: branch.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'add a system', body: null, deltas: [makeSystem(randomUUID(), randomUUID(), `${name} System`, sourceId)] },
    });
    expect(commitResult).toMatchObject({ ok: true });
    const branchAfter = await getBranch(owner.client, branch.id);
    if (!branchAfter) throw new Error('branch not found after commit');
    const computed = await computeMergeReviewForBranch(owner.client, modelId, branchAfter);
    if (!computed) throw new Error('could not compute merge review');
    const requestId = randomUUID();
    const reviewers = [
      { userId: owner.id, required: true },
      { userId: architect.id, required: true },
    ];
    await submitMergeRequest(owner.client, requestId, branch.id, computed.review, reviewers);
    return { branchId: branch.id, requestId };
  }

  it('writes a pending verdict row per reviewer, and the merge gate only opens once every required reviewer approves', async () => {
    const { requestId } = await proposeChange('gate');

    const pending = await listReviewVerdictsForRequest(owner.client, requestId);
    expect(pending).toHaveLength(2);
    expect(pending.every((v) => v.verdict === 'pending')).toBe(true);

    // One required approval is not enough — the other required seat is still pending.
    await setReviewVerdict(owner.client, requestId, 'approve');
    expect((await getMergeRequestById(owner.client, requestId))?.status).toBe('pending');

    // The second required approval opens the gate.
    await setReviewVerdict(architect.client, requestId, 'approve');
    expect((await getMergeRequestById(owner.client, requestId))?.status).toBe('approved');
  });

  it('an abstain does not satisfy a required seat, but a third optional reviewer abstaining never blocks', async () => {
    const { requestId } = await proposeChange('abstain');
    await setReviewVerdict(owner.client, requestId, 'abstain');
    expect((await getMergeRequestById(owner.client, requestId))?.status).toBe('pending');
    await setReviewVerdict(owner.client, requestId, 'approve');
    await setReviewVerdict(architect.client, requestId, 'approve');
    expect((await getMergeRequestById(owner.client, requestId))?.status).toBe('approved');
  });

  it('any request_changes returns the request to changes_requested and its branch to draft', async () => {
    const { branchId, requestId } = await proposeChange('reject');
    await setReviewVerdict(owner.client, requestId, 'approve');
    await setReviewVerdict(architect.client, requestId, 'request_changes', 'needs more work');
    expect((await getMergeRequestById(owner.client, requestId))?.status).toBe('changes_requested');
    expect((await getBranch(owner.client, branchId))?.status).toBe('draft');
  });

  it('F7 item 3 follow-up: an assigned reviewer who opted out gets no review_assigned notification, but the verdict row still exists', async () => {
    await upsertUserPreferences(architect.client, { userId: architect.id, notifyOnReviewAssigned: false });
    try {
      const before = await getUnreadNotificationCount(architect.client, architect.id);
      const { requestId } = await proposeChange('notify-opt-out');

      // The assignment itself is unconditional — the preference only gates the notification.
      const verdicts = await listReviewVerdictsForRequest(owner.client, requestId);
      expect(verdicts.find((v) => v.user_id === architect.id)).toMatchObject({ verdict: 'pending' });

      const after = await getUnreadNotificationCount(architect.client, architect.id);
      expect(after).toBe(before);
      const notifications = await listMyNotifications(architect.client, architect.id, { unreadOnly: true });
      expect(notifications.find((n) => n.merge_request_id === requestId)).toBeUndefined();
    } finally {
      await upsertUserPreferences(architect.client, { userId: architect.id, notifyOnReviewAssigned: true });
    }
  });

  it('a non-reviewer member cannot cast a verdict', async () => {
    const { requestId } = await proposeChange('nonreviewer');
    const outsider = await createSignedInUser('verdict-outsider');
    const { error: inviteError } = await owner.client.from('members').insert({ org_id: orgId, user_id: outsider.id, role: 'contributor', invited_by: owner.id });
    if (inviteError) throw new Error(`add outsider: ${inviteError.message}`);
    await expect(setReviewVerdict(outsider.client, requestId, 'approve')).rejects.toThrow();
    await service.auth.admin.deleteUser(outsider.id);
  });
});

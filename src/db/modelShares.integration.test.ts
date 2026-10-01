/**
 * F7 item 4: `model_shares` against a real local Supabase. Same
 * "this sandbox has no Docker route" limitation named in
 * `repository.integration.test.ts`'s own module comment — written and
 * reasoned through against the real RLS/RPC/trigger behaviour, not
 * executed here.
 *
 * Implements P-24 directly (SPEC-data-model.md §10.6): a member of a
 * shared-with org sees exactly the pinned tag's commit and heads
 * (tag-pinned) or main's commits and heads (unpinned), never branches,
 * comments, decisions or sources, nothing after `expires_at`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import { createChangeBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { createDecision } from './decisions';
import { loadEnv } from './env';
import { createModel, getModelById } from './models';
import { createModelShare, listModelsSharedWithOrg, resolveOrganisationForSharing, revokeModelShare } from './modelShares';
import { createOrganisation, getOrganisationById } from './organisations';
import { getOrCreateManualSource } from './sources';
import { createTag } from './tags';

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

async function createOrgWithMember(ownerLabel: string, memberLabel: string): Promise<{ orgId: string; slug: string; owner: TestUser; member: TestUser }> {
  const owner = await createSignedInUser(ownerLabel);
  const member = await createSignedInUser(memberLabel);
  const orgId = randomUUID();
  const slug = `${ownerLabel}-${orgId.slice(0, 8)}`;
  await createOrganisation(owner.client, { id: orgId, name: `${ownerLabel} org`, slug, createdBy: owner.id });
  const { error } = await owner.client.from('members').insert({ org_id: orgId, user_id: member.id, role: 'viewer', invited_by: owner.id });
  if (error) throw new Error(`add member to ${ownerLabel}: ${error.message}`);
  return { orgId, slug, owner, member };
}

describe('model_shares against a real local Supabase (P-24)', () => {
  let owner: TestUser;
  let architect: TestUser;
  let ownerOrgId: string;
  let ownerOrgSlug: string;
  let modelId: string;
  let modelSlug: string;
  let elementId: string;
  let commit1Id: string; // genesis: creates the element
  let commit2Id: string; // update — tagged here
  let commit3Id: string; // a later commit on main, after the tag
  let tagId: string;
  let tagName: string;
  let changeBranchId: string;
  let decisionId: string;

  // Three separate shared-with orgs, one per scenario, so revoking/expiring
  // one never disturbs another still under test.
  let unpinnedOrg: { orgId: string; owner: TestUser; member: TestUser };
  let pinnedOrg: { orgId: string; owner: TestUser; member: TestUser };
  let expiredOrg: { orgId: string; owner: TestUser; member: TestUser };
  let outsiderOrg: { orgId: string; owner: TestUser; member: TestUser };

  beforeAll(async () => {
    owner = await createSignedInUser('modelshares-owner');
    architect = await createSignedInUser('modelshares-architect');
    ownerOrgId = randomUUID();
    ownerOrgSlug = `modelshares-owner-${ownerOrgId.slice(0, 8)}`;
    await createOrganisation(owner.client, { id: ownerOrgId, name: 'Model Shares Owner Org', slug: ownerOrgSlug, createdBy: owner.id });
    const { error: architectError } = await owner.client.from('members').insert({ org_id: ownerOrgId, user_id: architect.id, role: 'architect', invited_by: owner.id });
    if (architectError) throw new Error(`add architect: ${architectError.message}`);

    modelId = randomUUID();
    modelSlug = `modelshares-model-${modelId.slice(0, 8)}`;
    await createModel(owner.client, { id: modelId, orgId: ownerOrgId, name: 'Model Shares Test Model', slug: modelSlug, createdBy: owner.id });

    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId: ownerOrgId, modelId, userId: owner.id });
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');

    elementId = randomUUID();
    const createDelta: Delta = { kind: 'element.create', id: randomUUID(), elementId, elementType: 'system', name: 'Shared System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 };
    commit1Id = randomUUID();
    const envelope1: CommitEnvelope = { id: commit1Id, branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed', body: null, deltas: [createDelta] };
    const result1 = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: envelope1 });
    if (!result1.ok) throw new Error(`commit1: ${result1.message}`);

    const updateDelta: Delta = { kind: 'element.update', id: randomUUID(), elementId, elementType: 'system', attribute: 'vendor', value: 'Acme', previousDeltaId: createDelta.id, sourceId: source.id, confidence: 1 };
    commit2Id = randomUUID();
    const envelope2: CommitEnvelope = { id: commit2Id, branchId: main.id, parentCommitId: commit1Id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'update', body: null, deltas: [updateDelta] };
    const result2 = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: commit1Id, envelope: envelope2 });
    if (!result2.ok) throw new Error(`commit2: ${result2.message}`);

    tagId = randomUUID();
    tagName = `v-${randomUUID().slice(0, 8)}`;
    await createTag(owner.client, { id: tagId, orgId: ownerOrgId, modelId, name: tagName, commitId: commit2Id, createdBy: owner.id });

    const updateDelta2: Delta = { kind: 'element.update', id: randomUUID(), elementId, elementType: 'system', attribute: 'vendor', value: 'Globex', previousDeltaId: updateDelta.id, sourceId: source.id, confidence: 1 };
    commit3Id = randomUUID();
    const envelope3: CommitEnvelope = { id: commit3Id, branchId: main.id, parentCommitId: commit2Id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'update again', body: null, deltas: [updateDelta2] };
    const result3 = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: commit2Id, envelope: envelope3 });
    if (!result3.ok) throw new Error(`commit3: ${result3.message}`);

    changeBranchId = randomUUID();
    await createChangeBranch(owner.client, { id: changeBranchId, orgId: ownerOrgId, modelId, name: `modelshares-change-${randomUUID().slice(0, 8)}`, createdBy: owner.id, intent: 'propose', mainHeadCommitId: commit3Id });

    const { error: commentError } = await owner.client.from('comments').insert({ id: randomUUID(), org_id: ownerOrgId, model_id: modelId, anchor_type: 'element', anchor_id: elementId, body: 'A comment nobody outside this org should see.', author_id: owner.id });
    if (commentError) throw new Error(`seed comment: ${commentError.message}`);

    const decision = await createDecision(owner.client, { id: randomUUID(), orgId: ownerOrgId, modelId, title: 'A decision nobody outside this org should see', statement: 'Statement', ownerId: owner.id, createdBy: owner.id });
    decisionId = decision.id;

    unpinnedOrg = await createOrgWithMember('modelshares-unpinned', 'modelshares-unpinned-member');
    pinnedOrg = await createOrgWithMember('modelshares-pinned', 'modelshares-pinned-member');
    expiredOrg = await createOrgWithMember('modelshares-expired', 'modelshares-expired-member');
    outsiderOrg = await createOrgWithMember('modelshares-outsider', 'modelshares-outsider-member');

    await createModelShare(owner.client, { id: randomUUID(), modelId, tagId: null, sharedWithOrgId: unpinnedOrg.orgId, createdBy: owner.id });
    await createModelShare(owner.client, { id: randomUUID(), modelId, tagId, sharedWithOrgId: pinnedOrg.orgId, createdBy: owner.id });

    const expiredShareId = randomUUID();
    await createModelShare(owner.client, { id: expiredShareId, modelId, tagId: null, sharedWithOrgId: expiredOrg.orgId, createdBy: owner.id });
    // createModelShare has no expires_at param (a fresh share is never
    // created pre-expired in real use) — set it directly via service role,
    // the same "reach past the client wrapper for a fixture-only state"
    // technique used wherever a test needs a state no real call produces.
    const { error: expireError } = await service.from('model_shares').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', expiredShareId);
    if (expireError) throw new Error(`expire share: ${expireError.message}`);
    // outsiderOrg gets no share at all.
  });

  afterAll(async () => {
    for (const orgId of [ownerOrgId, unpinnedOrg.orgId, pinnedOrg.orgId, expiredOrg.orgId, outsiderOrg.orgId]) {
      await service.from('organisations').delete().eq('id', orgId);
    }
  });

  it('a model cannot be shared with its own organisation', async () => {
    await expect(createModelShare(owner.client, { id: randomUUID(), modelId, tagId: null, sharedWithOrgId: ownerOrgId, createdBy: owner.id })).rejects.toThrow();
  });

  it('an architect cannot create a share (model_shares_insert is owner-only, narrower than models_update)', async () => {
    await expect(createModelShare(architect.client, { id: randomUUID(), modelId, tagId: null, sharedWithOrgId: unpinnedOrg.orgId, createdBy: architect.id })).rejects.toThrow();
  });

  describe('unpinned share ("current main")', () => {
    it("resolves the model, sees every main commit, and sees every head main retains", async () => {
      expect(await getModelById(unpinnedOrg.member.client, modelId)).not.toBeNull();

      for (const commitId of [commit1Id, commit2Id, commit3Id]) {
        const { data: commitRow, error } = await unpinnedOrg.member.client.from('commits').select('id').eq('id', commitId).maybeSingle();
        expect(error).toBeNull();
        expect(commitRow?.id).toBe(commitId);
      }

      // Head rows exist only for main's current head and tagged commits
      // (ADR-015, SPEC P-6) — commit3 and the tagged commit2 here; commit1's
      // were garbage-collected, so there is nothing for any reader to see.
      for (const commitId of [commit2Id, commit3Id]) {
        const { data: headRows, error: headError } = await unpinnedOrg.member.client.from('elements_head').select('element_id').eq('commit_id', commitId).eq('element_id', elementId);
        expect(headError).toBeNull();
        expect(headRows).toHaveLength(1);
      }
    });

    it('never sees the change branch, the comment, the decision, or the source', async () => {
      const { data: branchRow } = await unpinnedOrg.member.client.from('branches').select('id').eq('id', changeBranchId).maybeSingle();
      expect(branchRow).toBeNull();

      const { data: commentRows } = await unpinnedOrg.member.client.from('comments').select('id').eq('model_id', modelId);
      expect(commentRows).toEqual([]);

      const { data: decisionRows } = await unpinnedOrg.member.client.from('decisions').select('id').eq('id', decisionId);
      expect(decisionRows).toEqual([]);

      const { data: sourceRows } = await unpinnedOrg.member.client.from('sources').select('id').eq('model_id', modelId);
      expect(sourceRows).toEqual([]);
    });

    it('sees no tags at all — the share is unpinned, so no tag is "specifically shared"', async () => {
      const { data: tagRows } = await unpinnedOrg.member.client.from('tags').select('id').eq('model_id', modelId);
      expect(tagRows).toEqual([]);
    });

    it('shows up in listModelsSharedWithOrg for the shared-with org, with no tag name', async () => {
      const shared = await listModelsSharedWithOrg(unpinnedOrg.owner.client, unpinnedOrg.orgId);
      expect(shared).toHaveLength(1);
      const [entry] = shared;
      expect(entry?.modelId).toBe(modelId);
      expect(entry?.ownerOrgId).toBe(ownerOrgId);
      expect(entry?.tagName).toBeNull();
    });

    // F7 item 4 follow-up (20260916040000_shared_model_access_fixes.sql):
    // two real gaps found exercising the golden path end to end, both
    // fixed as part of PR7, not PR5's original scope.
    it("resolves the owning organisation's name via organisations_select's new model_shares-aware clause — the read listModelsSharedWithOrg's own second query depends on", async () => {
      const org = await getOrganisationById(unpinnedOrg.member.client, ownerOrgId);
      expect(org?.name).toBe('Model Shares Owner Org');
    });

    it("getMainBranch resolves the real, live main branch row via atlas.get_shared_main_branch's fallback — never frozen at the commit the share was created at", async () => {
      const main = await getMainBranch(unpinnedOrg.member.client, modelId);
      expect(main?.kind).toBe('main');
      expect(main?.head_commit_id).toBe(commit3Id);
    });
  });

  describe('tag-pinned share', () => {
    it('resolves the model, sees exactly the pinned tag commit and its heads', async () => {
      expect(await getModelById(pinnedOrg.member.client, modelId)).not.toBeNull();

      const { data: pinnedCommit, error } = await pinnedOrg.member.client.from('commits').select('id').eq('id', commit2Id).maybeSingle();
      expect(error).toBeNull();
      expect(pinnedCommit?.id).toBe(commit2Id);

      const { data: headRows } = await pinnedOrg.member.client.from('elements_head').select('element_id').eq('commit_id', commit2Id).eq('element_id', elementId);
      expect(headRows).toHaveLength(1);
    });

    it('never sees the ancestor commit or a later main commit — only the exact tagged commit', async () => {
      const { data: ancestorCommit } = await pinnedOrg.member.client.from('commits').select('id').eq('id', commit1Id).maybeSingle();
      expect(ancestorCommit).toBeNull();

      const { data: laterCommit } = await pinnedOrg.member.client.from('commits').select('id').eq('id', commit3Id).maybeSingle();
      expect(laterCommit).toBeNull();
    });

    it('sees exactly the one specifically-shared tag, never a broader tag list', async () => {
      const { data: tagRows } = await pinnedOrg.member.client.from('tags').select('id').eq('model_id', modelId);
      expect(tagRows).toEqual([{ id: tagId }]);
    });

    it('never sees the change branch, the comment, the decision, or the source', async () => {
      const { data: branchRow } = await pinnedOrg.member.client.from('branches').select('id').eq('id', changeBranchId).maybeSingle();
      expect(branchRow).toBeNull();

      const { data: commentRows } = await pinnedOrg.member.client.from('comments').select('id').eq('model_id', modelId);
      expect(commentRows).toEqual([]);

      const { data: decisionRows } = await pinnedOrg.member.client.from('decisions').select('id').eq('id', decisionId);
      expect(decisionRows).toEqual([]);
    });

    it('shows up in listModelsSharedWithOrg with the pinned tag name', async () => {
      const shared = await listModelsSharedWithOrg(pinnedOrg.owner.client, pinnedOrg.orgId);
      expect(shared).toHaveLength(1);
      const [entry] = shared;
      expect(entry?.tagName).toBe(tagName);
    });

    it("getMainBranch stays invisible — a pinned share must never see main's live head move out from under the version it pinned", async () => {
      expect(await getMainBranch(pinnedOrg.member.client, modelId)).toBeNull();
    });
  });

  describe('expired share', () => {
    it('grants nothing at all — the model, its commits, and its heads are all invisible', async () => {
      expect(await getModelById(expiredOrg.member.client, modelId)).toBeNull();

      const { data: commitRow } = await expiredOrg.member.client.from('commits').select('id').eq('id', commit1Id).maybeSingle();
      expect(commitRow).toBeNull();
    });

    it('never resolves the owning organisation or the main branch either', async () => {
      expect(await getOrganisationById(expiredOrg.member.client, ownerOrgId)).toBeNull();
      expect(await getMainBranch(expiredOrg.member.client, modelId)).toBeNull();
    });
  });

  describe('no share at all', () => {
    it('an outsider org sees nothing of the model', async () => {
      expect(await getModelById(outsiderOrg.member.client, modelId)).toBeNull();
      const { data: commitRow } = await outsiderOrg.member.client.from('commits').select('id').eq('id', commit1Id).maybeSingle();
      expect(commitRow).toBeNull();
    });

    it('never resolves the owning organisation or the main branch either', async () => {
      expect(await getOrganisationById(outsiderOrg.member.client, ownerOrgId)).toBeNull();
      expect(await getMainBranch(outsiderOrg.member.client, modelId)).toBeNull();
    });
  });

  describe('resolving a share target by slug', () => {
    it('resolves any organisation by slug, regardless of membership — the narrow, deliberate crossing', async () => {
      const resolved = await resolveOrganisationForSharing(outsiderOrg.owner.client, ownerOrgSlug);
      expect(resolved).toEqual({ status: 'found', orgId: ownerOrgId, orgName: 'Model Shares Owner Org' });
    });

    it('returns not_found for a slug matching no organisation', async () => {
      expect(await resolveOrganisationForSharing(owner.client, `no-such-org-${randomUUID()}`)).toEqual({ status: 'not_found' });
    });
  });

  describe('revoke', () => {
    it('revoking a share removes access immediately; a non-owner cannot revoke', async () => {
      const revokeShareId = randomUUID();
      await createModelShare(owner.client, { id: revokeShareId, modelId, tagId: null, sharedWithOrgId: outsiderOrg.orgId, createdBy: owner.id });
      expect(await getModelById(outsiderOrg.member.client, modelId)).not.toBeNull();

      await expect(revokeModelShare(outsiderOrg.owner.client, revokeShareId)).rejects.toThrow();

      await revokeModelShare(owner.client, revokeShareId);
      expect(await getModelById(outsiderOrg.member.client, modelId)).toBeNull();
    });
  });
});

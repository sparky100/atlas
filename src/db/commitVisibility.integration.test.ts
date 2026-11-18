/**
 * `atlas_private.commit_visible` (20261118100000_commit_visible_policies.sql)
 * against a real local Supabase: the select policies on `elements_head`,
 * `deltas`, `facts` and `relationships_head` must show exactly the rows
 * `commits_select` shows, for every kind of caller. The migration replaced
 * a per-row `exists (select 1 from commits ...)` subquery with one function
 * for speed, so this is the boundary test that access did not change.
 *
 * Expected visibility, per role, for one model with: a main commit (also
 * tagged), a later main commit, a draft change-branch commit, and the same
 * change branch once it is shared for review.
 *
 *   owner / architect / contributor : everything in their organisation
 *   viewer                           : main + tagged commits, the change
 *                                      branch only once shared for review
 *   member of another organisation   : nothing
 *   unpinned share (current main)    : main commits only (P-24 covers shares
 *                                      in `modelShares.integration.test.ts`)
 *   signed-in user, another org      : cannot call the function at all
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import { createChangeBranch, getMainBranch, updateBranchMetadata } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { createModel } from './models';
import { createModelShare } from './modelShares';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';
import { createTag } from './tags';

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
  const client = createSupabaseClient(env);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);
  return { id: created.user.id, client };
}

async function visibleIds(client: Client, table: 'elements_head' | 'relationships_head' | 'facts' | 'deltas', commitIds: readonly string[]): Promise<string[]> {
  const { data, error } = await client.from(table).select('commit_id').in('commit_id', commitIds as string[]);
  if (error) throw new Error(`${table}: ${error.message}`);
  return [...new Set((data as { commit_id: string }[]).map((r) => r.commit_id))].sort();
}

describe('commit_visible: heads, facts and deltas show exactly what commits show', () => {
  const orgIds: string[] = [];
  let owner: TestUser;
  let architect: TestUser;
  let contributor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let sharedMember: TestUser;
  let mainTaggedCommit: string;
  let mainLaterCommit: string;
  let changeCommit: string;
  let changeBranchId: string;
  let everyCommit: string[];

  beforeAll(async () => {
    owner = await createSignedInUser('cv-owner');
    architect = await createSignedInUser('cv-architect');
    contributor = await createSignedInUser('cv-contributor');
    viewer = await createSignedInUser('cv-viewer');
    outsider = await createSignedInUser('cv-outsider');
    sharedMember = await createSignedInUser('cv-shared-member');

    const orgId = randomUUID();
    orgIds.push(orgId);
    await createOrganisation(owner.client, { id: orgId, name: 'Commit Visibility Org', slug: `cv-${orgId.slice(0, 8)}`, createdBy: owner.id });
    for (const [user, role] of [[architect, 'architect'], [contributor, 'contributor'], [viewer, 'viewer']] as const) {
      const { error } = await owner.client.from('members').insert({ org_id: orgId, user_id: user.id, role, invited_by: owner.id });
      if (error) throw new Error(`add ${role}: ${error.message}`);
    }

    const outsiderOrgId = randomUUID();
    orgIds.push(outsiderOrgId);
    await createOrganisation(outsider.client, { id: outsiderOrgId, name: 'Outsider Org', slug: `cv-out-${outsiderOrgId.slice(0, 8)}`, createdBy: outsider.id });

    const sharedOrgId = randomUUID();
    orgIds.push(sharedOrgId);
    await createOrganisation(sharedMember.client, { id: sharedOrgId, name: 'Shared-with Org', slug: `cv-shr-${sharedOrgId.slice(0, 8)}`, createdBy: sharedMember.id });

    const modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Commit Visibility Model', slug: `cv-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');

    const elementId = randomUUID();
    const create: Delta = { kind: 'element.create', id: randomUUID(), elementId, elementType: 'system', name: 'System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 };
    mainTaggedCommit = randomUUID();
    const first = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: { id: mainTaggedCommit, branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed', body: null, deltas: [create] } satisfies CommitEnvelope });
    if (!first.ok) throw new Error(`main commit 1: ${first.message}`);
    await createTag(owner.client, { id: randomUUID(), orgId, modelId, name: `v-${randomUUID().slice(0, 8)}`, commitId: mainTaggedCommit, createdBy: owner.id });

    const update: Delta = { kind: 'element.update', id: randomUUID(), elementId, elementType: 'system', attribute: 'vendor', value: 'Acme', previousDeltaId: create.id, sourceId: source.id, confidence: 1 };
    mainLaterCommit = randomUUID();
    const second = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: mainTaggedCommit, envelope: { id: mainLaterCommit, branchId: main.id, parentCommitId: mainTaggedCommit, mergedBranchHeadCommitId: null, kind: 'manual', title: 'later', body: null, deltas: [update] } satisfies CommitEnvelope });
    if (!second.ok) throw new Error(`main commit 2: ${second.message}`);

    changeBranchId = randomUUID();
    await createChangeBranch(owner.client, { id: changeBranchId, orgId, modelId, name: `cv-change-${randomUUID().slice(0, 8)}`, createdBy: owner.id, intent: 'propose', mainHeadCommitId: mainLaterCommit });
    const changeUpdate: Delta = { kind: 'element.update', id: randomUUID(), elementId, elementType: 'system', attribute: 'vendor', value: 'Globex', previousDeltaId: update.id, sourceId: source.id, confidence: 1 };
    changeCommit = randomUUID();
    const third = await commitToBranch(owner.client, { modelId, branchId: changeBranchId, expectedHeadCommitId: mainLaterCommit, envelope: { id: changeCommit, branchId: changeBranchId, parentCommitId: mainLaterCommit, mergedBranchHeadCommitId: null, kind: 'manual', title: 'change', body: null, deltas: [changeUpdate] } satisfies CommitEnvelope });
    if (!third.ok) throw new Error(`change commit: ${third.message}`);

    everyCommit = [mainTaggedCommit, mainLaterCommit, changeCommit];

    // An unpinned share into `sharedOrgId`: current main only.
    await createModelShare(owner.client, { id: randomUUID(), modelId, tagId: null, sharedWithOrgId: sharedOrgId, createdBy: owner.id });
  });

  afterAll(async () => {
    for (const orgId of orgIds) await service.from('organisations').delete().eq('id', orgId);
  });

  const tables = ['deltas', 'elements_head', 'facts'] as const;

  it.each([
    ['owner', () => owner],
    ['architect', () => architect],
    ['contributor', () => contributor],
  ])('%s sees every commit of their organisation, including the draft change branch', async (_label, who) => {
    for (const table of tables) {
      const seen = await visibleIds(who().client, table, everyCommit);
      // `deltas` and `facts` hold every commit; heads hold main's head, tagged commits and branch heads.
      expect(seen, table).toContain(mainLaterCommit);
      expect(seen, table).toContain(changeCommit);
    }
    expect(await visibleIds(who().client, 'deltas', everyCommit)).toEqual([...everyCommit].sort());
  });

  it('a viewer sees main and tagged commits but not a draft change branch', async () => {
    const seen = await visibleIds(viewer.client, 'deltas', everyCommit);
    expect(seen).toEqual([mainTaggedCommit, mainLaterCommit].sort());
    for (const table of ['elements_head', 'facts', 'relationships_head'] as const) {
      expect(await visibleIds(viewer.client, table, [changeCommit]), table).toEqual([]);
    }
  });

  it('a viewer sees the change branch once it is shared for review, and not again after it is unshared', async () => {
    await updateBranchMetadata(owner.client, changeBranchId, { sharedForReview: true });
    for (const table of ['deltas', 'elements_head', 'facts'] as const) {
      expect(await visibleIds(viewer.client, table, [changeCommit]), table).toEqual([changeCommit]);
    }
    await updateBranchMetadata(owner.client, changeBranchId, { sharedForReview: false });
    for (const table of ['deltas', 'elements_head', 'facts'] as const) {
      expect(await visibleIds(viewer.client, table, [changeCommit]), table).toEqual([]);
    }
  });

  it("a member of another organisation sees none of this model's commits, heads, facts or deltas", async () => {
    for (const table of ['deltas', 'elements_head', 'facts', 'relationships_head'] as const) {
      expect(await visibleIds(outsider.client, table, everyCommit), table).toEqual([]);
    }
  });

  it('a user the model is shared with (unpinned) sees main commits and never the change branch', async () => {
    const seen = await visibleIds(sharedMember.client, 'deltas', everyCommit);
    expect(seen).toEqual([mainTaggedCommit, mainLaterCommit].sort());
    expect(await visibleIds(sharedMember.client, 'elements_head', [changeCommit])).toEqual([]);
  });

  it('a signed-out client sees nothing', async () => {
    const anon = createSupabaseClient(env);
    for (const table of ['deltas', 'elements_head', 'facts', 'relationships_head'] as const) {
      const { data } = await anon.from(table).select('commit_id').in('commit_id', everyCommit);
      expect(data ?? [], table).toEqual([]);
    }
  });

  it('the function is private: it is not callable through the API by a signed-in user from another organisation', async () => {
    const { error } = await outsider.client.schema('atlas_private' as never).rpc('commit_visible' as never, { p_commit: mainLaterCommit } as never);
    expect(error).not.toBeNull();
  });
});

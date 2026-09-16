/**
 * ADR-019, E7: `mergeElements`/`undoElementMerge` against a real local
 * Supabase. Same "this sandbox has no Docker route" limitation named in
 * `repository.integration.test.ts`'s own module comment — written and
 * reasoned through against the real RLS/RPC behaviour, not executed here.
 *
 * Covers RT-6's own DB-level half (SPEC §10): the merge resolves through
 * `aliases` to the survivor, `element_merges` records the decision, and
 * undo brings the loser back without touching either.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { getElementMerge, mergeElements, undoElementMerge } from './elementMerges';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';

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

describe('mergeElements / undoElementMerge against a real local Supabase', () => {
  let owner: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let modelId: string;
  let survivorId: string;
  let loserId: string;
  let targetId: string;
  let relId: string;
  let childId: string;
  let sourceId: string;
  let seedCommitId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('elementmerges-owner');
    viewer = await createSignedInUser('elementmerges-viewer');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Element Merges Test Org', slug: `elementmerges-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: viewerError } = await owner.client.from('members').insert({ org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id });
    if (viewerError) throw new Error(`add viewer: ${viewerError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Element Merges Test Model', slug: `elementmerges-model-${modelId.slice(0, 8)}`, createdBy: owner.id });

    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    sourceId = source.id;

    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');

    survivorId = randomUUID();
    loserId = randomUUID();
    targetId = randomUUID();
    relId = randomUUID();
    childId = randomUUID();

    const deltas: Delta[] = [
      { kind: 'element.create', id: randomUUID(), elementId: survivorId, elementType: 'system', name: 'Survivor', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: loserId, elementType: 'system', name: 'Loser', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: targetId, elementType: 'system', name: 'Target', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: childId, elementType: 'system', name: 'Child', parentId: loserId, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: relId, relationshipType: 'uses', fromElementId: loserId, toElementId: targetId, attributes: {}, sourceId, confidence: 1 },
    ];
    seedCommitId = randomUUID();
    const envelope: CommitEnvelope = { id: seedCommitId, branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed', body: null, deltas };
    const result = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
    if (!result.ok) throw new Error(`seed commit: ${result.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('a viewer cannot merge (commit_deltas is owner/architect/contributor only)', async () => {
    const main = await getMainBranch(viewer.client, modelId);
    if (!main) throw new Error('main branch missing');
    const result = await mergeElements(viewer.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      survivorId,
      loserId,
      sourceId,
      rationale: 'should be refused',
    });
    expect(result.status).not.toBe('merged');
  });

  it('merges the loser into the survivor: retracts it, re-points its relationship and child, records element_merges and the merged_id alias', async () => {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');

    const result = await mergeElements(owner.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      survivorId,
      loserId,
      sourceId,
      rationale: 'Loser and Survivor are the same real system',
    });
    expect(result.status).toBe('merged');
    if (result.status !== 'merged') throw new Error('unreachable');

    const { data: elementsAfter } = await owner.client.from('elements_head').select('element_id, parent_id').eq('commit_id', result.commitId);
    expect(elementsAfter?.some((e: { element_id: string }) => e.element_id === loserId)).toBe(false);
    expect(elementsAfter?.find((e: { element_id: string }) => e.element_id === childId)?.parent_id).toBe(survivorId);

    const { data: relsAfter } = await owner.client.from('relationships_head').select('from_element_id, to_element_id').eq('commit_id', result.commitId).eq('to_element_id', targetId);
    expect(relsAfter?.some((r: { from_element_id: string }) => r.from_element_id === survivorId)).toBe(true);

    const elementMerge = await getElementMerge(owner.client, result.elementMergeId);
    expect(elementMerge?.surviving_element_id).toBe(survivorId);
    expect(elementMerge?.merged_element_id).toBe(loserId);
    expect(elementMerge?.commit_id).toBe(result.commitId);

    const { data: aliasRows } = await owner.client.from('aliases').select('element_id, alias_type, alias_value').eq('model_id', modelId).eq('alias_type', 'merged_id').eq('alias_value', loserId);
    expect(aliasRows).toEqual([expect.objectContaining({ element_id: survivorId })]);

    // A non-owner, non-member org sees none of this — element_merges_select
    // is member-scoped, same as every other table this schema treats that way.
    expect(await getElementMerge(viewer.client, result.elementMergeId)).not.toBeNull(); // the viewer *is* a member of this org.

    // undo, from here.
    const undoResult = await undoElementMerge(owner.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: result.commitId,
      elementMergeId: result.elementMergeId,
      sourceId,
    });
    expect(undoResult.ok).toBe(true);
    if (!undoResult.ok) throw new Error('unreachable');

    const { data: elementsAfterUndo } = await owner.client.from('elements_head').select('element_id, name, parent_id').eq('commit_id', undoResult.commitId);
    const restoredLoser = elementsAfterUndo?.find((e: { element_id: string }) => e.element_id === loserId);
    expect(restoredLoser?.name).toBe('Loser');
    expect(elementsAfterUndo?.find((e: { element_id: string }) => e.element_id === childId)?.parent_id).toBe(loserId);

    const { data: relsAfterUndo } = await owner.client.from('relationships_head').select('from_element_id').eq('commit_id', undoResult.commitId).eq('to_element_id', targetId);
    expect(relsAfterUndo?.some((r: { from_element_id: string }) => r.from_element_id === loserId)).toBe(true);
    expect(relsAfterUndo).toHaveLength(1); // the merge's own temporary re-pointed edge is gone, not left behind alongside the restored original.

    // element_merges and the alias are untouched by the undo (CLAUDE.md rule 5).
    const elementMergeAfterUndo = await getElementMerge(owner.client, result.elementMergeId);
    expect(elementMergeAfterUndo).toEqual(elementMerge);
  });
});

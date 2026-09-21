/**
 * RT-14 (SPEC-data-model.md §10.1, ADR-023/F6): the two widened enums —
 * `element_type` + 'value_stream', `relationship_type` + 'enables'
 * (`supabase/migrations/20260921060000_value_streams.sql`) — exercised
 * through the real commit path: one envelope creating a stream, a stage
 * under it and an `enables` edge from a capability onto the stage goes
 * through `commitToBranch` → `atlas.commit_deltas`, and the materialised
 * `elements_head`/`relationships_head` rows read back with the new labels.
 * The same envelope pointed at the stream instead of the stage is refused
 * by C22 in the client-side fold before any RPC is called.
 *
 * Same "needs a real Supabase, not runnable in the authoring sandbox"
 * limitation as every other `*.integration.test.ts` here — see
 * src/db/repository.integration.test.ts's own module comment.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';

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

describe('RT-14: value_stream elements and enables relationships through atlas.commit_deltas', () => {
  let owner: TestUser;
  let orgId: string;
  let modelId: string;
  let sourceId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('vs-owner');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Value Streams Org', slug: `vs-org-${orgId.slice(0, 8)}`, createdBy: owner.id });
    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Value Streams Model', slug: `vs-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    sourceId = (await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id })).id;
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
    await service.auth.admin.deleteUser(owner.id);
  });

  function valueStreamEnvelopeDeltas(ids: { capabilityId: string; streamId: string; stageId: string; edgeId: string }, enablesTarget: string): Delta[] {
    return [
      { kind: 'element.create', id: randomUUID(), elementId: ids.capabilityId, elementType: 'capability', name: 'Connections', parentId: null, attributes: {}, sourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: ids.streamId, elementType: 'value_stream', name: 'Getting Connected', parentId: null, attributes: { order: 10 }, sourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: ids.stageId, elementType: 'value_stream', name: 'Apply', parentId: ids.streamId, attributes: { order: 10 }, sourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: ids.edgeId, relationshipType: 'enables', fromElementId: ids.capabilityId, toElementId: enablesTarget, attributes: {}, sourceId, confidence: 1 },
    ];
  }

  it('a stream, a stage under it and an enables edge onto the stage commit to main and materialise with the widened enum labels', async () => {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch was not auto-created');
    const ids = { capabilityId: randomUUID(), streamId: randomUUID(), stageId: randomUUID(), edgeId: randomUUID() };

    const result = await commitToBranch(owner.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'value stream fixture', body: null, deltas: valueStreamEnvelopeDeltas(ids, ids.stageId) },
    });
    if (!result.ok) throw new Error(`commit: ${result.message}`);

    const { data: elements, error: elementsError } = await owner.client
      .from('elements_head')
      .select('element_id, element_type, parent_id, attributes')
      .eq('commit_id', result.commitId)
      .in('element_id', [ids.streamId, ids.stageId]);
    if (elementsError) throw new Error(`elements_head: ${elementsError.message}`);
    const byId = new Map((elements as { element_id: string; element_type: string; parent_id: string | null; attributes: Record<string, unknown> }[]).map((row) => [row.element_id, row]));
    expect(byId.get(ids.streamId)).toMatchObject({ element_type: 'value_stream', parent_id: null, attributes: { order: 10 } });
    expect(byId.get(ids.stageId)).toMatchObject({ element_type: 'value_stream', parent_id: ids.streamId });

    const { data: relationships, error: relationshipsError } = await owner.client
      .from('relationships_head')
      .select('relationship_id, relationship_type, from_element_id, to_element_id, attributes')
      .eq('commit_id', result.commitId)
      .eq('relationship_id', ids.edgeId);
    if (relationshipsError) throw new Error(`relationships_head: ${relationshipsError.message}`);
    expect(relationships).toHaveLength(1);
    expect(relationships[0]).toMatchObject({ relationship_type: 'enables', from_element_id: ids.capabilityId, to_element_id: ids.stageId, attributes: {} });
  });

  it('the same envelope with enables pointed at the stream is refused by C22 client-side, before any RPC', async () => {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch was not auto-created');
    const ids = { capabilityId: randomUUID(), streamId: randomUUID(), stageId: randomUUID(), edgeId: randomUUID() };

    const result = await commitToBranch(owner.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'enables onto a stream', body: null, deltas: valueStreamEnvelopeDeltas(ids, ids.streamId) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
      expect(result.message).toMatch(/C22/);
    }

    const refreshed = await getMainBranch(owner.client, modelId);
    expect(refreshed?.head_commit_id).toBe(main.head_commit_id);
  });
});

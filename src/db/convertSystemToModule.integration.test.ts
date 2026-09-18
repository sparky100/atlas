/**
 * `convertSystemToModule` against a real local Supabase. Same "this sandbox
 * has no Docker route" limitation named in `elementMerges.integration.test.ts`'s
 * own module comment — written and reasoned through against the real
 * RLS/commit behaviour, not executed here.
 *
 * Covers the DB-level half `convertSystemToModule.ts`'s own module comment
 * describes: the old system is retracted, a new container takes its place
 * under the target platform, its relationship carries over onto the new id,
 * and its old name resolves through `aliases` to the new container.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { convertSystemToModule } from './convertSystemToModule';
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

describe('convertSystemToModule against a real local Supabase', () => {
  let owner: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let modelId: string;
  let platformId: string;
  let systemId: string;
  let otherId: string;
  let sourceId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('converttomodule-owner');
    viewer = await createSignedInUser('converttomodule-viewer');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Convert To Module Test Org', slug: `converttomodule-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: viewerError } = await owner.client.from('members').insert({ org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id });
    if (viewerError) throw new Error(`add viewer: ${viewerError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Convert To Module Test Model', slug: `converttomodule-model-${modelId.slice(0, 8)}`, createdBy: owner.id });

    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    sourceId = source.id;

    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');

    platformId = randomUUID();
    systemId = randomUUID();
    otherId = randomUUID();

    const deltas: Delta[] = [
      { kind: 'element.create', id: randomUUID(), elementId: platformId, elementType: 'system', name: 'SAP', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false, kind: 'platform' }, sourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Freight Tracker', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false, criticality: 'high' }, sourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: otherId, elementType: 'system', name: 'Other', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: systemId, toElementId: otherId, attributes: {}, sourceId, confidence: 1 },
    ];
    const seedCommitId = randomUUID();
    const envelope: CommitEnvelope = { id: seedCommitId, branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed', body: null, deltas };
    const result = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
    if (!result.ok) throw new Error(`seed commit: ${result.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('a viewer cannot convert (commit_deltas is owner/architect/contributor only)', async () => {
    const main = await getMainBranch(viewer.client, modelId);
    if (!main) throw new Error('main branch missing');
    const result = await convertSystemToModule(viewer.client, {
      modelId,
      orgId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      systemId,
      targetPlatformId: platformId,
      sourceId,
      userId: viewer.id,
    });
    expect(result.status).not.toBe('converted');
  });

  it('converts the system into a module of the platform: retracts it, repoints its relationship, and aliases its old name onto the new container', async () => {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');

    const result = await convertSystemToModule(owner.client, {
      modelId,
      orgId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      systemId,
      targetPlatformId: platformId,
      sourceId,
      userId: owner.id,
    });
    expect(result.status).toBe('converted');
    if (result.status !== 'converted') throw new Error('unreachable');
    expect(result.relationshipCount).toBe(1);
    expect(result.droppedAttributeKeys).toEqual([]);

    const { data: elementsAfter } = await owner.client.from('elements_head').select('element_id, element_type, parent_id, attributes').eq('commit_id', result.commitId);
    expect(elementsAfter?.some((e: { element_id: string }) => e.element_id === systemId)).toBe(false);
    const newModule = elementsAfter?.find((e: { element_id: string }) => e.element_id === result.newContainerId);
    expect(newModule).toMatchObject({ element_type: 'container', parent_id: platformId });
    expect((newModule?.attributes as Record<string, unknown> | undefined)?.criticality).toBe('high');

    const { data: relsAfter } = await owner.client.from('relationships_head').select('from_element_id, to_element_id').eq('commit_id', result.commitId).eq('to_element_id', otherId);
    expect(relsAfter?.some((r: { from_element_id: string }) => r.from_element_id === result.newContainerId)).toBe(true);

    const { data: nameAliasRows } = await owner.client.from('aliases').select('element_id, alias_type, alias_value').eq('model_id', modelId).eq('alias_type', 'name').eq('alias_value', 'Freight Tracker');
    expect(nameAliasRows).toEqual([expect.objectContaining({ element_id: result.newContainerId })]);
  });
});

/**
 * Element/Context page performance: `getElementsByIds`, `listFactsForSubjects`
 * and `listFlowsViaElement` ask Postgres for just the rows they need when the
 * id list is within rule 8's 50-value ceiling, and fall back to the commit
 * scope filtered client-side above it. Both paths must return the same rows —
 * checked here against a real local Supabase, including the
 * `attributes->>via` filter, which only Postgres can evaluate.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta, UUID } from '../contracts/delta';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { getElementsByIds, listFactsForSubjects, listFlowsViaElement } from './elements';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';

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

describe('batched element reads against a real local Supabase', () => {
  let owner: { id: string; client: Client };
  let orgId: UUID;
  let commitId: UUID;
  const systemIds: UUID[] = Array.from({ length: 60 }, () => randomUUID());
  const sys = (i: number): UUID => {
    const id = systemIds[i];
    if (id === undefined) throw new Error(`no system ${String(i)}`);
    return id;
  };
  const esbId = randomUUID();
  const interfaceId = randomUUID();
  const relationshipIds = { viaPlatform: randomUUID(), viaInterface: randomUUID(), direct: randomUUID() };

  beforeAll(async () => {
    owner = await createSignedInUser('batchreads');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Batch Reads Org', slug: `batchreads-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Batch Reads Model', slug: `batchreads-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    const [a, b] = systemIds as [UUID, UUID];
    const deltas: Delta[] = [
      ...systemIds.map((elementId, i): Delta => ({ kind: 'element.create', id: randomUUID(), elementId, elementType: 'system', name: `System ${String(i).padStart(2, '0')}`, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false, vendor: `Vendor ${String(i)}` }, sourceId: source.id, confidence: 1 })),
      { kind: 'element.create', id: randomUUID(), elementId: esbId, elementType: 'system', name: 'ESB', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false, kind: 'integration_platform' }, sourceId: source.id, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: interfaceId, elementType: 'container', name: 'Reads API', parentId: esbId, attributes: { isExternal: false, interfaceType: 'api' }, sourceId: source.id, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: relationshipIds.viaPlatform, relationshipType: 'flows_to', fromElementId: a, toElementId: b, attributes: { description: 'sends to', via: esbId }, sourceId: source.id, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: relationshipIds.viaInterface, relationshipType: 'uses', fromElementId: b, toElementId: a, attributes: { description: 'reads from', via: interfaceId, protocolOut: 'rest_api' }, sourceId: source.id, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: relationshipIds.direct, relationshipType: 'flows_to', fromElementId: a, toElementId: esbId, attributes: { description: 'feeds' }, sourceId: source.id, confidence: 1 },
    ];
    const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed', body: null, deltas };
    const result = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
    if (!result.ok) throw new Error(`seed: ${result.message}`);
    commitId = result.commitId;
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('getElementsByIds returns the same rows through the .in() path (≤50 ids) and the commit-scope path (>50), ignoring duplicates and unknown ids', async () => {
    const few = await getElementsByIds(owner.client, commitId, [...systemIds.slice(0, 3), sys(0), randomUUID()]);
    expect([...few.keys()].sort()).toEqual(systemIds.slice(0, 3).sort());
    const many = await getElementsByIds(owner.client, commitId, [...systemIds, esbId]);
    expect(many.size).toBe(61);
    expect(many.get(sys(1))?.name).toBe('System 01');
  });

  it('listFactsForSubjects groups each subject\'s facts, empty for a subject with none, on both paths', async () => {
    const few = await listFactsForSubjects(owner.client, commitId, [sys(5), relationshipIds.viaInterface, randomUUID()]);
    expect(few.get(sys(5))?.get('vendor')?.value).toBe('Vendor 5');
    expect(few.get(relationshipIds.viaInterface)?.get('protocolOut')?.value).toBe('rest_api');
    expect(few.size).toBe(3);
    const many = await listFactsForSubjects(owner.client, commitId, systemIds);
    expect(many.size).toBe(60);
    expect(many.get(sys(59))?.get('vendor')?.value).toBe('Vendor 59');
  });

  it('listFlowsViaElement filters by via in Postgres: platform and interface flows, never a direct flow', async () => {
    const platformAndInterface = await listFlowsViaElement(owner.client, commitId, [esbId, interfaceId]);
    expect(platformAndInterface.map((r) => r.relationship_id).sort()).toEqual([relationshipIds.viaPlatform, relationshipIds.viaInterface].sort());
    const interfaceOnly = await listFlowsViaElement(owner.client, commitId, [interfaceId]);
    expect(interfaceOnly.map((r) => r.relationship_id)).toEqual([relationshipIds.viaInterface]);
    expect(await listFlowsViaElement(owner.client, commitId, [])).toEqual([]);
  });
});

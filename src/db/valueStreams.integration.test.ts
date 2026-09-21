/**
 * RT-14 (SPEC-data-model.md §10.1, ADR-023/F6): the two widened enums —
 * `element_type` + 'value_stream', `relationship_type` + 'enables'
 * (`supabase/migrations/20260921070000_value_streams.sql`) — exercised
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
import type { CommitEnvelope, Delta, UUID } from '../contracts/delta';
import type { ElementsHeadRow } from '../contracts/rows';
import { getMainBranch } from './branches';
import { createChangeBranch, getBranch } from './branches';
import { listCapabilitiesForMap } from './capabilityMap';
import { listCapabilityMapItems } from './capabilityMapTemplates';
import { loadChangeSummary } from './changeSummary';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { computeSelfOwnedCapabilityIds, listAllOwnsEdges } from './healthFindings';
import { listContainersForLandscape, listSystemsForLandscape } from './landscape';
import { approveMergeRequest, computeMergeReviewForBranch, mergeApprovedRequest, submitMergeRequest } from './mergeRequests';
import { createModel } from './models';
import { buildCapabilityTiles, listAllSupportsEdges, loadPlannedReplacements } from './modelHome';
import { createOrganisation } from './organisations';
import { seedModelFromCapabilityMap } from './seedFromMap';
import { getOrCreateManualSource } from './sources';
import { listAllEnablesEdges, listValueStreamElements } from './valueStreams';
import { computeStageRollup, computeStreamRollup, stagesOf, streamsOf } from '../ui/valueStreams/valueStreamRollup';

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

describe('F6: value-stream rollup and impact through the real commit path', () => {
  let owner: TestUser;
  let orgId: string;
  let modelId: string;
  let sourceId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('vs-impact');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'VS Impact Org', slug: `vs-impact-${orgId.slice(0, 8)}`, createdBy: owner.id });
    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'VS Impact Model', slug: `vs-impact-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    sourceId = (await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id })).id;
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
    await service.auth.admin.deleteUser(owner.id);
  });

  it('a supporter retired on a change branch lists both streams as affected, and merging rolls both to warn', async () => {
    // A draft map: one capability, two streams (one stage each), `enables`
    // onto both stages — seeded through `seedModelFromCapabilityMap` (the
    // real seed path, which now carries value streams and their edges).
    const mapId = randomUUID();
    const { error: mapError } = await service.from('capability_maps').insert({ id: mapId, sector: 'electricity_network', version: 1, status: 'draft', title: 'VS impact fixture', summary: 'value-stream impact fixture', source_description: 'Written by valueStreams.integration.test.ts.' });
    if (mapError) throw new Error(`capability_maps: ${mapError.message}`);
    const { error: itemError } = await service.from('capability_map_items').insert({ id: randomUUID(), map_id: mapId, code: '1', parent_code: null, name: 'Connections', level: 1, item_order: 10 });
    if (itemError) throw new Error(`capability_map_items: ${itemError.message}`);
    const { error: vsError } = await service.from('capability_map_value_stream_items').insert([
      { id: randomUUID(), map_id: mapId, code: 'VS1', parent_code: null, name: 'Getting Connected', description: null, item_order: 10 },
      { id: randomUUID(), map_id: mapId, code: 'VS1.1', parent_code: 'VS1', name: 'Apply', description: null, item_order: 10 },
      { id: randomUUID(), map_id: mapId, code: 'VS2', parent_code: null, name: 'Customer Experience', description: null, item_order: 20 },
      { id: randomUUID(), map_id: mapId, code: 'VS2.1', parent_code: 'VS2', name: 'Support', description: null, item_order: 10 },
    ]);
    if (vsError) throw new Error(`value_stream_items: ${vsError.message}`);
    const { error: enablesError } = await service.from('capability_map_value_stream_enables').insert([
      { map_id: mapId, stage_code: 'VS1.1', capability_code: '1' },
      { map_id: mapId, stage_code: 'VS2.1', capability_code: '1' },
    ]);
    if (enablesError) throw new Error(`value_stream_enables: ${enablesError.message}`);

    const items = await listCapabilityMapItems(service, mapId);
    const main0 = await getMainBranch(owner.client, modelId);
    if (!main0) throw new Error('main branch not found');
    const seed = await seedModelFromCapabilityMap(owner.client, { modelId, branchId: main0.id, expectedHeadCommitId: main0.head_commit_id, authorId: owner.id, capabilityMapId: mapId, sector: 'electricity_network', version: 1, items });
    if (!seed.ok) throw new Error(`seed: ${seed.message}`);

    const idByName = new Map<string, UUID>([...seed.newHead.elements].map(([id, row]) => [row.name, id]));
    const capabilityId = idByName.get('Connections');
    const streamAId = idByName.get('Getting Connected');
    const streamBId = idByName.get('Customer Experience');
    if (capabilityId === undefined || streamAId === undefined || streamBId === undefined) throw new Error('seeded element ids not found');

    // Add a system supporting the capability (primary), directly on main.
    const systemId = randomUUID();
    const systemCreateDeltaId = randomUUID();
    const addEnvelope: CommitEnvelope = {
      id: randomUUID(),
      branchId: main0.id,
      parentCommitId: seed.commitId,
      mergedBranchHeadCommitId: null,
      kind: 'manual',
      title: 'add supporter',
      body: null,
      deltas: [
        { kind: 'element.create', id: systemCreateDeltaId, elementId: systemId, elementType: 'system', name: 'Legacy CRM', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
        { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId, confidence: 1 },
      ],
    };
    const add = await commitToBranch(owner.client, { modelId, branchId: main0.id, expectedHeadCommitId: seed.commitId, envelope: addEnvelope });
    if (!add.ok) throw new Error(`add: ${add.message}`);

    // Retire the supporter on a fresh `record` change branch.
    const main1 = await getMainBranch(owner.client, modelId);
    if (!main1) throw new Error('main not found after add');
    const branch = await createChangeBranch(owner.client, { id: randomUUID(), orgId, modelId, name: `retire-${randomUUID().slice(0, 8)}`, title: 'Retire Legacy CRM', createdBy: owner.id, mainHeadCommitId: main1.head_commit_id, intent: 'record' });
    const retireEnvelope: CommitEnvelope = {
      id: randomUUID(),
      branchId: branch.id,
      parentCommitId: branch.head_commit_id,
      mergedBranchHeadCommitId: null,
      kind: 'manual',
      title: 'retire supporter',
      body: null,
      deltas: [{ kind: 'element.update', id: randomUUID(), elementId: systemId, elementType: 'system', attribute: 'lifecycleStatus', value: 'retiring', previousDeltaId: systemCreateDeltaId, sourceId, confidence: 1 }],
    };
    const retire = await commitToBranch(owner.client, { modelId, branchId: branch.id, expectedHeadCommitId: branch.head_commit_id, envelope: retireEnvelope });
    if (!retire.ok) throw new Error(`retire: ${retire.message}`);

    const branchRow = await getBranch(owner.client, branch.id);
    if (!branchRow) throw new Error('branch not found');
    const summary = await loadChangeSummary(owner.client, modelId, branchRow);
    expect(summary?.affectedValueStreams.map((s) => s.stream.element_id).sort()).toEqual([streamAId, streamBId].sort());

    // Merge the retire, then read the rollup off main's merged head.
    const computed = await computeMergeReviewForBranch(owner.client, modelId, branchRow);
    if (!computed) throw new Error('no merge review');
    const request = await submitMergeRequest(owner.client, randomUUID(), branch.id, computed.review, null);
    const approved = await approveMergeRequest(owner.client, request.id);
    const branchAfterApproval = await getBranch(owner.client, branch.id);
    if (!branchAfterApproval) throw new Error('branch not found after approval');
    const merge = await mergeApprovedRequest(owner.client, modelId, approved.id, branchAfterApproval, 'Merge retire supporter');
    if (!merge.ok) throw new Error(`merge: ${merge.message}`);

    const main2 = await getMainBranch(owner.client, modelId);
    if (!main2) throw new Error('main not found after merge');
    const commitId = main2.head_commit_id;
    const [valueStreams, enablesEdges, capabilities, supportsEdges, ownsEdges, systems, containers] = await Promise.all([
      listValueStreamElements(owner.client, commitId),
      listAllEnablesEdges(owner.client, commitId),
      listCapabilitiesForMap(owner.client, commitId),
      listAllSupportsEdges(owner.client, commitId),
      listAllOwnsEdges(owner.client, commitId),
      listSystemsForLandscape(owner.client, commitId),
      listContainersForLandscape(owner.client, commitId),
    ]);
    const plannedReplacements = await loadPlannedReplacements(owner.client, modelId);
    const systemsById = new Map<UUID, ElementsHeadRow>([...systems, ...containers].map((s) => [s.element_id, s]));
    const selfOwnedIds = computeSelfOwnedCapabilityIds(capabilities, supportsEdges, ownsEdges);
    const capabilitiesById = new Map(capabilities.map((c) => [c.element_id, c]));
    const enablingCapabilities = [...new Set(enablesEdges.map((e) => e.from_element_id))].map((id) => capabilitiesById.get(id)).filter((c): c is ElementsHeadRow => c !== undefined);
    const tilesByCapabilityId = new Map(buildCapabilityTiles(enablingCapabilities, capabilities, supportsEdges, systemsById, plannedReplacements, selfOwnedIds).map((t) => [t.capability.element_id, t]));

    const tones = streamsOf(valueStreams).map((stream) => computeStreamRollup(stream, stagesOf(stream, valueStreams).map((stage) => computeStageRollup(stage, enablesEdges, tilesByCapabilityId))).tone);
    expect(tones).toEqual(['warn', 'warn']);
  });
});

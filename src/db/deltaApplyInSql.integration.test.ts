/**
 * E3 (docs/prompts/atlas-prompt-pack.md): `atlas.apply_deltas_to_main_projection`
 * (`supabase/migrations/20260913100000_delta_apply_in_sql.sql`) applies a
 * commit's own deltas to `elements_head`/`relationships_head`/`facts`
 * server-side, incrementally, instead of the client computing and sending
 * the whole new head as data. This file is this session's own version of
 * `rebuildHead`'s established equivalence check
 * (`repository.integration.test.ts`'s "matches exactly, byte for byte"
 * test): after every commit below, the real projection rows this SQL
 * function wrote are compared against a from-genesis TypeScript `fold` —
 * the reference implementation ADR-015 names — computed independently in
 * this test, not read back from anything the commit itself produced.
 *
 * `src/db/commits.ts` decides which path a commit takes (an omitted
 * projection payload ⇒ the new incremental path; every commit below is a
 * plain `commitToBranch` call with no restore delta, so every one of them
 * exercises the new path, not the pre-E3 fallback) — this file never calls
 * `atlas.apply_deltas_to_main_projection` directly, the same way no other
 * integration test calls `atlas.replace_main_head_projection` directly:
 * going through the real `commitToBranch` entry point is what proves the
 * two are actually wired together correctly, not just individually
 * correct.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { foldFromGenesis } from '../engine/head';
import { serializeHeadProjection } from '../engine/projection';
import { buildCommitLoader } from './commitLoader';
import { commitToBranch } from './commits';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { createModel } from './models';
import { loadEnv } from './env';
import { createOrganisation } from './organisations';
import { getMainBranch } from './branches';
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

/** `rebuildHead`'s own equivalence check, inlined here for a specific commit rather than "whatever main's current head is" — an independent from-genesis TypeScript fold is the reference, compared row-for-row against what the SQL function actually wrote for that exact commit. */
async function expectProjectionMatchesFold(client: Client, modelId: string, commitId: string): Promise<void> {
  const loader = await buildCommitLoader(client, modelId);
  const expectedHead = foldFromGenesis(commitId, loader);
  const expected = serializeHeadProjection(expectedHead);

  const { data: elementsHead, error: elementsError } = await client
    .from('elements_head')
    .select('element_id, element_type, name, parent_id, attributes, exists_delta_id')
    .eq('commit_id', commitId);
  if (elementsError) throw new Error(`reading elements_head: ${elementsError.message}`);
  const byElementId = (rows: { element_id: string }[]) => [...rows].sort((a, b) => a.element_id.localeCompare(b.element_id));
  expect(byElementId(elementsHead as { element_id: string }[])).toEqual(byElementId(expected.elementsHead as unknown as { element_id: string }[]));

  const { data: relationshipsHead, error: relationshipsError } = await client
    .from('relationships_head')
    .select('relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id')
    .eq('commit_id', commitId);
  if (relationshipsError) throw new Error(`reading relationships_head: ${relationshipsError.message}`);
  const byRelationshipId = (rows: { relationship_id: string }[]) => [...rows].sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));
  expect(byRelationshipId(relationshipsHead as { relationship_id: string }[])).toEqual(byRelationshipId(expected.relationshipsHead as unknown as { relationship_id: string }[]));

  const { data: factsRows, error: factsError } = await client
    .from('facts')
    .select('subject_type, subject_id, attribute, value, delta_id, source_id, confidence, asserted_by')
    .eq('commit_id', commitId);
  if (factsError) throw new Error(`reading facts: ${factsError.message}`);
  const byFactKey = (rows: { subject_id: string; attribute: string }[]) => [...rows].sort((a, b) => `${a.subject_id} ${a.attribute}`.localeCompare(`${b.subject_id} ${b.attribute}`));
  expect(byFactKey(factsRows as { subject_id: string; attribute: string }[])).toEqual(
    byFactKey(expected.facts.map(({ source_ref: _sourceRef, effective_date: _effectiveDate, asserted_at: _assertedAt, ...rest }) => rest) as unknown as { subject_id: string; attribute: string }[]),
  );
}

describe('delta-apply in SQL (E3) against a real local Supabase', () => {
  let alice: TestUser;
  let orgId: string;
  let modelId: string;
  let sourceId: string;

  beforeAll(async () => {
    alice = await createSignedInUser('alice-e3');
    orgId = randomUUID();
    await createOrganisation(alice.client, { id: orgId, name: 'E3 Test Org', slug: `e3-org-${orgId.slice(0, 8)}`, createdBy: alice.id });
    modelId = randomUUID();
    await createModel(alice.client, { id: modelId, orgId, name: 'E3 Test Model', slug: `e3-model-${modelId.slice(0, 8)}`, createdBy: alice.id });
    const source = await getOrCreateManualSource(alice.client, { id: randomUUID(), orgId, modelId, userId: alice.id });
    sourceId = source.id;
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
    await service.auth.admin.deleteUser(alice.id);
  });

  it('element.create, element.update (an attribute, name, and parentId), and element.retract each match a from-genesis fold', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main) throw new Error('main branch was not auto-created');

    const parentId = randomUUID();
    const childId = randomUUID();
    const createParentDeltaId = randomUUID();
    const createChildDeltaId = randomUUID();
    const createDeltas: Delta[] = [
      { kind: 'element.create', id: createParentDeltaId, elementId: parentId, elementType: 'system', name: 'Parent System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
      { kind: 'element.create', id: createChildDeltaId, elementId: childId, elementType: 'container', name: 'Child Container', parentId, attributes: { isExternal: false }, sourceId, confidence: 1 },
    ];
    const createResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'create parent + child', body: null, deltas: createDeltas },
    });
    if (!createResult.ok) throw new Error(`create commit failed: ${createResult.message}`);
    await expectProjectionMatchesFold(alice.client, modelId, createResult.commitId);

    const mainAfterCreate = await getMainBranch(alice.client, modelId);
    if (!mainAfterCreate) throw new Error('main branch disappeared');

    const updateDeltas: Delta[] = [
      { kind: 'element.update', id: randomUUID(), elementId: parentId, elementType: 'system', attribute: 'name', value: 'Renamed Parent System', previousDeltaId: createParentDeltaId, sourceId, confidence: 1 },
      { kind: 'element.update', id: randomUUID(), elementId: parentId, elementType: 'system', attribute: 'vendor', value: 'Acme Corp', previousDeltaId: createParentDeltaId, sourceId, confidence: 1 },
      { kind: 'element.update', id: randomUUID(), elementId: childId, elementType: 'container', attribute: 'parentId', value: null, previousDeltaId: createChildDeltaId, sourceId, confidence: 1 },
    ];
    const updateResult = await commitToBranch(alice.client, {
      modelId,
      branchId: mainAfterCreate.id,
      expectedHeadCommitId: mainAfterCreate.head_commit_id,
      envelope: { id: randomUUID(), branchId: mainAfterCreate.id, parentCommitId: mainAfterCreate.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'rename, add vendor, unparent', body: null, deltas: updateDeltas },
    });
    if (!updateResult.ok) throw new Error(`update commit failed: ${updateResult.message}`);
    await expectProjectionMatchesFold(alice.client, modelId, updateResult.commitId);

    // Confirm the promoted-column vs jsonb-attribute split actually took
    // effect, not just "some row exists" — name/parentId land on the row's
    // own columns, vendor lands in `attributes`.
    const { data: parentRow, error: parentError } = await alice.client
      .from('elements_head')
      .select('name, attributes')
      .eq('commit_id', updateResult.commitId)
      .eq('element_id', parentId)
      .single();
    if (parentError) throw new Error(`reading parent row: ${parentError.message}`);
    expect((parentRow as { name: string }).name).toBe('Renamed Parent System');
    expect((parentRow as { attributes: Record<string, unknown> }).attributes.vendor).toBe('Acme Corp');
    const { data: childRow, error: childError } = await alice.client
      .from('elements_head')
      .select('parent_id')
      .eq('commit_id', updateResult.commitId)
      .eq('element_id', childId)
      .single();
    if (childError) throw new Error(`reading child row: ${childError.message}`);
    expect(childRow.parent_id).toBeNull();

    const mainAfterUpdate = await getMainBranch(alice.client, modelId);
    if (!mainAfterUpdate) throw new Error('main branch disappeared');
    const retractDeltas: Delta[] = [{ kind: 'element.retract', id: randomUUID(), elementId: childId, elementType: 'container', previousDeltaId: createChildDeltaId, sourceId, confidence: 1 }];
    const retractResult = await commitToBranch(alice.client, {
      modelId,
      branchId: mainAfterUpdate.id,
      expectedHeadCommitId: mainAfterUpdate.head_commit_id,
      envelope: { id: randomUUID(), branchId: mainAfterUpdate.id, parentCommitId: mainAfterUpdate.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'retract child', body: null, deltas: retractDeltas },
    });
    if (!retractResult.ok) throw new Error(`retract commit failed: ${retractResult.message}`);
    await expectProjectionMatchesFold(alice.client, modelId, retractResult.commitId);

    const { data: retractedRows, error: retractedError } = await alice.client.from('elements_head').select('element_id').eq('commit_id', retractResult.commitId).eq('element_id', childId);
    if (retractedError) throw new Error(`reading retracted row: ${retractedError.message}`);
    expect(retractedRows).toHaveLength(0);
    const { data: retractedFacts, error: retractedFactsError } = await alice.client.from('facts').select('attribute').eq('commit_id', retractResult.commitId).eq('subject_id', childId);
    if (retractedFactsError) throw new Error(`reading retracted facts: ${retractedFactsError.message}`);
    expect(retractedFacts).toHaveLength(0);
  });

  it('relationship.create, relationship.update, and relationship.retract each match a from-genesis fold', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main) throw new Error('main branch was not auto-created');

    const fromId = randomUUID();
    const toId = randomUUID();
    const createElementsDeltas: Delta[] = [
      { kind: 'element.create', id: randomUUID(), elementId: fromId, elementType: 'system', name: 'Salesforce', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: toId, elementType: 'system', name: 'Billing System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
    ];
    const elementsResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'create relationship endpoints', body: null, deltas: createElementsDeltas },
    });
    if (!elementsResult.ok) throw new Error(`element create commit failed: ${elementsResult.message}`);
    await expectProjectionMatchesFold(alice.client, modelId, elementsResult.commitId);

    const mainAfterElements = await getMainBranch(alice.client, modelId);
    if (!mainAfterElements) throw new Error('main branch disappeared');
    const relationshipId = randomUUID();
    const createRelDeltaId = randomUUID();
    const createRelDeltas: Delta[] = [{ kind: 'relationship.create', id: createRelDeltaId, relationshipId, relationshipType: 'uses', fromElementId: fromId, toElementId: toId, attributes: { description: 'reads billing records from' }, sourceId, confidence: 1 }];
    const relCreateResult = await commitToBranch(alice.client, {
      modelId,
      branchId: mainAfterElements.id,
      expectedHeadCommitId: mainAfterElements.head_commit_id,
      envelope: { id: randomUUID(), branchId: mainAfterElements.id, parentCommitId: mainAfterElements.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'create relationship', body: null, deltas: createRelDeltas },
    });
    if (!relCreateResult.ok) throw new Error(`relationship create commit failed: ${relCreateResult.message}`);
    await expectProjectionMatchesFold(alice.client, modelId, relCreateResult.commitId);

    const mainAfterRelCreate = await getMainBranch(alice.client, modelId);
    if (!mainAfterRelCreate) throw new Error('main branch disappeared');
    const updateRelDeltas: Delta[] = [{ kind: 'relationship.update', id: randomUUID(), relationshipId, relationshipType: 'uses', attribute: 'description', value: 'writes billing adjustments to', previousDeltaId: createRelDeltaId, sourceId, confidence: 1 }];
    const relUpdateResult = await commitToBranch(alice.client, {
      modelId,
      branchId: mainAfterRelCreate.id,
      expectedHeadCommitId: mainAfterRelCreate.head_commit_id,
      envelope: { id: randomUUID(), branchId: mainAfterRelCreate.id, parentCommitId: mainAfterRelCreate.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'update relationship verb', body: null, deltas: updateRelDeltas },
    });
    if (!relUpdateResult.ok) throw new Error(`relationship update commit failed: ${relUpdateResult.message}`);
    await expectProjectionMatchesFold(alice.client, modelId, relUpdateResult.commitId);

    const mainAfterRelUpdate = await getMainBranch(alice.client, modelId);
    if (!mainAfterRelUpdate) throw new Error('main branch disappeared');
    const retractRelDeltas: Delta[] = [{ kind: 'relationship.retract', id: randomUUID(), relationshipId, relationshipType: 'uses', previousDeltaId: createRelDeltaId, sourceId, confidence: 1 }];
    const relRetractResult = await commitToBranch(alice.client, {
      modelId,
      branchId: mainAfterRelUpdate.id,
      expectedHeadCommitId: mainAfterRelUpdate.head_commit_id,
      envelope: { id: randomUUID(), branchId: mainAfterRelUpdate.id, parentCommitId: mainAfterRelUpdate.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'retract relationship', body: null, deltas: retractRelDeltas },
    });
    if (!relRetractResult.ok) throw new Error(`relationship retract commit failed: ${relRetractResult.message}`);
    await expectProjectionMatchesFold(alice.client, modelId, relRetractResult.commitId);
  });

  it('a commit that would retract an element still referenced by a live relationship is rejected (C8), and the projection is unchanged', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main) throw new Error('main branch was not auto-created');

    const fromId = randomUUID();
    const toId = randomUUID();
    const relationshipId = randomUUID();
    const createFromDeltaId = randomUUID();
    const setupDeltas: Delta[] = [
      { kind: 'element.create', id: createFromDeltaId, elementId: fromId, elementType: 'system', name: 'C8 From System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: toId, elementType: 'system', name: 'C8 To System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId, relationshipType: 'uses', fromElementId: fromId, toElementId: toId, attributes: {}, sourceId, confidence: 1 },
    ];
    const setupResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'set up C8 fixture', body: null, deltas: setupDeltas },
    });
    if (!setupResult.ok) throw new Error(`C8 setup commit failed: ${setupResult.message}`);

    // commitToBranch's own client-side fold already rejects this before it
    // ever reaches the server — the same C8 guard `deltas.property.test.ts`
    // already covers for the TypeScript engine directly. This confirms the
    // rejection survives end to end through the real RPC on this new code
    // path too, and that nothing was left half-applied.
    const mainAfterSetup = await getMainBranch(alice.client, modelId);
    if (!mainAfterSetup) throw new Error('main branch disappeared');
    const badRetractDeltas: Delta[] = [{ kind: 'element.retract', id: randomUUID(), elementId: fromId, elementType: 'system', previousDeltaId: createFromDeltaId, sourceId, confidence: 1 }];
    const badResult = await commitToBranch(alice.client, {
      modelId,
      branchId: mainAfterSetup.id,
      expectedHeadCommitId: mainAfterSetup.head_commit_id,
      envelope: { id: randomUUID(), branchId: mainAfterSetup.id, parentCommitId: mainAfterSetup.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'illegally retract a referenced element', body: null, deltas: badRetractDeltas },
    });
    expect(badResult.ok).toBe(false);

    const mainStillAtSetup = await getMainBranch(alice.client, modelId);
    expect(mainStillAtSetup?.head_commit_id).toBe(mainAfterSetup.head_commit_id);
    await expectProjectionMatchesFold(alice.client, modelId, mainAfterSetup.head_commit_id);
  });

  it('a commit containing an element.restore still lands correctly (the pre-E3 full-projection fallback path)', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main) throw new Error('main branch was not auto-created');

    const elementId = randomUUID();
    const createDeltaId = randomUUID();
    const createDeltas: Delta[] = [{ kind: 'element.create', id: createDeltaId, elementId, elementType: 'system', name: 'Restorable System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 }];
    const createResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'create restorable element', body: null, deltas: createDeltas },
    });
    if (!createResult.ok) throw new Error(`create commit failed: ${createResult.message}`);
    await expectProjectionMatchesFold(alice.client, modelId, createResult.commitId);

    const mainAfterCreate = await getMainBranch(alice.client, modelId);
    if (!mainAfterCreate) throw new Error('main branch disappeared');
    const retractDeltaId = randomUUID();
    const retractDeltas: Delta[] = [{ kind: 'element.retract', id: retractDeltaId, elementId, elementType: 'system', previousDeltaId: createDeltaId, sourceId, confidence: 1 }];
    const retractResult = await commitToBranch(alice.client, {
      modelId,
      branchId: mainAfterCreate.id,
      expectedHeadCommitId: mainAfterCreate.head_commit_id,
      envelope: { id: randomUUID(), branchId: mainAfterCreate.id, parentCommitId: mainAfterCreate.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'retract it', body: null, deltas: retractDeltas },
    });
    if (!retractResult.ok) throw new Error(`retract commit failed: ${retractResult.message}`);
    await expectProjectionMatchesFold(alice.client, modelId, retractResult.commitId);

    const mainAfterRetract = await getMainBranch(alice.client, modelId);
    if (!mainAfterRetract) throw new Error('main branch disappeared');
    const restoreDeltas: Delta[] = [{ kind: 'element.restore', id: randomUUID(), elementId, elementType: 'system', previousDeltaId: retractDeltaId, sourceId, confidence: 1 }];
    const restoreResult = await commitToBranch(alice.client, {
      modelId,
      branchId: mainAfterRetract.id,
      expectedHeadCommitId: mainAfterRetract.head_commit_id,
      envelope: { id: randomUUID(), branchId: mainAfterRetract.id, parentCommitId: mainAfterRetract.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'restore it', body: null, deltas: restoreDeltas },
    });
    if (!restoreResult.ok) throw new Error(`restore commit failed: ${restoreResult.message}`);
    await expectProjectionMatchesFold(alice.client, modelId, restoreResult.commitId);

    const { data: restoredRow, error: restoredError } = await alice.client.from('elements_head').select('name').eq('commit_id', restoreResult.commitId).eq('element_id', elementId).single();
    if (restoredError) throw new Error(`reading restored row: ${restoredError.message}`);
    expect(restoredRow.name).toBe('Restorable System');
  });
});

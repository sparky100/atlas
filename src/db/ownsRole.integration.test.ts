/**
 * Prompt 7k item 2: owns.role cardinality (C17 + the
 * `relationships_head_one_owner_per_role` backstop index) and the
 * `backfillOwnsRole` migration commit, against a real local Supabase. Same
 * "this sandbox has no Docker route" limitation named in
 * `repository.integration.test.ts`'s own module comment — written and
 * reasoned through against the real RLS/engine/index behaviour, not
 * executed here.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import { backfillOwnsRole } from './backfillOwnsRole';
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

describe('owns.role cardinality and backfill against a real local Supabase', () => {
  let owner: TestUser;
  let orgId: string;
  let modelId: string;
  let actorAId: string;
  let actorBId: string;
  let targetId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('ownsrole-owner');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Owns Role Test Org', slug: `ownsrole-${orgId.slice(0, 8)}`, createdBy: owner.id });

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Owns Role Test Model', slug: `ownsrole-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
  });

  afterAll(async () => {
    // Best-effort — a local Supabase reset (pnpm db:reset) is the real
    // cleanup between full test runs.
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('two owns edges to the same target, same role, are rejected naming C17; different roles are both accepted', async () => {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });

    actorAId = randomUUID();
    actorBId = randomUUID();
    targetId = randomUUID();
    const seedDeltas: Delta[] = [
      { kind: 'element.create', id: randomUUID(), elementId: actorAId, elementType: 'actor', name: 'Ada', parentId: null, attributes: { subtype: 'person', isExternal: false }, sourceId: source.id, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: actorBId, elementType: 'actor', name: 'Bea', parentId: null, attributes: { subtype: 'person', isExternal: false }, sourceId: source.id, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: targetId, elementType: 'system', name: 'Billing Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    ];
    const seedEnvelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed actors and a system', body: null, deltas: seedDeltas };
    const seedResult = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: seedEnvelope });
    if (!seedResult.ok) throw new Error(`seed commit: ${seedResult.message}`);

    const businessOwnsDelta: Delta = { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: actorAId, toElementId: targetId, attributes: { role: 'business' }, sourceId: source.id, confidence: 1 };
    const businessEnvelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: seedResult.commitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'Ada is the business owner', body: null, deltas: [businessOwnsDelta] };
    const businessResult = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: seedResult.commitId, envelope: businessEnvelope });
    if (!businessResult.ok) throw new Error(`business owns commit: ${businessResult.message}`);

    // A second business owner on the same target: rejected, C17.
    const secondBusinessDelta: Delta = { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: actorBId, toElementId: targetId, attributes: { role: 'business' }, sourceId: source.id, confidence: 1 };
    const conflictEnvelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: businessResult.commitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'Bea is also the business owner (conflict)', body: null, deltas: [secondBusinessDelta] };
    const conflictResult = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: businessResult.commitId, envelope: conflictEnvelope });
    expect(conflictResult.ok).toBe(false);
    if (!conflictResult.ok) expect(conflictResult.message).toMatch(/C17/);

    // A technical owner on the same target: accepted — different role, no conflict.
    const technicalDelta: Delta = { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: actorBId, toElementId: targetId, attributes: { role: 'technical' }, sourceId: source.id, confidence: 1 };
    const technicalEnvelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: businessResult.commitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'Bea is the technical owner', body: null, deltas: [technicalDelta] };
    const technicalResult = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: businessResult.commitId, envelope: technicalEnvelope });
    expect(technicalResult.ok).toBe(true);

    const { data: ownsRows } = await service.from('relationships_head').select('from_element_id, attributes').eq('model_id', modelId).eq('relationship_type', 'owns');
    expect(ownsRows ?? []).toHaveLength(2);
  });

  it('backfillOwnsRole migrates a legacy primary-shaped owns edge to role, clears primary, and is idempotent', async () => {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });

    // A legacy owns edge (primary: true, no role) — the shape every owns
    // edge had before this sprint. Not constructible through the normal
    // `Delta`/`CommitEnvelope` TS types any more (`OwnsAttributes.role` is
    // required) — this reaches in at the wire-row level, the same way real
    // pre-migration data sits in the database today, to prove the backfill
    // handles it rather than only ever testing against freshly-typed data.
    const legacyActorId = randomUUID();
    const legacyTargetId = randomUUID();
    const legacyDeltas: Delta[] = [
      { kind: 'element.create', id: randomUUID(), elementId: legacyActorId, elementType: 'actor', name: 'Legacy Owner', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: source.id, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: legacyTargetId, elementType: 'capability', name: 'Legacy Capability', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: legacyActorId, toElementId: legacyTargetId, attributes: { primary: true } as never, sourceId: source.id, confidence: 1 },
    ];
    const legacyEnvelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed a legacy primary-shaped owns edge', body: null, deltas: legacyDeltas };
    const legacyResult = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: legacyEnvelope });
    if (!legacyResult.ok) throw new Error(`legacy seed commit: ${legacyResult.message}`);

    const firstRun = await backfillOwnsRole(owner.client, { modelId, userId: owner.id });
    expect(firstRun.ok).toBe(true);
    if (firstRun.ok && firstRun.kind === 'backfilled') {
      expect(firstRun.backfilled).toBe(1);
      expect(firstRun.candidates[0]?.role).toBe('business');
    } else {
      throw new Error(`expected a 'backfilled' result, got ${JSON.stringify(firstRun)}`);
    }

    const { data: migratedRows } = await service.from('relationships_head').select('attributes').eq('model_id', modelId).eq('relationship_type', 'owns').eq('from_element_id', legacyActorId);
    const migratedAttributes = migratedRows?.[0]?.attributes;
    expect(migratedAttributes?.role).toBe('business');
    expect(migratedAttributes?.primary).toBeUndefined();

    // Idempotent: nothing left to migrate, no second commit written.
    const secondRun = await backfillOwnsRole(owner.client, { modelId, userId: owner.id });
    expect(secondRun).toEqual({ ok: true, kind: 'nothing-to-backfill', message: 'every owns edge already has a role — nothing to backfill' });
  });
});

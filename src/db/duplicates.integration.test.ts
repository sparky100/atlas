/**
 * F4/ADR-019: schema, RLS, and detection RPCs for the duplicates report,
 * against a real local Supabase. Same "this sandbox has no Docker route"
 * limitation named in `repository.integration.test.ts`'s own module
 * comment — written and reasoned through against the real RLS/RPC
 * behaviour, not executed here.
 *
 * The first describe block is Step 2's own scope (`docs/ADR-000-foundations.md`'s
 * "Amended (F4, ...)" paragraph): before any RPC existed, every row was
 * inserted directly by the service-role client, proving only the schema,
 * RLS, and the toggle's own grant. The second is Step 3's: the real
 * `atlas.run_duplicate_check`/`atlas.dismiss_duplicate_pair` RPCs added in
 * `20260924020000_duplicate_check_rpcs.sql`, exercising the detection
 * query itself. The full scenario this pair sits within (through a real
 * merge, the report's own read query) is Step 7's own job, not repeated
 * here.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';
import type { DuplicateCheckRunRow, DuplicateDismissalRow } from './types';

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

describe('duplicates schema (F4 step 2) against a real local Supabase', () => {
  let owner: TestUser;
  let contributor: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let modelId: string;
  let elementAId: string;
  let elementBId: string;
  let runId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('duplicates-owner');
    contributor = await createSignedInUser('duplicates-contributor');
    viewer = await createSignedInUser('duplicates-viewer');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Duplicates Test Org', slug: `duplicates-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Duplicates Test Model', slug: `duplicates-model-${modelId.slice(0, 8)}`, createdBy: owner.id });

    elementAId = randomUUID();
    elementBId = randomUUID();
    runId = randomUUID();
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('a real member cannot insert into any of the three tables directly (no grant to authenticated at all)', async () => {
    const { error: runError } = await owner.client.from('duplicate_check_runs').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, status: 'running' });
    expect(runError).not.toBeNull();

    const { error: candidateError } = await owner.client
      .from('duplicate_candidates')
      .insert({ id: randomUUID(), org_id: orgId, model_id: modelId, element_a_id: elementAId, element_b_id: elementBId, element_type: 'system', score: 0.7, name_similarity: 0.7, last_seen_check_run_id: runId });
    expect(candidateError).not.toBeNull();

    const { error: dismissalError } = await owner.client
      .from('duplicate_dismissals')
      .insert({ id: randomUUID(), org_id: orgId, model_id: modelId, element_a_id: elementAId, element_b_id: elementBId, dismissed_by: owner.id });
    expect(dismissalError).not.toBeNull();
  });

  it('contributor+ can select rows the service role writes; a viewer sees none', async () => {
    const { error: insertRunError } = await service.from('duplicate_check_runs').insert({ id: runId, org_id: orgId, model_id: modelId, triggered_by: owner.id, status: 'succeeded', candidate_count: 1, finished_at: new Date().toISOString() });
    if (insertRunError) throw new Error(`seed duplicate_check_runs: ${insertRunError.message}`);

    const { error: insertCandidateError } = await service
      .from('duplicate_candidates')
      .insert({ id: randomUUID(), org_id: orgId, model_id: modelId, element_a_id: elementAId, element_b_id: elementBId, element_type: 'system', score: 0.82, name_similarity: 0.75, signals: { sharedOwner: true }, last_seen_check_run_id: runId });
    if (insertCandidateError) throw new Error(`seed duplicate_candidates: ${insertCandidateError.message}`);

    const { error: insertDismissalError } = await service.from('duplicate_dismissals').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, element_a_id: elementAId, element_b_id: elementBId, dismissed_by: owner.id });
    if (insertDismissalError) throw new Error(`seed duplicate_dismissals: ${insertDismissalError.message}`);

    for (const member of [owner, contributor]) {
      const { data: runs } = await member.client.from('duplicate_check_runs').select('id').eq('model_id', modelId);
      expect(runs).toHaveLength(1);
      const { data: candidates } = await member.client.from('duplicate_candidates').select('id').eq('model_id', modelId);
      expect(candidates).toHaveLength(1);
      const { data: dismissals } = await member.client.from('duplicate_dismissals').select('id').eq('model_id', modelId);
      expect(dismissals).toHaveLength(1);
    }

    const { data: viewerRuns } = await viewer.client.from('duplicate_check_runs').select('id').eq('model_id', modelId);
    expect(viewerRuns ?? []).toHaveLength(0);
    const { data: viewerCandidates } = await viewer.client.from('duplicate_candidates').select('id').eq('model_id', modelId);
    expect(viewerCandidates ?? []).toHaveLength(0);
    const { data: viewerDismissals } = await viewer.client.from('duplicate_dismissals').select('id').eq('model_id', modelId);
    expect(viewerDismissals ?? []).toHaveLength(0);
  });

  it('models.duplicates_check_enabled defaults false, and is toggleable by an owner but not a contributor or viewer', async () => {
    const { data: initial } = await owner.client.from('models').select('duplicates_check_enabled').eq('id', modelId).single();
    expect(initial?.duplicates_check_enabled).toBe(false);

    const { error: ownerUpdateError, data: ownerUpdateData } = await owner.client.from('models').update({ duplicates_check_enabled: true }).eq('id', modelId).select('duplicates_check_enabled').single();
    expect(ownerUpdateError).toBeNull();
    expect(ownerUpdateData?.duplicates_check_enabled).toBe(true);

    // RLS silently matches zero rows rather than erroring — models_update's
    // own policy (owner/architect only) means a contributor's update
    // affects nothing, not that it fails loudly.
    const { data: contributorUpdateData } = await contributor.client.from('models').update({ duplicates_check_enabled: false }).eq('id', modelId).select('duplicates_check_enabled');
    expect(contributorUpdateData ?? []).toHaveLength(0);

    const { data: stillEnabled } = await owner.client.from('models').select('duplicates_check_enabled').eq('id', modelId).single();
    expect(stillEnabled?.duplicates_check_enabled).toBe(true);
  });
});

describe('atlas.run_duplicate_check / atlas.dismiss_duplicate_pair (F4 step 3) against a real local Supabase', () => {
  let owner: TestUser;
  let contributor: TestUser;
  let orgId: string;
  let modelId: string;
  let powerOnId: string;
  let powerOnVariantId: string;
  let distinctSystemId: string;
  let ownerActorId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('duplicatecheck-owner');
    contributor = await createSignedInUser('duplicatecheck-contributor');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Duplicate Check Test Org', slug: `duplicatecheck-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert({ org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id });
    if (memberError) throw new Error(`add contributor: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Duplicate Check Test Model', slug: `duplicatecheck-model-${modelId.slice(0, 8)}`, createdBy: owner.id });

    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');

    // "PowerON"/"Power On" — the same near-duplicate spelling pair fixture
    // 04 already uses for exactly this reason (a real, deliberately messy
    // name pair, not a contrived one). A shared owner gives the
    // corroborating-signal path something real to find; "Totally
    // Different System" proves the scan doesn't just flag everything.
    powerOnId = randomUUID();
    powerOnVariantId = randomUUID();
    distinctSystemId = randomUUID();
    ownerActorId = randomUUID();

    const deltas: Delta[] = [
      { kind: 'element.create', id: randomUUID(), elementId: powerOnId, elementType: 'system', name: 'PowerON', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: powerOnVariantId, elementType: 'system', name: 'Power On', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: distinctSystemId, elementType: 'system', name: 'Totally Different System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: ownerActorId, elementType: 'actor', name: 'Platform Team', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: source.id, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: ownerActorId, toElementId: powerOnId, attributes: { role: 'business' }, sourceId: source.id, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: ownerActorId, toElementId: powerOnVariantId, attributes: { role: 'business' }, sourceId: source.id, confidence: 1 },
    ];
    const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed', body: null, deltas };
    const result = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
    if (!result.ok) throw new Error(`seed commit: ${result.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('flags PowerON/Power On as a candidate (with the shared-owner signal), never the distinct system, and only that one run', async () => {
    const { data: runData, error } = await contributor.client.schema('atlas').rpc('run_duplicate_check', { p_model_id: modelId }).single();
    const run = runData as DuplicateCheckRunRow | null;
    expect(error).toBeNull();
    expect(run?.status).toBe('succeeded');
    expect(run?.candidate_count).toBe(1);

    const { data: candidates } = await owner.client.from('duplicate_candidates').select('*').eq('model_id', modelId);
    expect(candidates).toHaveLength(1);
    const pair = candidates?.[0];
    expect([pair?.element_a_id, pair?.element_b_id].sort()).toEqual([powerOnId, powerOnVariantId].sort());
    expect(pair?.element_type).toBe('system');
    expect(pair?.name_similarity).toBeGreaterThanOrEqual(0.6);
    expect((pair?.signals as Record<string, unknown> | undefined)?.sharedOwner).toBe(true);

    expect(candidates?.some((c) => [c.element_a_id, c.element_b_id].includes(distinctSystemId))).toBe(false);
  });

  it('a contributor can dismiss a pair; it disappears immediately and never resurfaces on a later run', async () => {
    const { error: dismissError, data: dismissalData } = await contributor.client.schema('atlas').rpc('dismiss_duplicate_pair', { p_model_id: modelId, p_element_a_id: powerOnId, p_element_b_id: powerOnVariantId }).single();
    const dismissal = dismissalData as DuplicateDismissalRow | null;
    expect(dismissError).toBeNull();
    expect(dismissal?.dismissed_by).toBe(contributor.id);

    const { data: afterDismiss } = await owner.client.from('duplicate_candidates').select('id').eq('model_id', modelId);
    expect(afterDismiss ?? []).toHaveLength(0);

    const { data: rerunData, error: rerunError } = await owner.client.schema('atlas').rpc('run_duplicate_check', { p_model_id: modelId }).single();
    const rerun = rerunData as DuplicateCheckRunRow | null;
    expect(rerunError).toBeNull();
    expect(rerun?.candidate_count).toBe(0);

    const { data: stillGone } = await owner.client.from('duplicate_candidates').select('id').eq('model_id', modelId);
    expect(stillGone ?? []).toHaveLength(0);

    // Idempotent: dismissing the same pair again is a no-op, not an error.
    const { error: secondDismissError } = await contributor.client.schema('atlas').rpc('dismiss_duplicate_pair', { p_model_id: modelId, p_element_a_id: powerOnVariantId, p_element_b_id: powerOnId });
    expect(secondDismissError).toBeNull();
  });

  it('refuses a second concurrent run on the same model (the partial unique index, not a check-then-insert race)', async () => {
    const [first, second] = await Promise.all([
      owner.client.schema('atlas').rpc('run_duplicate_check', { p_model_id: modelId }),
      contributor.client.schema('atlas').rpc('run_duplicate_check', { p_model_id: modelId }),
    ]);
    const errors = [first.error, second.error].filter((e) => e !== null);
    const successes = [first.error, second.error].filter((e) => e === null);
    // Exactly one of the two truly concurrent calls wins the unique-index
    // race on duplicate_check_runs(model_id) where status = 'running'; the
    // other gets this function's own "already running" exception. Both
    // succeeding, or both failing, would mean the guard isn't atomic.
    expect(successes).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});

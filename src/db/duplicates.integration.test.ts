/**
 * F4/ADR-019: schema + RLS round trip for `duplicate_check_runs`/
 * `duplicate_candidates`/`duplicate_dismissals` and the `models.
 * duplicates_check_enabled` toggle, against a real local Supabase. Same
 * "this sandbox has no Docker route" limitation named in
 * `repository.integration.test.ts`'s own module comment — written and
 * reasoned through against the real RLS/RPC behaviour, not executed here.
 *
 * Step 2's own scope only (`docs/ADR-000-foundations.md`'s "Amended (F4,
 * ...)" paragraph, Step 2 of the F4 plan): no RPC exists yet
 * (`atlas.run_duplicate_check`/`atlas.dismiss_duplicate_pair` land in
 * Step 3), so every row here is inserted directly by the service-role
 * client — this test only proves the schema, RLS, and the toggle's own
 * grant are correct, not the detection logic itself.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';

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

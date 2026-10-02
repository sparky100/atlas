/**
 * ADR-025 (F12 step 3), against a real local Supabase with real RLS:
 * "Still accurate" re-asserts every current fact of an element, unchanged,
 * as one commit under a fresh `attestation` source — so each fact's date
 * moves to the confirmation's and its source says "confirmed", while the
 * element's values don't change and the old facts stay in history. An
 * architect confirms on main; a contributor only inside a draft change; a
 * viewer can't create the source at all.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ElementsHeadRow, FactsRow } from '../contracts/rows';
import { commitAttestation } from '../ui/elements/attestation';
import { createChangeBranch, getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';
import { createAttestationSource, getOrCreateManualSource } from './sources';
import type { BranchRow } from './types';

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

const TODAY = new Date().toISOString().slice(0, 10);

describe('Still accurate (ADR-025) against a real local Supabase', () => {
  let architect: TestUser;
  let contributor: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let modelId: string;
  const systemId = randomUUID();

  async function main(): Promise<BranchRow> {
    const branch = await getMainBranch(architect.client, modelId);
    if (!branch) throw new Error('main branch missing');
    return branch;
  }

  async function elementAt(commitId: string): Promise<ElementsHeadRow> {
    const { data, error } = await service.from('elements_head').select('element_id, element_type, name, parent_id, attributes, exists_delta_id').eq('commit_id', commitId).eq('element_id', systemId).single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function factsAt(commitId: string): Promise<Map<string, FactsRow>> {
    const { data, error } = await service.from('facts').select('*').eq('commit_id', commitId).eq('subject_id', systemId);
    if (error) throw new Error(error.message);
    return new Map((data as FactsRow[]).map((f) => [f.attribute, f]));
  }

  beforeAll(async () => {
    architect = await createSignedInUser('attest-architect');
    contributor = await createSignedInUser('attest-contributor');
    viewer = await createSignedInUser('attest-viewer');

    orgId = randomUUID();
    await createOrganisation(architect.client, { id: orgId, name: 'Attestation Test Org', slug: `attest-${orgId.slice(0, 8)}`, createdBy: architect.id });
    const { error: memberError } = await architect.client.from('members').insert([
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: architect.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: architect.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(architect.client, { id: modelId, orgId, name: 'Attestation Test Model', slug: `attest-model-${modelId.slice(0, 8)}`, createdBy: architect.id });
    const source = await getOrCreateManualSource(architect.client, { id: randomUUID(), orgId, modelId, userId: architect.id });
    const branch = await main();
    const seed = await commitToBranch(architect.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: branch.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: branch.id,
        parentCommitId: branch.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'seed a system',
        body: null,
        deltas: [
          {
            kind: 'element.create',
            id: randomUUID(),
            elementId: systemId,
            elementType: 'system',
            name: 'Payroll',
            parentId: null,
            attributes: { isExternal: false, lifecycleStatus: 'active', criticality: 'high' },
            sourceId: source.id,
            confidence: 0.8,
            effectiveDate: '2020-01-01',
          },
        ],
      },
    });
    if (!seed.ok) throw new Error(`seed: ${seed.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('an architect\'s confirmation on main re-asserts every fact unchanged, as one commit, under an attestation source', async () => {
    const before = await main();
    const factsBefore = await factsAt(before.head_commit_id);
    const element = await elementAt(before.head_commit_id);

    const result = await commitAttestation(architect.client, { modelId, orgId, userId: architect.id, branch: before, expectedHeadCommitId: before.head_commit_id, element, today: TODAY });
    if (!result.ok) throw new Error(`confirm: ${result.message}`);

    const { data: deltas } = await service.from('deltas').select('kind, attribute, value, previous_delta_id, source_id, confidence').eq('commit_id', result.commitId);
    const reasserted = (deltas ?? []) as { kind: string; attribute: string; value: unknown; previous_delta_id: string; source_id: string; confidence: number }[];
    // Every fact but existence, each superseding its own previous fact with the same value.
    expect(reasserted.map((d) => d.attribute).sort()).toEqual([...factsBefore.keys()].filter((k) => k !== '$exists').sort());
    for (const delta of reasserted) {
      const previous = factsBefore.get(delta.attribute);
      expect(delta).toMatchObject({ kind: 'element_update', value: previous?.value, previous_delta_id: previous?.delta_id, confidence: 1 });
    }

    const sourceIds = new Set(reasserted.map((d) => d.source_id));
    expect(sourceIds.size).toBe(1);
    const { data: source } = await service.from('sources').select('kind, name, user_id, captured_at, created_by').eq('id', [...sourceIds][0] ?? '').single();
    expect(source).toMatchObject({ kind: 'attestation', name: 'Confirmed still accurate — Payroll', user_id: null, captured_at: TODAY, created_by: architect.id });

    // The values are unchanged; each fact now dates from the confirmation, not 2020.
    const after = await main();
    expect(after.head_commit_id).toBe(result.commitId);
    expect((await elementAt(after.head_commit_id)).attributes).toEqual(element.attributes);
    const factsAfter = await factsAt(after.head_commit_id);
    expect(factsAfter.get('criticality')).toMatchObject({ value: 'high', effective_date: null, confidence: 1, asserted_by: architect.id });
    expect(new Date(factsAfter.get('criticality')?.asserted_at ?? 0).getTime()).toBeGreaterThan(new Date('2020-01-02').getTime());
    expect(factsBefore.get('criticality')?.effective_date).toBe('2020-01-01');
  });

  it('a contributor confirms inside their draft change, and main is untouched', async () => {
    const mainBefore = await main();
    const change = await createChangeBranch(contributor.client, { id: randomUUID(), orgId, modelId, name: `attest-${randomUUID().slice(0, 8)}`, createdBy: contributor.id, intent: 'record', mainHeadCommitId: mainBefore.head_commit_id });
    const result = await commitAttestation(contributor.client, { modelId, orgId, userId: contributor.id, branch: change, expectedHeadCommitId: change.head_commit_id, element: await elementAt(mainBefore.head_commit_id), today: TODAY });
    if (!result.ok) throw new Error(`confirm: ${result.message}`);
    expect((await getBranch(contributor.client, change.id))?.head_commit_id).toBe(result.commitId);
    expect((await main()).head_commit_id).toBe(mainBefore.head_commit_id);
  });

  it('a viewer cannot create an attestation source, so cannot confirm', async () => {
    await expect(createAttestationSource(viewer.client, { id: randomUUID(), orgId, modelId, createdBy: viewer.id, elementName: 'Payroll', confirmedOn: TODAY })).rejects.toThrow();
  });

  it('an attestation source can never carry a user id', async () => {
    const { error } = await architect.client.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'attestation', name: 'x', user_id: architect.id, created_by: architect.id });
    expect(error).not.toBeNull();
  });
});

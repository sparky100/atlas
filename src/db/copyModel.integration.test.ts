/**
 * ADR-030 "Copy this model", against a real local Supabase with real RLS:
 * an owner can copy; an architect (who can edit main) cannot — the refusal
 * comes from `atlas.copy_model`, not the UI. The copy has new ids, the same
 * content, every fact's original source (re-keyed into the new model), one
 * "Copied from" commit, and the source model is left exactly as it was.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { copyModel } from './copyModel';
import { loadEnv } from './env';
import { createModel, getModelBySlug } from './models';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';
import type { ModelRow } from './types';

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

describe('Copy this model (ADR-030) against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let orgId: string;
  let source: ModelRow;
  const systemId = randomUUID();
  const capabilityId = randomUUID();

  beforeAll(async () => {
    owner = await createSignedInUser('copy-owner');
    architect = await createSignedInUser('copy-architect');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Copy Test Org', slug: `copy-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert({ org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id });
    if (memberError) throw new Error(`add member: ${memberError.message}`);

    const modelId = randomUUID();
    source = await createModel(owner.client, { id: modelId, orgId, name: 'Copy Source', slug: `copy-source-${modelId.slice(0, 8)}`, createdBy: owner.id });
    const manual = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main missing');
    const seed = await commitToBranch(owner.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'seed',
        body: null,
        deltas: [
          { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Billing', parentId: null, attributes: {}, sourceId: manual.id, confidence: 1 },
          { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Invoicer', parentId: null, attributes: { isExternal: false, lifecycleStatus: 'active' }, sourceId: manual.id, confidence: 0.7 },
          { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: manual.id, confidence: 1 },
        ],
      },
    });
    if (!seed.ok) throw new Error(`seed: ${seed.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('refuses an architect at the database, not just the UI', async () => {
    const result = await copyModel(architect.client, { source, name: 'Architect copy', slug: 'architect-copy', authorId: architect.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/only an owner/i);
    expect(await getModelBySlug(owner.client, orgId, 'architect-copy')).toBeNull();
  });

  it('lets an owner copy: new ids, same content, original provenance, one "Copied from" commit', async () => {
    const result = await copyModel(owner.client, { source, name: 'Copy Of Source', slug: 'copy-of-source', authorId: owner.id });
    if (!result.ok) throw new Error(result.message);
    expect(result.copiedElements).toBe(2);
    expect(result.copiedRelationships).toBe(1);

    const copy = result.model;
    expect(copy.id).not.toBe(source.id);
    expect(copy.org_id).toBe(orgId);

    const copyMain = await getMainBranch(owner.client, copy.id);
    if (!copyMain) throw new Error('copy has no main');
    const { data: commit } = await service.from('commits').select('title, kind, depth').eq('id', copyMain.head_commit_id).single();
    expect(commit).toMatchObject({ title: 'Copied from Copy Source', kind: 'manual', depth: 1 });

    const { data: elements } = await service.from('elements_head').select('element_id, name').eq('commit_id', copyMain.head_commit_id);
    expect((elements ?? []).map((e) => e.name as string).sort()).toEqual(['Billing', 'Invoicer']);
    for (const e of elements ?? []) expect([systemId, capabilityId]).not.toContain(e.element_id);

    // Provenance: the copied system's confidence survives, and its source lives in the NEW model.
    const { data: facts } = await service.from('facts').select('attribute, confidence, source_id').eq('commit_id', copyMain.head_commit_id).eq('attribute', 'name');
    expect((facts ?? []).map((f) => Number(f.confidence)).sort()).toEqual([0.7, 1]);
    const { data: sources } = await service.from('sources').select('id, model_id').in('id', (facts ?? []).map((f) => f.source_id as string));
    for (const s of sources ?? []) expect(s.model_id).toBe(copy.id);
  });

  it('leaves the source model untouched', async () => {
    const main = await getMainBranch(owner.client, source.id);
    const { count } = await service.from('commits').select('id', { count: 'exact', head: true }).eq('model_id', source.id);
    expect(count).toBe(2); // genesis + the seed commit — nothing the copy did is written here
    expect(main).not.toBeNull();
  });
});

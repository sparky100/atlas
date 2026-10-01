/**
 * F12 step 1, against a real local Supabase with real RLS: a grid save
 * (`commitBulkEdit`) writes exactly one commit, with one `element_update`
 * delta per changed cell — each superseding the right fact, all under the
 * editor's own manual source at confidence 1 — and nothing for an
 * unchanged cell; to main for an architect, to a draft change for a
 * contributor (main untouched); and refuses, writing nothing, for an
 * invalid value or a viewer.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Criticality } from '../contracts/delta';
import type { ElementsHeadRow } from '../contracts/rows';
import { commitBulkEdit } from '../ui/elements/bulkEdit';
import { createChangeBranch, getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';
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

describe('bulk edit (F12 step 1) against a real local Supabase', () => {
  let owner: TestUser;
  let contributor: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let modelId: string;
  const ids = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
  let criticalityFactDeltaId: string;

  async function main(): Promise<BranchRow> {
    const branch = await getMainBranch(owner.client, modelId);
    if (!branch) throw new Error('main branch missing');
    return branch;
  }

  async function elementsAt(commitId: string): Promise<Map<string, ElementsHeadRow>> {
    const { data, error } = await service.from('elements_head').select('element_id, element_type, name, parent_id, attributes, exists_delta_id').eq('commit_id', commitId);
    if (error) throw new Error(error.message);
    return new Map((data as ElementsHeadRow[]).map((row) => [row.element_id, row]));
  }

  async function commitsOn(branchId: string): Promise<{ id: string }[]> {
    const { data, error } = await service.from('commits').select('id').eq('branch_id', branchId);
    if (error) throw new Error(error.message);
    return data;
  }

  async function deltasOf(commitId: string) {
    const { data, error } = await service.from('deltas').select('kind, subject_id, attribute, value, previous_delta_id, source_id, confidence').eq('commit_id', commitId).order('seq');
    if (error) throw new Error(error.message);
    return data as { kind: string; subject_id: string; attribute: string; value: unknown; previous_delta_id: string; source_id: string; confidence: number }[];
  }

  beforeAll(async () => {
    owner = await createSignedInUser('bulkedit-owner');
    contributor = await createSignedInUser('bulkedit-contributor');
    viewer = await createSignedInUser('bulkedit-viewer');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Bulk Edit Test Org', slug: `bulkedit-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Bulk Edit Test Model', slug: `bulkedit-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });

    const branch = await main();
    const create = (elementId: string, name: string, attributes: { criticality?: Criticality }) => ({
      kind: 'element.create' as const,
      id: randomUUID(),
      elementId,
      elementType: 'system' as const,
      name,
      parentId: null,
      attributes: { isExternal: false, lifecycleStatus: 'active' as const, ...attributes },
      sourceId: source.id,
      confidence: 1,
    });
    const seed = await commitToBranch(owner.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: branch.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: branch.id,
        parentCommitId: branch.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'seed three systems',
        body: null,
        deltas: [create(ids.a, 'Payroll', { criticality: 'low' }), create(ids.b, 'Ledger', {}), create(ids.c, 'Rota', {})],
      },
    });
    if (!seed.ok) throw new Error(`seed: ${seed.message}`);

    const { data: fact, error } = await service.from('facts').select('delta_id').eq('commit_id', seed.commitId).eq('subject_id', ids.a).eq('attribute', 'criticality').single();
    if (error) throw new Error(error.message);
    criticalityFactDeltaId = (fact).delta_id;
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('an owner\'s save at main is exactly one commit: one delta per changed cell, superseding the right fact, under their manual source at confidence 1', async () => {
    const before = await main();
    const commitsBefore = await commitsOn(before.id);
    const result = await commitBulkEdit(owner.client, {
      modelId,
      orgId,
      userId: owner.id,
      branch: before,
      expectedHeadCommitId: before.head_commit_id,
      cells: [
        { elementId: ids.a, key: 'criticality', draft: 'high' },
        { elementId: ids.b, key: 'disposition', draft: 'migrate' },
        // Unchanged: Rota's lifecycle is already active — no delta for it.
        { elementId: ids.c, key: 'lifecycleStatus', draft: 'active' },
      ],
      elementsById: await elementsAt(before.head_commit_id),
      customFields: new Map(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.commitId === null) throw new Error('expected a commit');

    expect((await commitsOn(before.id)).length).toBe(commitsBefore.length + 1);
    const after = await main();
    expect(after.head_commit_id).toBe(result.commitId);

    const ownerSource = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    const deltas = await deltasOf(result.commitId);
    expect(deltas).toHaveLength(2);
    const bySubject = new Map(deltas.map((d) => [d.subject_id, d]));
    expect(bySubject.get(ids.a)).toMatchObject({ kind: 'element_update', attribute: 'criticality', value: 'high', previous_delta_id: criticalityFactDeltaId, source_id: ownerSource.id, confidence: 1 });
    expect(bySubject.get(ids.b)).toMatchObject({ kind: 'element_update', attribute: 'disposition', value: 'migrate', source_id: ownerSource.id, confidence: 1 });

    const { data: facts } = await service.from('facts').select('subject_id, attribute, value').eq('commit_id', result.commitId).in('subject_id', [ids.a, ids.b]).in('attribute', ['criticality', 'disposition']);
    expect(facts).toEqual(expect.arrayContaining([
      { subject_id: ids.a, attribute: 'criticality', value: 'high' },
      { subject_id: ids.b, attribute: 'disposition', value: 'migrate' },
    ]));
  });

  it('a save with nothing changed writes no commit', async () => {
    const before = await main();
    const result = await commitBulkEdit(owner.client, {
      modelId, orgId, userId: owner.id, branch: before, expectedHeadCommitId: before.head_commit_id,
      cells: [{ elementId: ids.a, key: 'criticality', draft: 'high' }],
      elementsById: await elementsAt(before.head_commit_id),
      customFields: new Map(),
    });
    expect(result).toEqual({ ok: true, commitId: null, newHead: null });
    expect((await main()).head_commit_id).toBe(before.head_commit_id);
  });

  it('an invalid cell refuses the whole save and writes nothing', async () => {
    const before = await main();
    const result = await commitBulkEdit(owner.client, {
      modelId, orgId, userId: owner.id, branch: before, expectedHeadCommitId: before.head_commit_id,
      cells: [
        { elementId: ids.b, key: 'criticality', draft: 'medium' },
        { elementId: ids.c, key: 'criticality', draft: 'enormous' },
      ],
      elementsById: await elementsAt(before.head_commit_id),
      customFields: new Map(),
    });
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'validation') throw new Error('expected a validation refusal');
    expect([...result.errors.keys()]).toEqual([`${ids.c}:criticality`]);
    expect((await main()).head_commit_id).toBe(before.head_commit_id);
  });

  it('a contributor\'s save goes to their draft change as one commit, and main is untouched', async () => {
    const mainBefore = await main();
    const change = await createChangeBranch(contributor.client, { id: randomUUID(), orgId, modelId, name: `bulk-${randomUUID().slice(0, 8)}`, createdBy: contributor.id, intent: 'record', mainHeadCommitId: mainBefore.head_commit_id });
    const result = await commitBulkEdit(contributor.client, {
      modelId, orgId, userId: contributor.id, branch: change, expectedHeadCommitId: change.head_commit_id,
      cells: [
        { elementId: ids.b, key: 'criticality', draft: 'critical' },
        { elementId: ids.c, key: 'disposition', draft: 'eliminate' },
      ],
      elementsById: await elementsAt(mainBefore.head_commit_id),
      customFields: new Map(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.commitId === null) throw new Error('expected a commit');
    expect((await getBranch(contributor.client, change.id))?.head_commit_id).toBe(result.commitId);
    expect(await commitsOn(change.id)).toHaveLength(1);
    expect(await deltasOf(result.commitId)).toHaveLength(2);
    expect((await main()).head_commit_id).toBe(mainBefore.head_commit_id);

    // A second save on the change folds the change's own facts for previousDeltaId.
    const changeNow = await getBranch(contributor.client, change.id);
    if (!changeNow) throw new Error('change missing');
    const second = await commitBulkEdit(contributor.client, {
      modelId, orgId, userId: contributor.id, branch: changeNow, expectedHeadCommitId: changeNow.head_commit_id,
      cells: [{ elementId: ids.b, key: 'criticality', draft: 'high' }],
      elementsById: await elementsAt(mainBefore.head_commit_id),
      customFields: new Map(),
    });
    if (!second.ok || second.commitId === null) throw new Error('expected a second commit');
    const [delta] = await deltasOf(second.commitId);
    const [firstOnB] = (await deltasOf(result.commitId)).filter((d) => d.subject_id === ids.b);
    expect(delta?.previous_delta_id).toBeDefined();
    const { data: firstIds } = await service.from('deltas').select('id').eq('commit_id', result.commitId).eq('subject_id', ids.b);
    expect(delta?.previous_delta_id).toBe((firstIds as { id: string }[])[0]?.id);
    expect(firstOnB?.value).toBe('critical');
  });

  it('a viewer cannot save: nothing is written to main', async () => {
    const before = await main();
    const result = await commitBulkEdit(viewer.client, {
      modelId, orgId, userId: viewer.id, branch: before, expectedHeadCommitId: before.head_commit_id,
      cells: [{ elementId: ids.c, key: 'criticality', draft: 'low' }],
      elementsById: await elementsAt(before.head_commit_id),
      customFields: new Map(),
    }).catch((e: unknown) => ({ ok: false as const, reason: 'thrown' as const, message: String(e) }));
    expect(result.ok).toBe(false);
    expect((await main()).head_commit_id).toBe(before.head_commit_id);
  });
});

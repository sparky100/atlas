/**
 * ADR-033 sample models, against a real local Supabase with real RLS:
 *  - only a platform admin can write `sample_models` (row-level security refuses
 *    everyone else), and nobody can change or remove a published version;
 *  - a signed-out caller reads nothing;
 *  - an owner or architect copies a sample into their OWN organisation, while a
 *    contributor, and a signed-in user from a different organisation, cannot;
 *  - the copy has new ids, the same content, the original provenance re-keyed
 *    into the new model, its aliases, one "Copied from" commit — and nothing
 *    from the sample's organisation (no capture job, no person) is carried over.
 * There is no new database function, so there is no new advisor finding.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { createModel, getModelBySlug } from './models';
import { createOrganisation } from './organisations';
import { copySampleModel, listSampleModels, publishSampleModel } from './sampleModels';
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

describe('Sample models (ADR-033) against a real local Supabase', () => {
  let admin: TestUser;
  let notAdmin: TestUser;
  let newOwner: TestUser;
  let newArchitect: TestUser;
  let outsider: TestUser;
  let adminOrgId: string;
  let newOrgId: string;
  let source: ModelRow;
  const slug = `sample-${randomUUID().slice(0, 8)}`;
  const systemId = randomUUID();
  const capabilityId = randomUUID();

  beforeAll(async () => {
    admin = await createSignedInUser('sample-admin');
    notAdmin = await createSignedInUser('sample-not-admin');
    newOwner = await createSignedInUser('sample-new-owner');
    newArchitect = await createSignedInUser('sample-new-architect');
    outsider = await createSignedInUser('sample-outsider');
    const { error: adminError } = await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null });
    if (adminError) throw new Error(`seed platform_admins: ${adminError.message}`);

    adminOrgId = randomUUID();
    await createOrganisation(admin.client, { id: adminOrgId, name: 'Sample Source Org', slug: `sample-src-${adminOrgId.slice(0, 8)}`, createdBy: admin.id });
    newOrgId = randomUUID();
    await createOrganisation(newOwner.client, { id: newOrgId, name: 'Newcomer Org', slug: `newcomer-${newOrgId.slice(0, 8)}`, createdBy: newOwner.id });
    const { error: memberError } = await newOwner.client.from('members').insert({ org_id: newOrgId, user_id: newArchitect.id, role: 'architect', invited_by: newOwner.id });
    if (memberError) throw new Error(`add member: ${memberError.message}`);

    const modelId = randomUUID();
    source = await createModel(admin.client, { id: modelId, orgId: adminOrgId, name: 'Sample Landscape', slug: `sample-landscape-${modelId.slice(0, 8)}`, description: 'A made-up landscape', createdBy: admin.id });
    const manual = await getOrCreateManualSource(admin.client, { id: randomUUID(), orgId: adminOrgId, modelId, userId: admin.id });
    const main = await getMainBranch(admin.client, modelId);
    if (!main) throw new Error('main missing');
    const seed = await commitToBranch(admin.client, {
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
    const { error: aliasError } = await service.from('aliases').insert({ id: randomUUID(), org_id: adminOrgId, model_id: modelId, element_id: systemId, alias_value: 'INV-1', alias_type: 'code', source_id: manual.id, confidence: 1, created_by: admin.id });
    if (aliasError) throw new Error(`seed alias: ${aliasError.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', newOrgId);
    await service.from('organisations').delete().eq('id', adminOrgId);
    await service.from('platform_admins').delete().eq('user_id', admin.id);
  });

  it('lets only a platform admin write the table — everyone else is refused by row-level security', async () => {
    const payload = { elementsHead: [{}], relationshipsHead: [], facts: [], sources: [], aliases: [] };
    const row = { slug, version: 99, name: 'Sneaky', payload };
    const { error: userInsert } = await notAdmin.client.from('sample_models').insert({ ...row, published_by: notAdmin.id });
    expect(userInsert).not.toBeNull();
    // Even a platform admin cannot publish in someone else's name.
    const { error: wrongName } = await admin.client.from('sample_models').insert({ ...row, published_by: notAdmin.id });
    expect(wrongName).not.toBeNull();
    const result = await publishSampleModel(notAdmin.client, { source, slug }, notAdmin.id);
    expect(result.ok).toBe(false); // notAdmin cannot even read the admin's model, so nothing is published
    const { count } = await service.from('sample_models').select('id', { count: 'exact', head: true }).eq('slug', slug);
    expect(count).toBe(0);
  });

  it('lets a platform admin publish, as version 1 then version 2, scrubbed of people and links', async () => {
    const first = await publishSampleModel(admin.client, { source, slug }, admin.id);
    if (!first.ok) throw new Error(first.message);
    expect(first).toMatchObject({ version: 1, elements: 2, relationships: 1 });
    const second = await publishSampleModel(admin.client, { source, slug }, admin.id);
    if (!second.ok) throw new Error(second.message);
    expect(second.version).toBe(2);

    const { data } = await service.from('sample_models').select('payload').eq('slug', slug).eq('version', 2).single();
    expect(JSON.stringify(data?.payload)).not.toContain(admin.id);
  });

  it('never lets anyone, a platform admin included, change or remove a published version', async () => {
    const { data: before } = await service.from('sample_models').select('id, name').eq('slug', slug).eq('version', 1).single();
    const id = before?.id as string;
    const updated = await admin.client.from('sample_models').update({ name: 'Changed' }).eq('id', id).select('id');
    expect(updated.error !== null || updated.data.length === 0).toBe(true);
    const deleted = await admin.client.from('sample_models').delete().eq('id', id).select('id');
    expect(deleted.error !== null || deleted.data.length === 0).toBe(true);
    const { data: after } = await service.from('sample_models').select('name').eq('id', id).single();
    expect(after?.name).toBe(before?.name);
  });

  it('shows signed-in users from any organisation the newest version, and a signed-out caller nothing', async () => {
    const seen = (await listSampleModels(outsider.client)).filter((s) => s.slug === slug);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.version).toBe(2);
    const anon = createSupabaseClient(env);
    const { data } = await anon.from('sample_models').select('id').eq('slug', slug);
    expect(data ?? []).toHaveLength(0);
  });

  it('refuses a signed-in user from a different organisation copying into someone else’s organisation', async () => {
    const [sample] = (await listSampleModels(outsider.client)).filter((s) => s.slug === slug);
    if (!sample) throw new Error('sample missing');
    const result = await copySampleModel(outsider.client, { sample, orgId: newOrgId, name: 'Intruder', slug: 'intruder', authorId: outsider.id });
    expect(result.ok).toBe(false);
    expect(await getModelBySlug(newOwner.client, newOrgId, 'intruder')).toBeNull();
  });

  it('refuses a contributor of the new organisation, who may not create models', async () => {
    const contributor = await createSignedInUser('sample-contributor');
    const { error } = await newOwner.client.from('members').insert({ org_id: newOrgId, user_id: contributor.id, role: 'contributor', invited_by: newOwner.id });
    if (error) throw new Error(`add contributor: ${error.message}`);
    const [sample] = (await listSampleModels(contributor.client)).filter((s) => s.slug === slug);
    if (!sample) throw new Error('sample missing');
    const result = await copySampleModel(contributor.client, { sample, orgId: newOrgId, name: 'Contributor copy', slug: 'contributor-copy', authorId: contributor.id });
    expect(result.ok).toBe(false);
    expect(await getModelBySlug(newOwner.client, newOrgId, 'contributor-copy')).toBeNull();
  });

  it('lets an architect of the new organisation copy it: new ids, same content, original confidence, nothing foreign', async () => {
    const [sample] = (await listSampleModels(newArchitect.client)).filter((s) => s.slug === slug);
    if (!sample) throw new Error('sample missing');
    const result = await copySampleModel(newArchitect.client, { sample, orgId: newOrgId, name: sample.name, slug: 'my-sample', authorId: newArchitect.id });
    if (!result.ok) throw new Error(result.message);
    expect(result.copiedElements).toBe(2);
    expect(result.copiedRelationships).toBe(1);
    const copy = result.model;
    expect(copy.org_id).toBe(newOrgId);

    const copyMain = await getMainBranch(newOwner.client, copy.id);
    if (!copyMain) throw new Error('copy has no main');
    const { data: commit } = await service.from('commits').select('title, kind').eq('id', copyMain.head_commit_id).single();
    expect(commit).toMatchObject({ title: `Copied from the ${sample.name} sample`, kind: 'manual' });

    const { data: elements } = await service.from('elements_head').select('element_id, name').eq('commit_id', copyMain.head_commit_id);
    expect((elements ?? []).map((e) => e.name as string).sort()).toEqual(['Billing', 'Invoicer']);
    for (const e of elements ?? []) expect([systemId, capabilityId]).not.toContain(e.element_id);

    const { data: facts } = await service.from('facts').select('confidence, source_id, asserted_by').eq('commit_id', copyMain.head_commit_id).eq('attribute', 'name');
    expect((facts ?? []).map((f) => Number(f.confidence)).sort()).toEqual([0.7, 1]);
    for (const f of facts ?? []) expect(f.asserted_by).toBe(newArchitect.id);
    const { data: sources } = await service.from('sources').select('org_id, model_id, capture_job_id, user_id').in('id', (facts ?? []).map((f) => f.source_id as string));
    for (const s of sources ?? []) {
      expect(s.model_id).toBe(copy.id);
      expect(s.org_id).toBe(newOrgId);
      expect(s.capture_job_id).toBeNull();
      expect(s.user_id).toBeNull();
    }

    const { data: aliases } = await service.from('aliases').select('alias_value, org_id').eq('model_id', copy.id);
    expect(aliases ?? []).toEqual([{ alias_value: 'INV-1', org_id: newOrgId }]);
  });
});

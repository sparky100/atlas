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
import { getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { createElementLink, deleteElementLink, listElementLinks, updateElementLink } from './elementLinks';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';

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


describe('element document links (ADR-030) against a real local Supabase', () => {
  let architect: TestUser;
  let contributor: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let modelId: string;
  const systemId = randomUUID();

  beforeAll(async () => {
    architect = await createSignedInUser('links-architect');
    contributor = await createSignedInUser('links-contributor');
    viewer = await createSignedInUser('links-viewer');
    orgId = randomUUID();
    await createOrganisation(architect.client, { id: orgId, name: 'Links Test Org', slug: `links-${orgId.slice(0, 8)}`, createdBy: architect.id });
    const { error: memberError } = await architect.client.from('members').insert([
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: architect.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: architect.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);
    modelId = randomUUID();
    await createModel(architect.client, { id: modelId, orgId, name: 'Links Test Model', slug: `links-model-${modelId.slice(0, 8)}`, createdBy: architect.id });
    const source = await getOrCreateManualSource(architect.client, { id: randomUUID(), orgId, modelId, userId: architect.id });
    const branch = await getMainBranch(architect.client, modelId);
    if (!branch) throw new Error('main branch missing');
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
          { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Payroll', parentId: null, attributes: { isExternal: false, lifecycleStatus: 'active', criticality: 'high' }, sourceId: source.id, confidence: 0.8, effectiveDate: '2020-01-01' },
        ],
      },
    });
    if (!seed.ok) throw new Error(`seed: ${seed.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('round-trips: an architect adds, edits and removes a link; a web link and a reference both read back as written', async () => {
    const link = await createElementLink(architect.client, { id: randomUUID(), orgId, modelId, elementId: systemId, label: 'Solution design', pointer: 'https://example.atlassian.net/wiki/spaces/A/pages/1', addedBy: architect.id });
    const ref = await createElementLink(architect.client, { id: randomUUID(), orgId, modelId, elementId: systemId, label: 'Business case', pointer: 'SharePoint > Business cases', addedBy: architect.id });
    expect(link.kind).toBe('link');
    expect(ref.kind).toBe('reference');

    const listed = await listElementLinks(architect.client, modelId, systemId);
    expect(listed.map((l) => [l.label, l.pointer, l.kind, l.added_by])).toEqual([
      ['Solution design', 'https://example.atlassian.net/wiki/spaces/A/pages/1', 'link', architect.id],
      ['Business case', 'SharePoint > Business cases', 'reference', architect.id],
    ]);

    const edited = await updateElementLink(architect.client, { id: ref.id, label: 'Business case v2', pointer: 'https://example.sharepoint.com/cases', updatedBy: architect.id, now: new Date().toISOString() });
    expect(edited).toMatchObject({ label: 'Business case v2', kind: 'link', added_by: architect.id, updated_by: architect.id });

    await deleteElementLink(architect.client, link.id);
    expect((await listElementLinks(architect.client, modelId, systemId)).map((l) => l.id)).toEqual([ref.id]);
  });

  it('every member can read links; a contributor and a viewer cannot add, edit or remove one', async () => {
    const existing = (await listElementLinks(architect.client, modelId, systemId))[0];
    if (!existing) throw new Error('expected a link');
    for (const user of [contributor, viewer]) {
      expect((await listElementLinks(user.client, modelId, systemId)).length).toBe(1);
      await expect(createElementLink(user.client, { id: randomUUID(), orgId, modelId, elementId: systemId, label: 'x', pointer: 'x', addedBy: user.id })).rejects.toThrow();
      await updateElementLink(user.client, { id: existing.id, label: 'hijack', pointer: 'x', updatedBy: user.id, now: new Date().toISOString() }).catch(() => undefined);
      await deleteElementLink(user.client, existing.id);
    }
    const after = await listElementLinks(architect.client, modelId, systemId);
    expect(after).toHaveLength(1);
    expect(after[0]?.label).not.toBe('hijack');
  });

  it('refuses a link to an element that is not in the model, and a non-http pointer stored as a link', async () => {
    await expect(createElementLink(architect.client, { id: randomUUID(), orgId, modelId, elementId: randomUUID(), label: 'x', pointer: 'x', addedBy: architect.id })).rejects.toThrow(/no element/);
    const { error } = await architect.client.from('element_links').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, element_id: systemId, label: 'x', pointer: 'ftp://x/y', kind: 'link', added_by: architect.id });
    expect(error).not.toBeNull();
  });
});

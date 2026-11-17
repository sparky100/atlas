/**
 * ADR-034 "Starter sets" against a real local Supabase with real RLS:
 *  - only a platform admin can write `principle_sets`, never in someone else's
 *    name, and nobody can change or remove a published version;
 *  - a signed-out caller reads nothing, any signed-in user reads the sets;
 *  - an owner or architect adds ticked principles to their OWN model (with the
 *    set and version recorded), while a contributor, a viewer and a signed-in
 *    user from a different organisation cannot;
 *  - nothing is added unless ticked, adding twice changes nothing, and a copy
 *    is the organisation's own: editing it never touches the set.
 * There is no new database function, so there is no new advisor finding.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';
import { createPrinciple, listPrinciplesForModel, updatePrinciple } from './principles';
import { addPrinciplesFromSet, listPrincipleSets, publishPrincipleSet, readPrincipleSet } from './principleSets';

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

describe('principle sets (ADR-034) against a real local Supabase', () => {
  let admin: TestUser;
  let notAdmin: TestUser;
  let owner: TestUser;
  let architect: TestUser;
  let contributor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let adminOrgId: string;
  let adminModelId: string;
  let orgId: string;
  let modelId: string;
  const slug = `set-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    admin = await createSignedInUser('pset-admin');
    notAdmin = await createSignedInUser('pset-not-admin');
    owner = await createSignedInUser('pset-owner');
    architect = await createSignedInUser('pset-architect');
    contributor = await createSignedInUser('pset-contributor');
    viewer = await createSignedInUser('pset-viewer');
    outsider = await createSignedInUser('pset-outsider');
    const { error: adminError } = await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null });
    if (adminError) throw new Error(`seed platform_admins: ${adminError.message}`);

    adminOrgId = randomUUID();
    await createOrganisation(admin.client, { id: adminOrgId, name: 'Set Source Org', slug: `pset-src-${adminOrgId.slice(0, 8)}`, createdBy: admin.id });
    adminModelId = randomUUID();
    await createModel(admin.client, { id: adminModelId, orgId: adminOrgId, name: 'Set Source Model', slug: `pset-src-model-${adminModelId.slice(0, 8)}`, createdBy: admin.id });
    for (const [title, statement] of [['Reuse before buying', 'Look at what we run first.'], ['Start from the capability', 'Every system supports a capability.']] as const) {
      await createPrinciple(admin.client, { id: randomUUID(), orgId: adminOrgId, modelId: adminModelId, title, statement, why: 'Because.', createdBy: admin.id });
    }

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Set Target Org', slug: `pset-tgt-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      { org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id },
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);
    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Set Target Model', slug: `pset-tgt-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    await createOrganisation(outsider.client, { id: randomUUID(), name: 'Set Outsider Org', slug: `pset-out-${randomUUID().slice(0, 8)}`, createdBy: outsider.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
    await service.from('organisations').delete().eq('id', adminOrgId);
    await service.from('principle_sets').delete().eq('slug', slug);
    await service.from('platform_admins').delete().eq('user_id', admin.id);
  });

  it('lets only a platform admin write the table, and never in another person’s name', async () => {
    const row = { slug, version: 99, name: 'Sneaky', payload: { principles: [{ title: 'x', statement: 'y', why: '' }] } };
    expect((await notAdmin.client.from('principle_sets').insert({ ...row, published_by: notAdmin.id })).error).not.toBeNull();
    expect((await admin.client.from('principle_sets').insert({ ...row, published_by: notAdmin.id })).error).not.toBeNull();
    const result = await publishPrincipleSet(notAdmin.client, { modelId: adminModelId, slug, name: 'Nope', description: '' }, notAdmin.id);
    expect(result.ok).toBe(false);
    const { count } = await service.from('principle_sets').select('id', { count: 'exact', head: true }).eq('slug', slug);
    expect(count).toBe(0);
  });

  it('publishes the active principles as version 1 then version 2, and no one can change or remove a version', async () => {
    const first = await publishPrincipleSet(admin.client, { modelId: adminModelId, slug, name: 'Core principles', description: 'A starting point.' }, admin.id);
    expect(first).toEqual({ ok: true, version: 1, principles: 2 });
    const second = await publishPrincipleSet(admin.client, { modelId: adminModelId, slug, name: 'Core principles', description: 'A starting point.' }, admin.id);
    expect(second).toMatchObject({ ok: true, version: 2 });

    const listed = (await listPrincipleSets(admin.client)).filter((s) => s.slug === slug);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.version).toBe(2);

    const { data: updated } = await admin.client.from('principle_sets').update({ name: 'Changed' }).eq('slug', slug).select('id');
    expect(updated ?? []).toHaveLength(0);
    const { data: removed } = await admin.client.from('principle_sets').delete().eq('slug', slug).select('id');
    expect(removed ?? []).toHaveLength(0);
    const { count } = await service.from('principle_sets').select('id', { count: 'exact', head: true }).eq('slug', slug);
    expect(count).toBe(2);
  });

  it('is readable by any signed-in user and by no one who is signed out', async () => {
    expect((await listPrincipleSets(outsider.client)).some((s) => s.slug === slug)).toBe(true);
    const anon = createSupabaseClient(env);
    const { data } = await anon.from('principle_sets').select('id').eq('slug', slug);
    expect(data ?? []).toHaveLength(0);
  });

  it('an owner adds only the principles they tick, recording the set and version; nothing is added by default', async () => {
    const [set] = (await listPrincipleSets(owner.client)).filter((s) => s.slug === slug);
    if (!set) throw new Error('set missing');
    const payload = await readPrincipleSet(owner.client, set.id);
    expect(payload.principles.map((p) => p.title)).toEqual(['Reuse before buying', 'Start from the capability']);

    expect(await addPrinciplesFromSet(owner.client, { set, picked: [], orgId, modelId, createdBy: owner.id })).toEqual({ ok: true, added: 0, alreadyThere: [] });
    expect(await listPrinciplesForModel(owner.client, modelId)).toHaveLength(0);

    const added = await addPrinciplesFromSet(owner.client, { set, picked: [1], orgId, modelId, createdBy: owner.id });
    expect(added).toEqual({ ok: true, added: 1, alreadyThere: [] });
    const [row] = await listPrinciplesForModel(owner.client, modelId);
    expect(row).toMatchObject({ title: 'Start from the capability', status: 'active', from_set_slug: slug, from_set_name: 'Core principles', from_set_version: 2 });

    // Adding the same one again changes nothing.
    expect(await addPrinciplesFromSet(owner.client, { set, picked: [0, 1], orgId, modelId, createdBy: owner.id })).toEqual({ ok: true, added: 1, alreadyThere: ['Start from the capability'] });
    expect(await listPrinciplesForModel(owner.client, modelId)).toHaveLength(2);
  });

  it('the copy is the organisation’s own: editing it leaves the set alone, and where it began cannot be changed', async () => {
    const [copy] = (await listPrinciplesForModel(owner.client, modelId)).filter((p) => p.title === 'Start from the capability');
    if (!copy) throw new Error('copy missing');
    await updatePrinciple(owner.client, copy.id, { statement: 'Our own wording.' });
    const { data: set } = await service.from('principle_sets').select('payload').eq('slug', slug).eq('version', 2).single();
    expect(JSON.stringify(set)).toContain('Every system supports a capability.');
    const { data: moved } = await owner.client.from('principles').update({ from_set_version: 1 }).eq('id', copy.id).select('id');
    expect(moved ?? []).toHaveLength(0);
  });

  it('an architect can add; a contributor, a viewer and a signed-in user from a different organisation cannot', async () => {
    const [set] = (await listPrincipleSets(owner.client)).filter((s) => s.slug === slug);
    if (!set) throw new Error('set missing');
    const otherModel = randomUUID();
    await createModel(owner.client, { id: otherModel, orgId, name: 'Second', slug: `pset-second-${otherModel.slice(0, 8)}`, createdBy: owner.id });
    expect((await addPrinciplesFromSet(architect.client, { set, picked: [0], orgId, modelId: otherModel, createdBy: architect.id })).ok).toBe(true);
    for (const who of [contributor, viewer, outsider]) {
      const result = await addPrinciplesFromSet(who.client, { set, picked: [1], orgId, modelId: otherModel, createdBy: who.id });
      expect(result.ok).toBe(false);
    }
    expect(await listPrinciplesForModel(owner.client, otherModel)).toHaveLength(1);
  });
});

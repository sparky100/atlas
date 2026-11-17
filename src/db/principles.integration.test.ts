/**
 * ADR-034 (architecture principles) against a real local Supabase with real
 * RLS: `principles` and `decision_principles`, who may write them, retire not
 * delete, a departure needs a reason, only an active principle from the
 * decision's own model, read-only once the decision is decided, a signed-in
 * user from a different organisation, and `atlas.delete_model` clearing both.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { cancelDecision, createDecision } from './decisions';
import { loadEnv } from './env';
import { archiveModel, createModel, deleteModel } from './models';
import { createOrganisation } from './organisations';
import { createPrinciple, linkPrincipleToDecision, listPrincipleLinksForPrinciples, listPrinciplesForDecision, listPrinciplesForModel, unlinkPrincipleFromDecision, updatePrinciple } from './principles';

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

describe('principles (ADR-034) against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let contributor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let modelId: string;
  let otherModelId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('principles-owner');
    architect = await createSignedInUser('principles-architect');
    contributor = await createSignedInUser('principles-contributor');
    viewer = await createSignedInUser('principles-viewer');
    outsider = await createSignedInUser('principles-outsider');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Principles Test Org', slug: `principles-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      { org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id },
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);
    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Principles Model', slug: `principles-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    otherModelId = randomUUID();
    await createModel(owner.client, { id: otherModelId, orgId, name: 'Other Model', slug: `principles-other-${otherModelId.slice(0, 8)}`, createdBy: owner.id });

    otherOrgId = randomUUID();
    await createOrganisation(outsider.client, { id: otherOrgId, name: 'Elsewhere Org', slug: `elsewhere-${otherOrgId.slice(0, 8)}`, createdBy: outsider.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
    await service.from('organisations').delete().eq('id', otherOrgId);
  });

  const newPrinciple = (by: TestUser, model = modelId) =>
    createPrinciple(by.client, { id: randomUUID(), orgId, modelId: model, title: `Principle ${randomUUID().slice(0, 8)}`, statement: 'Every system supports a capability.', why: 'Avoids waste.', createdBy: by.id });
  const newDecision = (by: TestUser, model = modelId) => createDecision(by.client, { id: randomUUID(), orgId, modelId: model, title: `Decision ${randomUUID().slice(0, 8)}`, statement: 'Context', ownerId: by.id, createdBy: by.id });

  describe('who can write a principle', () => {
    it('an owner and an architect create one; members read it', async () => {
      const a = await newPrinciple(owner);
      const b = await newPrinciple(architect);
      expect(a.status).toBe('active');
      expect(a.retired_at).toBeNull();
      const seenByViewer = await listPrinciplesForModel(viewer.client, modelId);
      expect(seenByViewer.map((p) => p.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    });

    it('a contributor and a viewer cannot create one', async () => {
      await expect(newPrinciple(contributor)).rejects.toThrow();
      await expect(newPrinciple(viewer)).rejects.toThrow();
    });

    it('a signed-in user from a different organisation can neither read nor create one, nor edit it', async () => {
      const p = await newPrinciple(owner);
      expect((await listPrinciplesForModel(outsider.client, modelId)).length).toBe(0);
      await expect(createPrinciple(outsider.client, { id: randomUUID(), orgId, modelId, title: 'Intruder', statement: 'x', why: '', createdBy: outsider.id })).rejects.toThrow();
      await expect(updatePrinciple(outsider.client, p.id, { title: 'Hijacked' })).rejects.toThrow();
    });

    it('cannot be inserted already retired, or with a blank title or statement', async () => {
      const base = { id: randomUUID(), org_id: orgId, model_id: modelId, title: 'T', statement: 'S', why: '', created_by: owner.id };
      expect((await owner.client.from('principles').insert({ ...base, status: 'retired', retired_by: owner.id, retired_at: new Date().toISOString() })).error).not.toBeNull();
      expect((await owner.client.from('principles').insert({ ...base, id: randomUUID(), title: '   ' })).error).not.toBeNull();
      expect((await owner.client.from('principles').insert({ ...base, id: randomUUID(), statement: '' })).error).not.toBeNull();
    });
  });

  describe('edit, retire, never delete', () => {
    it('an architect edits the wording; a contributor cannot', async () => {
      const p = await newPrinciple(owner);
      await updatePrinciple(architect.client, p.id, { statement: 'Every system supports at least one capability.' });
      await expect(updatePrinciple(contributor.client, p.id, { title: 'Nope' })).rejects.toThrow();
      const [after] = (await listPrinciplesForModel(owner.client, modelId)).filter((x) => x.id === p.id);
      expect(after?.statement).toBe('Every system supports at least one capability.');
    });

    it('retiring stamps who and when; the wording is then fixed until it is made active again', async () => {
      const p = await newPrinciple(owner);
      await updatePrinciple(architect.client, p.id, { status: 'retired' });
      let [row] = (await listPrinciplesForModel(owner.client, modelId)).filter((x) => x.id === p.id);
      expect(row?.status).toBe('retired');
      expect(row?.retired_by).toBe(architect.id);
      expect(row?.retired_at).not.toBeNull();
      await expect(updatePrinciple(owner.client, p.id, { title: 'Reworded' })).rejects.toThrow();
      await updatePrinciple(owner.client, p.id, { status: 'active' });
      [row] = (await listPrinciplesForModel(owner.client, modelId)).filter((x) => x.id === p.id);
      expect(row?.status).toBe('active');
      expect(row?.retired_at).toBeNull();
      await updatePrinciple(owner.client, p.id, { title: 'Reworded' });
    });

    it('nobody can delete a principle', async () => {
      const p = await newPrinciple(owner);
      const { data } = await owner.client.from('principles').delete().eq('id', p.id).select('id');
      expect(data ?? []).toEqual([]);
      expect((await listPrinciplesForModel(owner.client, modelId)).some((x) => x.id === p.id)).toBe(true);
    });

    it('the retired stamps cannot be written by a client', async () => {
      const p = await newPrinciple(owner);
      const { error } = await owner.client.from('principles').update({ retired_by: owner.id }).eq('id', p.id);
      expect(error).not.toBeNull();
    });
  });

  describe('linking a decision to a principle', () => {
    it('a contributor links one as followed, and one as departed with a reason; a departure without a reason is refused', async () => {
      const d = await newDecision(contributor);
      const follows = await newPrinciple(owner);
      const departs = await newPrinciple(owner);
      await linkPrincipleToDecision(contributor.client, { decisionId: d.id, principleId: follows.id, stance: 'follows', reason: '', createdBy: contributor.id });
      await expect(linkPrincipleToDecision(contributor.client, { decisionId: d.id, principleId: departs.id, stance: 'departs', reason: '   ', createdBy: contributor.id })).rejects.toThrow();
      await linkPrincipleToDecision(contributor.client, { decisionId: d.id, principleId: departs.id, stance: 'departs', reason: 'The vendor product does not fit.', createdBy: contributor.id });
      const links = await listPrinciplesForDecision(viewer.client, d.id);
      expect(links.map((l) => [l.principle_id, l.stance]).sort()).toEqual([[follows.id, 'follows'], [departs.id, 'departs']].sort());
      const onPage = await listPrincipleLinksForPrinciples(viewer.client, [follows.id, departs.id]);
      expect(onPage.length).toBe(2);
    });

    it('a viewer cannot link, and an outsider cannot see links', async () => {
      const d = await newDecision(owner);
      const p = await newPrinciple(owner);
      await expect(linkPrincipleToDecision(viewer.client, { decisionId: d.id, principleId: p.id, stance: 'follows', reason: '', createdBy: viewer.id })).rejects.toThrow();
      await linkPrincipleToDecision(owner.client, { decisionId: d.id, principleId: p.id, stance: 'follows', reason: '', createdBy: owner.id });
      expect(await listPrinciplesForDecision(outsider.client, d.id)).toEqual([]);
    });

    it('refuses a retired principle, and one from another model', async () => {
      const d = await newDecision(owner);
      const retired = await newPrinciple(owner);
      await updatePrinciple(owner.client, retired.id, { status: 'retired' });
      await expect(linkPrincipleToDecision(owner.client, { decisionId: d.id, principleId: retired.id, stance: 'follows', reason: '', createdBy: owner.id })).rejects.toThrow();
      const elsewhere = await newPrinciple(owner, otherModelId);
      await expect(linkPrincipleToDecision(owner.client, { decisionId: d.id, principleId: elsewhere.id, stance: 'follows', reason: '', createdBy: owner.id })).rejects.toThrow();
      await expect(linkPrincipleToDecision(owner.client, { decisionId: d.id, principleId: randomUUID(), stance: 'follows', reason: '', createdBy: owner.id })).rejects.toThrow();
    });

    it('a link can be taken back while the decision is proposed, and is fixed once it is closed', async () => {
      const d = await newDecision(owner);
      const p = await newPrinciple(owner);
      const q = await newPrinciple(owner);
      await linkPrincipleToDecision(owner.client, { decisionId: d.id, principleId: p.id, stance: 'follows', reason: '', createdBy: owner.id });
      await linkPrincipleToDecision(owner.client, { decisionId: d.id, principleId: q.id, stance: 'follows', reason: '', createdBy: owner.id });
      await unlinkPrincipleFromDecision(owner.client, d.id, p.id);
      await cancelDecision(owner.client, d.id, 'No longer needed');
      await expect(unlinkPrincipleFromDecision(owner.client, d.id, q.id)).rejects.toThrow();
      const r = await newPrinciple(owner);
      await expect(linkPrincipleToDecision(owner.client, { decisionId: d.id, principleId: r.id, stance: 'follows', reason: '', createdBy: owner.id })).rejects.toThrow();
      expect((await listPrinciplesForDecision(owner.client, d.id)).map((l) => l.principle_id)).toEqual([q.id]);
    });
  });

  describe('delete_model', () => {
    it('clears principles and their links so an archived model can be deleted', async () => {
      const throwaway = randomUUID();
      await createModel(owner.client, { id: throwaway, orgId, name: 'Throwaway', slug: `throwaway-${throwaway.slice(0, 8)}`, createdBy: owner.id });
      const d = await newDecision(owner, throwaway);
      const p = await newPrinciple(owner, throwaway);
      await linkPrincipleToDecision(owner.client, { decisionId: d.id, principleId: p.id, stance: 'follows', reason: '', createdBy: owner.id });
      await archiveModel(owner.client, throwaway);
      await deleteModel(owner.client, throwaway);
      const { data: principles } = await service.from('principles').select('id').eq('model_id', throwaway);
      const { data: links } = await service.from('decision_principles').select('decision_id').eq('principle_id', p.id);
      expect(principles ?? []).toEqual([]);
      expect(links ?? []).toEqual([]);
    });
  });
});

/**
 * ADR-035 (goals) against a real local Supabase with real RLS: `goals` and
 * `goal_capabilities`, who may write them, retire not delete, links only to a
 * capability in the goal's own model, links only while the goal is active, a
 * signed-in user from a different organisation, and `atlas.delete_model`
 * clearing both.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { createGoal, linkCapabilityToGoal, listGoalLinksForGoals, listGoalsForModel, unlinkCapabilityFromGoal, updateGoal } from './goals';
import { archiveModel, createModel, deleteModel } from './models';
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

async function seedElement(owner: TestUser, orgId: string, modelId: string, elementType: 'capability' | 'system', name: string): Promise<string> {
  const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
  const main = await getMainBranch(owner.client, modelId);
  if (!main?.head_commit_id) throw new Error('main branch not found');
  const elementId = randomUUID();
  const base = { id: randomUUID(), elementId, name, parentId: null, sourceId: source.id, confidence: 1 };
  const delta: Delta = elementType === 'system' ? { kind: 'element.create', elementType, attributes: { lifecycleStatus: 'active', isExternal: false }, ...base } : { kind: 'element.create', elementType, attributes: {}, ...base };
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `seed ${name}`,
    body: null,
    deltas: [delta],
  };
  const result = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!result.ok) throw new Error(`seedElement: ${result.message}`);
  return elementId;
}

describe('goals (ADR-035) against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let contributor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let modelId: string;
  let otherModelId: string;
  let otherOrgId: string;
  let capabilityId: string;
  let secondCapabilityId: string;
  let systemId: string;
  let otherModelCapabilityId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('goals-owner');
    architect = await createSignedInUser('goals-architect');
    contributor = await createSignedInUser('goals-contributor');
    viewer = await createSignedInUser('goals-viewer');
    outsider = await createSignedInUser('goals-outsider');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Goals Test Org', slug: `goals-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      { org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id },
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);
    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Goals Model', slug: `goals-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    otherModelId = randomUUID();
    await createModel(owner.client, { id: otherModelId, orgId, name: 'Other Model', slug: `goals-other-${otherModelId.slice(0, 8)}`, createdBy: owner.id });
    capabilityId = await seedElement(owner, orgId, modelId, 'capability', 'Customer Onboarding');
    secondCapabilityId = await seedElement(owner, orgId, modelId, 'capability', 'Metering');
    systemId = await seedElement(owner, orgId, modelId, 'system', 'CRM');
    otherModelCapabilityId = await seedElement(owner, orgId, otherModelId, 'capability', 'Elsewhere');

    otherOrgId = randomUUID();
    await createOrganisation(outsider.client, { id: otherOrgId, name: 'Elsewhere Org', slug: `elsewhere-${otherOrgId.slice(0, 8)}`, createdBy: outsider.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
    await service.from('organisations').delete().eq('id', otherOrgId);
  });

  const newGoal = (by: TestUser, model = modelId) => createGoal(by.client, { id: randomUUID(), orgId, modelId: model, title: `Goal ${randomUUID().slice(0, 8)}`, statement: 'Connect new customers within ten days.', whyNow: 'Regulator deadline.', createdBy: by.id });

  describe('who can write a goal', () => {
    it('an owner and an architect create one; every member reads it', async () => {
      const a = await newGoal(owner);
      const b = await newGoal(architect);
      expect(a.status).toBe('active');
      expect(a.retired_at).toBeNull();
      const seen = await listGoalsForModel(viewer.client, modelId);
      expect(seen.map((g) => g.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    });

    it('a contributor and a viewer cannot create one', async () => {
      await expect(newGoal(contributor)).rejects.toThrow();
      await expect(newGoal(viewer)).rejects.toThrow();
    });

    it('a signed-in user from a different organisation can neither read, create, edit nor link', async () => {
      const g = await newGoal(owner);
      await linkCapabilityToGoal(owner.client, { goalId: g.id, capabilityId, createdBy: owner.id });
      expect((await listGoalsForModel(outsider.client, modelId)).length).toBe(0);
      expect(await listGoalLinksForGoals(outsider.client, [g.id])).toEqual([]);
      await expect(createGoal(outsider.client, { id: randomUUID(), orgId, modelId, title: 'Intruder', statement: 'x', whyNow: '', createdBy: outsider.id })).rejects.toThrow();
      await expect(updateGoal(outsider.client, g.id, { title: 'Hijacked' })).rejects.toThrow();
      await expect(linkCapabilityToGoal(outsider.client, { goalId: g.id, capabilityId: secondCapabilityId, createdBy: outsider.id })).rejects.toThrow();
      await expect(unlinkCapabilityFromGoal(outsider.client, g.id, capabilityId)).rejects.toThrow();
    });

    it('cannot be inserted already retired, or with a blank title or statement', async () => {
      const base = { id: randomUUID(), org_id: orgId, model_id: modelId, title: 'T', statement: 'S', why_now: '', created_by: owner.id };
      expect((await owner.client.from('goals').insert({ ...base, status: 'retired', retired_by: owner.id, retired_at: new Date().toISOString() })).error).not.toBeNull();
      expect((await owner.client.from('goals').insert({ ...base, id: randomUUID(), title: '   ' })).error).not.toBeNull();
      expect((await owner.client.from('goals').insert({ ...base, id: randomUUID(), statement: '' })).error).not.toBeNull();
    });
  });

  describe('edit, retire, never delete', () => {
    it('an architect edits the wording; a contributor cannot', async () => {
      const g = await newGoal(owner);
      await updateGoal(architect.client, g.id, { statement: 'Connect new customers within seven days.' });
      await expect(updateGoal(contributor.client, g.id, { title: 'Nope' })).rejects.toThrow();
      const [after] = (await listGoalsForModel(owner.client, modelId)).filter((x) => x.id === g.id);
      expect(after?.statement).toBe('Connect new customers within seven days.');
    });

    it('retiring stamps who and when; the wording is then fixed until it is made active again', async () => {
      const g = await newGoal(owner);
      await updateGoal(architect.client, g.id, { status: 'retired' });
      let [row] = (await listGoalsForModel(owner.client, modelId)).filter((x) => x.id === g.id);
      expect(row?.status).toBe('retired');
      expect(row?.retired_by).toBe(architect.id);
      expect(row?.retired_at).not.toBeNull();
      await expect(updateGoal(owner.client, g.id, { title: 'Reworded' })).rejects.toThrow();
      await updateGoal(owner.client, g.id, { status: 'active' });
      [row] = (await listGoalsForModel(owner.client, modelId)).filter((x) => x.id === g.id);
      expect(row?.status).toBe('active');
      expect(row?.retired_at).toBeNull();
      await updateGoal(owner.client, g.id, { title: 'Reworded' });
    });

    it('nobody can delete a goal, and the retired stamps cannot be written by a client', async () => {
      const g = await newGoal(owner);
      const { data } = await owner.client.from('goals').delete().eq('id', g.id).select('id');
      expect(data ?? []).toEqual([]);
      expect((await listGoalsForModel(owner.client, modelId)).some((x) => x.id === g.id)).toBe(true);
      const { error } = await owner.client.from('goals').update({ retired_by: owner.id }).eq('id', g.id);
      expect(error).not.toBeNull();
    });
  });

  describe('linking a goal to capabilities', () => {
    it('an architect links two capabilities and takes one back; members read the links', async () => {
      const g = await newGoal(owner);
      await linkCapabilityToGoal(architect.client, { goalId: g.id, capabilityId, createdBy: architect.id });
      await linkCapabilityToGoal(architect.client, { goalId: g.id, capabilityId: secondCapabilityId, createdBy: architect.id });
      expect((await listGoalLinksForGoals(viewer.client, [g.id])).map((l) => l.capability_id).sort()).toEqual([capabilityId, secondCapabilityId].sort());
      await unlinkCapabilityFromGoal(architect.client, g.id, secondCapabilityId);
      expect((await listGoalLinksForGoals(viewer.client, [g.id])).map((l) => l.capability_id)).toEqual([capabilityId]);
    });

    it('a contributor and a viewer cannot link or unlink', async () => {
      const g = await newGoal(owner);
      await linkCapabilityToGoal(owner.client, { goalId: g.id, capabilityId, createdBy: owner.id });
      await expect(linkCapabilityToGoal(contributor.client, { goalId: g.id, capabilityId: secondCapabilityId, createdBy: contributor.id })).rejects.toThrow();
      await expect(linkCapabilityToGoal(viewer.client, { goalId: g.id, capabilityId: secondCapabilityId, createdBy: viewer.id })).rejects.toThrow();
      await expect(unlinkCapabilityFromGoal(contributor.client, g.id, capabilityId)).rejects.toThrow();
    });

    it('refuses a system, an unknown id, and a capability from another model', async () => {
      const g = await newGoal(owner);
      await expect(linkCapabilityToGoal(owner.client, { goalId: g.id, capabilityId: systemId, createdBy: owner.id })).rejects.toThrow();
      await expect(linkCapabilityToGoal(owner.client, { goalId: g.id, capabilityId: randomUUID(), createdBy: owner.id })).rejects.toThrow();
      await expect(linkCapabilityToGoal(owner.client, { goalId: g.id, capabilityId: otherModelCapabilityId, createdBy: owner.id })).rejects.toThrow();
    });

    it('links are fixed while the goal is retired, and come back when it is made active again', async () => {
      const g = await newGoal(owner);
      await linkCapabilityToGoal(owner.client, { goalId: g.id, capabilityId, createdBy: owner.id });
      await updateGoal(owner.client, g.id, { status: 'retired' });
      await expect(linkCapabilityToGoal(owner.client, { goalId: g.id, capabilityId: secondCapabilityId, createdBy: owner.id })).rejects.toThrow();
      await expect(unlinkCapabilityFromGoal(owner.client, g.id, capabilityId)).rejects.toThrow();
      expect((await listGoalLinksForGoals(owner.client, [g.id])).length).toBe(1);
      await updateGoal(owner.client, g.id, { status: 'active' });
      await unlinkCapabilityFromGoal(owner.client, g.id, capabilityId);
    });
  });

  describe('delete_model', () => {
    it('clears goals and their links so an archived model can be deleted', async () => {
      const throwaway = randomUUID();
      await createModel(owner.client, { id: throwaway, orgId, name: 'Throwaway', slug: `throwaway-${throwaway.slice(0, 8)}`, createdBy: owner.id });
      const cap = await seedElement(owner, orgId, throwaway, 'capability', 'Doomed');
      const g = await newGoal(owner, throwaway);
      await linkCapabilityToGoal(owner.client, { goalId: g.id, capabilityId: cap, createdBy: owner.id });
      await archiveModel(owner.client, throwaway);
      await deleteModel(owner.client, throwaway);
      const { data: goals } = await service.from('goals').select('id').eq('model_id', throwaway);
      const { data: links } = await service.from('goal_capabilities').select('goal_id').eq('goal_id', g.id);
      expect(goals ?? []).toEqual([]);
      expect(links ?? []).toEqual([]);
    });
  });
});

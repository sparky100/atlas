/**
 * Stale-data threshold and owner nudges (20261113040000_stale_threshold_and_nudges.sql)
 * against a real local Supabase with real RLS:
 *
 * - the organisation's threshold defaults to 12 months, an owner or architect
 *   can change it (1–60), nobody else can;
 * - `atlas.stale_elements` finds every element type with a value older than
 *   the threshold, ignores the `$exists` fact (so "Still accurate" clears an
 *   element);
 * - `atlas.stale_nudge_recipients` sends an element to its business/technical
 *   owner (the member behind the owning actor) and, when nobody who is a
 *   member owns it, to the architects instead;
 * - the service-role-only functions are not callable by a signed-in user;
 * - `stale_nudges` is readable by an architect, not by a contributor, and not
 *   writable by anyone but the service role, and one row per person per model
 *   per day is the claim against double sends.
 *
 * The email itself (the `staleNudge` mode of the send-review-email edge
 * function) needs a Resend key and is not exercised here.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { commitAttestation } from '../ui/elements/attestation';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation, getStaleAfterMonthsForModel, setStaleThreshold } from './organisations';
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

const TODAY = new Date().toISOString().slice(0, 10);
const LONG_AGO = '2020-01-01';

describe('stale-data threshold and nudges against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let contributor: TestUser;
  let orgId: string;
  let modelId: string;
  const ownedSystemId = randomUUID();
  const unownedSystemId = randomUUID();
  const freshSystemId = randomUUID();
  const staleCapabilityId = randomUUID();
  const ownerActorId = randomUUID();

  beforeAll(async () => {
    owner = await createSignedInUser('stale-owner');
    architect = await createSignedInUser('stale-architect');
    contributor = await createSignedInUser('stale-contributor');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Stale Test Org', slug: `stale-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      { org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id },
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Stale Test Model', slug: `stale-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');

    const base = { sourceId: source.id, confidence: 0.8 };
    const deltas: Delta[] = [
      { kind: 'element.create', id: randomUUID(), elementId: ownedSystemId, elementType: 'system', name: 'Owned old system', parentId: null, attributes: { isExternal: false, lifecycleStatus: 'active' }, effectiveDate: LONG_AGO, ...base },
      { kind: 'element.create', id: randomUUID(), elementId: unownedSystemId, elementType: 'system', name: 'Unowned old system', parentId: null, attributes: { isExternal: false, lifecycleStatus: 'active' }, effectiveDate: LONG_AGO, ...base },
      { kind: 'element.create', id: randomUUID(), elementId: freshSystemId, elementType: 'system', name: 'Fresh system', parentId: null, attributes: { isExternal: false, lifecycleStatus: 'active' }, effectiveDate: TODAY, ...base },
      { kind: 'element.create', id: randomUUID(), elementId: staleCapabilityId, elementType: 'capability', name: 'Old capability', parentId: null, attributes: {}, effectiveDate: LONG_AGO, ...base },
      // The actor stands for the organisation's owner member, so the owns edge below resolves to a person.
      { kind: 'element.create', id: randomUUID(), elementId: ownerActorId, elementType: 'actor', name: 'Ada', parentId: null, attributes: { subtype: 'person', isExternal: false, memberId: owner.id }, effectiveDate: TODAY, ...base },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: ownerActorId, toElementId: ownedSystemId, attributes: { role: 'business' }, ...base },
    ];
    const seed = await commitToBranch(owner.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed old and fresh elements', body: null, deltas },
    });
    if (!seed.ok) throw new Error(`seed: ${seed.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  async function staleIds(): Promise<string[]> {
    const { data, error } = await service.schema('atlas').rpc('stale_elements', { p_model_id: modelId });
    if (error) throw new Error(error.message);
    return ((data ?? []) as { element_id: string }[]).map((r) => r.element_id).sort();
  }

  it('defaults to 12 months; an owner and an architect can change it, a contributor cannot, and 0 or 61 is refused', async () => {
    expect(await getStaleAfterMonthsForModel(owner.client, modelId)).toBe(12);
    expect((await setStaleThreshold(architect.client, orgId, 18)).stale_after_months).toBe(18);
    expect((await setStaleThreshold(owner.client, orgId, 12)).stale_after_months).toBe(12);
    await expect(setStaleThreshold(contributor.client, orgId, 6)).rejects.toThrow();
    await expect(setStaleThreshold(owner.client, orgId, 0)).rejects.toThrow();
    await expect(setStaleThreshold(owner.client, orgId, 61)).rejects.toThrow();
    expect(await getStaleAfterMonthsForModel(owner.client, modelId)).toBe(12);
  });

  it('finds every element type with an old value, not the fresh ones', async () => {
    expect(await staleIds()).toEqual([ownedSystemId, staleCapabilityId, unownedSystemId].sort());
  });

  it('sends an owned element to its owner and an unowned one to the architects', async () => {
    const { data, error } = await service.schema('atlas').rpc('stale_nudge_recipients', { p_model_id: modelId });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { user_id: string; element_id: string; as_fallback: boolean }[];

    const forOwned = rows.filter((r) => r.element_id === ownedSystemId);
    expect(forOwned.map((r) => r.user_id)).toEqual([owner.id]);
    expect(forOwned.every((r) => !r.as_fallback)).toBe(true);

    // No owner on record: the architect, flagged as a fallback; the org's owner is not also told.
    for (const unowned of [unownedSystemId, staleCapabilityId]) {
      const people = rows.filter((r) => r.element_id === unowned);
      expect(people.map((r) => r.user_id)).toEqual([architect.id]);
      expect(people.every((r) => r.as_fallback)).toBe(true);
    }
    expect(rows.some((r) => r.element_id === freshSystemId)).toBe(false);
  });

  it('"Still accurate" takes an element off the list (the $exists fact does not keep it there)', async () => {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    const { data: element } = await service.from('elements_head').select('element_id, element_type, name, parent_id, attributes, exists_delta_id').eq('commit_id', main.head_commit_id).eq('element_id', unownedSystemId).single();
    if (!element) throw new Error('element missing');
    const result = await commitAttestation(owner.client, { modelId, orgId, userId: owner.id, branch: main, expectedHeadCommitId: main.head_commit_id, element, today: TODAY });
    if (!result.ok) throw new Error(`confirm: ${result.message}`);
    expect(await staleIds()).toEqual([ownedSystemId, staleCapabilityId].sort());
  });

  it('the finding functions are not callable by a signed-in user', async () => {
    const asUser = await architect.client.schema('atlas').rpc('stale_nudge_recipients', { p_model_id: modelId });
    expect(asUser.error).not.toBeNull();
    const elementsAsUser = await architect.client.schema('atlas').rpc('stale_elements', { p_model_id: modelId });
    expect(elementsAsUser.error).not.toBeNull();
  });

  it('stale_nudges: one row per person per model per day, readable by an architect only, writable by nobody signed in', async () => {
    const row = { org_id: orgId, model_id: modelId, user_id: owner.id, item_count: 2 };
    const first = await service.from('stale_nudges').insert(row);
    expect(first.error).toBeNull();
    const second = await service.from('stale_nudges').insert(row);
    expect(second.error).not.toBeNull();

    const asArchitect = await architect.client.from('stale_nudges').select('user_id').eq('model_id', modelId);
    expect((asArchitect.data ?? []).length).toBe(1);
    const asContributor = await contributor.client.from('stale_nudges').select('user_id').eq('model_id', modelId);
    expect((asContributor.data ?? []).length).toBe(0);

    const write = await architect.client.from('stale_nudges').insert({ ...row, user_id: architect.id });
    expect(write.error).not.toBeNull();
  });
});

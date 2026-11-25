/**
 * Integration tests for `decision_option_marks`
 * (`supabase/migrations/20261120010000_decision_option_marks.sql`) against a
 * real local Supabase: the round trip, who may write it (contributor yes,
 * viewer no), that a signed-in user from a DIFFERENT organisation can neither
 * read nor write it, that only the two edit columns can ever change, that a
 * mark must belong to a real option of the decision, that nothing can be
 * deleted, and that it is read-only once the decision leaves proposed.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DecisionOptionMark } from '../contracts/decisionOptionMark';
import { createChangeBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { createDecision, createDecisionLink } from './decisions';
import { insertOptionMark, listOptionMarksForDecision, markOptionEdited } from './decisionOptionMarks';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';

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

describe('decision_option_marks against a real local Supabase', () => {
  let alice: TestUser; // owner
  let outsider: TestUser; // owner of a different organisation
  let orgId: string;
  let modelId: string;

  beforeAll(async () => {
    alice = await createSignedInUser('marks-alice');
    outsider = await createSignedInUser('marks-outsider');
    orgId = randomUUID();
    await createOrganisation(alice.client, { id: orgId, name: 'Marks Org', slug: `marks-${orgId.slice(0, 8)}`, createdBy: alice.id });
    modelId = randomUUID();
    await createModel(alice.client, { id: modelId, orgId, name: 'Marks Model', slug: `marks-model-${modelId.slice(0, 8)}`, createdBy: alice.id });
    const otherOrg = randomUUID();
    await createOrganisation(outsider.client, { id: otherOrg, name: 'Other Org', slug: `other-${otherOrg.slice(0, 8)}`, createdBy: outsider.id });
  });

  afterAll(async () => {
    await service.auth.admin.deleteUser(alice.id);
    await service.auth.admin.deleteUser(outsider.id);
  });

  async function seed(): Promise<{ decisionId: string; branchId: string }> {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Marks decision', statement: 'context', ownerId: alice.id, createdBy: alice.id });
    const option = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `marks-option-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id });
    await createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'branch', linkedId: option.id, createdBy: alice.id });
    return { decisionId: decision.id, branchId: option.id };
  }

  const mark = (decisionId: string, branchId: string): DecisionOptionMark => ({ decisionId, branchId, agent: 'designer', draftedAt: '2026-11-20T09:00:00.000Z', draftRunId: null, suggestedTitle: 'Configure it', suggestedSummary: 'Use what we run.', editedBy: null, editedAt: null });

  it('round-trips a mark, then records who edited the option', async () => {
    const { decisionId, branchId } = await seed();
    const saved = await insertOptionMark(alice.client, { ...mark(decisionId, branchId), createdBy: alice.id });
    // Postgres returns the timestamp as +00:00, not Z: compare the instant, not the text.
    expect({ ...saved, draftedAt: new Date(saved.draftedAt).toISOString() }).toEqual(mark(decisionId, branchId));
    const edited = await markOptionEdited(alice.client, { decisionId, branchId, editedBy: alice.id, editedAt: '2026-11-20T09:05:00.000Z' });
    expect(edited).toMatchObject({ editedBy: alice.id, suggestedTitle: 'Configure it' });
    expect(await listOptionMarksForDecision(alice.client, decisionId)).toHaveLength(1);
  });

  it('a contributor can add a mark; a viewer cannot', async () => {
    const { decisionId, branchId } = await seed();
    const bob = await createSignedInUser('marks-bob');
    await alice.client.from('members').insert({ org_id: orgId, user_id: bob.id, role: 'contributor', invited_by: alice.id });
    await expect(insertOptionMark(bob.client, { ...mark(decisionId, branchId), createdBy: bob.id })).resolves.toMatchObject({ branchId });
    const carol = await createSignedInUser('marks-carol');
    await alice.client.from('members').insert({ org_id: orgId, user_id: carol.id, role: 'viewer', invited_by: alice.id });
    const second = await seed();
    await expect(insertOptionMark(carol.client, { ...mark(second.decisionId, second.branchId), createdBy: carol.id })).rejects.toThrow();
    // A viewer can still read what was recorded.
    expect(await listOptionMarksForDecision(carol.client, decisionId)).toHaveLength(1);
    await service.auth.admin.deleteUser(bob.id);
    await service.auth.admin.deleteUser(carol.id);
  });

  it('a signed-in user from a different organisation can neither read nor write marks', async () => {
    const { decisionId, branchId } = await seed();
    await insertOptionMark(alice.client, { ...mark(decisionId, branchId), createdBy: alice.id });
    expect(await listOptionMarksForDecision(outsider.client, decisionId)).toEqual([]);
    const second = await seed();
    await expect(insertOptionMark(outsider.client, { ...mark(second.decisionId, second.branchId), createdBy: outsider.id })).rejects.toThrow();
    await expect(markOptionEdited(outsider.client, { decisionId, branchId, editedBy: outsider.id, editedAt: '2026-11-20T09:05:00.000Z' })).rejects.toThrow();
  });

  it('only the two edit columns can change, and only to the caller', async () => {
    const { decisionId, branchId } = await seed();
    await insertOptionMark(alice.client, { ...mark(decisionId, branchId), createdBy: alice.id });
    const { error: titleError } = await alice.client.from('decision_option_marks').update({ suggested_title: 'Rewritten history' }).eq('decision_id', decisionId).eq('branch_id', branchId);
    expect(titleError).not.toBeNull();
    const { error: agentError } = await alice.client.from('decision_option_marks').update({ agent: 'designer', drafted_at: '2020-01-01T00:00:00Z' }).eq('decision_id', decisionId).eq('branch_id', branchId);
    expect(agentError).not.toBeNull();
    await expect(markOptionEdited(alice.client, { decisionId, branchId, editedBy: randomUUID(), editedAt: '2026-11-20T09:05:00.000Z' })).rejects.toThrow();
  });

  it('refuses a mark for a branch that is not an option of the decision, and refuses deletes', async () => {
    const { decisionId, branchId } = await seed();
    const stray = await seed();
    await expect(insertOptionMark(alice.client, { ...mark(decisionId, stray.branchId), createdBy: alice.id })).rejects.toThrow();
    await insertOptionMark(alice.client, { ...mark(decisionId, branchId), createdBy: alice.id });
    const { error: deleteError } = await alice.client.from('decision_option_marks').delete().eq('decision_id', decisionId).eq('branch_id', branchId);
    expect(deleteError).not.toBeNull();
    expect(await listOptionMarksForDecision(alice.client, decisionId)).toHaveLength(1);
  });

  it('is read-only once the decision is no longer proposed', async () => {
    const { decisionId, branchId } = await seed();
    await insertOptionMark(alice.client, { ...mark(decisionId, branchId), createdBy: alice.id });
    const { error } = await service.from('decisions').update({ status: 'accepted', decided_by: alice.id, decided_at: new Date().toISOString(), chosen_option_id: ((await service.from('decision_options').select('id').eq('decision_id', decisionId).eq('branch_id', branchId).single()).data)?.id ?? null, branch_id: branchId }).eq('id', decisionId);
    if (error) throw new Error(`force-accepting decision: ${error.message}`);
    await expect(markOptionEdited(alice.client, { decisionId, branchId, editedBy: alice.id, editedAt: '2026-11-20T09:05:00.000Z' })).rejects.toThrow();
  });
});

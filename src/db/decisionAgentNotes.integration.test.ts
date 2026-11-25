/**
 * Integration tests for `decision_agent_notes`
 * (`supabase/migrations/20261121120000_decision_agent_notes.sql`) against a
 * real local Supabase: the round trip, who may keep a note (contributor yes,
 * viewer no), that a signed-in user from a DIFFERENT organisation can neither
 * read nor keep one, that a note can be tied to an option of the decision or
 * to nothing, that a stray branch is refused, that nothing can be updated or
 * deleted, and that keeping is closed once the decision leaves proposed.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KeepDecisionAgentNoteInput } from '../contracts/decisionAgentNote';
import { createChangeBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { keepDecisionAgentNote, listDecisionAgentNotes } from './decisionAgentNotes';
import { createDecision, createDecisionLink } from './decisions';
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

describe('decision_agent_notes against a real local Supabase', () => {
  let alice: TestUser; // owner
  let outsider: TestUser; // owner of a different organisation
  let orgId: string;
  let modelId: string;

  beforeAll(async () => {
    alice = await createSignedInUser('notes-alice');
    outsider = await createSignedInUser('notes-outsider');
    orgId = randomUUID();
    await createOrganisation(alice.client, { id: orgId, name: 'Notes Org', slug: `notes-${orgId.slice(0, 8)}`, createdBy: alice.id });
    modelId = randomUUID();
    await createModel(alice.client, { id: modelId, orgId, name: 'Notes Model', slug: `notes-model-${modelId.slice(0, 8)}`, createdBy: alice.id });
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
    const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Notes decision', statement: 'context', ownerId: alice.id, createdBy: alice.id });
    const option = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `notes-option-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id });
    await createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'branch', linkedId: option.id, createdBy: alice.id });
    return { decisionId: decision.id, branchId: option.id };
  }

  const note = (decisionId: string, branchId: string | null, keptBy: string): KeepDecisionAgentNoteInput => ({
    decisionId,
    branchId,
    lens: 'cyber',
    suggestedQuestion: 'Who has checked the data?',
    question: 'Who has checked the customer data carried?',
    basedOn: branchId === null ? 'none' : 'option',
    basedOnLabel: branchId === null ? null : 'Configure it',
    inputHash: 'a'.repeat(64),
    runId: randomUUID(),
    keptBy,
  });

  it('round-trips a kept note with the original wording beside the edit', async () => {
    const { decisionId, branchId } = await seed();
    const saved = await keepDecisionAgentNote(alice.client, note(decisionId, branchId, alice.id));
    expect(saved).toMatchObject({ decisionId, branchId, lens: 'cyber', agent: 'steward', suggestedQuestion: 'Who has checked the data?', question: 'Who has checked the customer data carried?', basedOn: 'option', basedOnLabel: 'Configure it', keptBy: alice.id });
    expect(await listDecisionAgentNotes(alice.client, decisionId)).toHaveLength(1);
  });

  it('allows a note not tied to an option', async () => {
    const { decisionId } = await seed();
    const saved = await keepDecisionAgentNote(alice.client, note(decisionId, null, alice.id));
    expect(saved.branchId).toBeNull();
    expect(saved.basedOn).toBe('none');
  });

  it('a contributor can keep a note; a viewer cannot, but can read', async () => {
    const { decisionId, branchId } = await seed();
    const bob = await createSignedInUser('notes-bob');
    await alice.client.from('members').insert({ org_id: orgId, user_id: bob.id, role: 'contributor', invited_by: alice.id });
    await expect(keepDecisionAgentNote(bob.client, note(decisionId, branchId, bob.id))).resolves.toMatchObject({ keptBy: bob.id });
    const carol = await createSignedInUser('notes-carol');
    await alice.client.from('members').insert({ org_id: orgId, user_id: carol.id, role: 'viewer', invited_by: alice.id });
    const second = await seed();
    await expect(keepDecisionAgentNote(carol.client, note(second.decisionId, second.branchId, carol.id))).rejects.toThrow();
    expect(await listDecisionAgentNotes(carol.client, decisionId)).toHaveLength(1);
    await service.auth.admin.deleteUser(bob.id);
    await service.auth.admin.deleteUser(carol.id);
  });

  it('a signed-in user from a different organisation can neither read nor keep a note', async () => {
    const { decisionId, branchId } = await seed();
    await keepDecisionAgentNote(alice.client, note(decisionId, branchId, alice.id));
    expect(await listDecisionAgentNotes(outsider.client, decisionId)).toEqual([]);
    const second = await seed();
    await expect(keepDecisionAgentNote(outsider.client, note(second.decisionId, second.branchId, outsider.id))).rejects.toThrow();
  });

  it('refuses a branch that is not an option of the decision', async () => {
    const { decisionId } = await seed();
    const stray = await seed();
    await expect(keepDecisionAgentNote(alice.client, note(decisionId, stray.branchId, alice.id))).rejects.toThrow();
  });

  it('refuses updates and deletes by any signed-in user', async () => {
    const { decisionId, branchId } = await seed();
    const saved = await keepDecisionAgentNote(alice.client, note(decisionId, branchId, alice.id));
    const { error: updateError } = await alice.client.from('decision_agent_notes').update({ question: 'Rewritten' }).eq('id', saved.id);
    expect(updateError).not.toBeNull();
    const { error: deleteError } = await alice.client.from('decision_agent_notes').delete().eq('id', saved.id);
    expect(deleteError).not.toBeNull();
    expect(await listDecisionAgentNotes(alice.client, decisionId)).toHaveLength(1);
  });

  it('is closed once the decision is no longer proposed', async () => {
    const { decisionId, branchId } = await seed();
    const { error } = await service.from('decisions').update({ status: 'accepted', decided_by: alice.id, decided_at: new Date().toISOString(), chosen_option_id: ((await service.from('decision_options').select('id').eq('decision_id', decisionId).eq('branch_id', branchId).single()).data)?.id ?? null, branch_id: branchId }).eq('id', decisionId);
    if (error) throw new Error(`force-accepting decision: ${error.message}`);
    await expect(keepDecisionAgentNote(alice.client, note(decisionId, branchId, alice.id))).rejects.toThrow();
  });
});

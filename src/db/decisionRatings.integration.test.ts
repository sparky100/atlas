/**
 * Integration tests for `decision_option_ratings`
 * (`supabase/migrations/20260929010000_decision_option_ratings.sql`)
 * against a real local Supabase. Same "this sandbox has no Docker route"
 * limitation named in `repository.integration.test.ts`'s own module
 * comment — written and reasoned through against the real RLS behaviour,
 * not executed here.
 *
 * Covers: the round trip (`upsertDecisionRating`/
 * `listDecisionRatingsForDecision`), the permission gate (contributor+
 * can rate a `proposed` decision's linked option, a viewer cannot), the
 * "read-only once chosen" RLS guard (forced to `accepted` via the service
 * role, the same technique `decisions.integration.test.ts` already uses
 * for the equivalent `decisions`/`decision_links` checks), the note
 * length `check` constraint, the "branch must actually be a linked
 * option" guard, and that two different criteria on the same option (two
 * different rows, same primary key prefix) never clobber each other —
 * this sprint's own "multi-user safe" requirement, proven here as
 * concurrent writes to different cells rather than two writes racing the
 * same cell (which is an ordinary last-write-wins upsert, not a
 * correctness bug).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import { createChangeBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { createDecision, createDecisionLink } from './decisions';
import { listDecisionRatingsForDecision, upsertDecisionRating } from './decisionRatings';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  email: string;
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

  return { id: created.user.id, email, client: signIn };
}

function makeCreateDelta(id: string, elementId: string, name: string, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 };
}

describe('decision_option_ratings against a real local Supabase', () => {
  let alice: TestUser; // owner
  let orgId: string;
  let modelId: string;
  let sourceId: string;

  beforeAll(async () => {
    alice = await createSignedInUser('ratings-alice');
    orgId = randomUUID();
    await createOrganisation(alice.client, { id: orgId, name: 'Ratings Test Org', slug: `ratings-${orgId.slice(0, 8)}`, createdBy: alice.id });
    modelId = randomUUID();
    await createModel(alice.client, { id: modelId, orgId, name: 'Ratings Test Model', slug: `ratings-model-${modelId.slice(0, 8)}`, createdBy: alice.id });

    const source = await getOrCreateManualSource(alice.client, { id: randomUUID(), orgId, modelId, userId: alice.id });
    sourceId = source.id;

    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const elementId = randomUUID();
    const envelope: CommitEnvelope = {
      id: randomUUID(),
      branchId: main.id,
      parentCommitId: main.head_commit_id,
      mergedBranchHeadCommitId: null,
      kind: 'manual',
      title: 'seed a system so options have something to branch from',
      body: null,
      deltas: [makeCreateDelta(randomUUID(), elementId, 'SAP PM', sourceId)],
    };
    const seedResult = await commitToBranch(alice.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
    if (!seedResult.ok) throw new Error(`ratings fixture: seeding a system: ${seedResult.message}`);
  });

  afterAll(async () => {
    await service.auth.admin.deleteUser(alice.id);
  });

  async function seedDecisionWithOption(title: string): Promise<{ decisionId: string; optionBranchId: string }> {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title, statement: 'context', ownerId: alice.id, createdBy: alice.id });
    const option = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `ratings-option-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id });
    await createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'branch', linkedId: option.id, createdBy: alice.id });
    return { decisionId: decision.id, optionBranchId: option.id };
  }

  it('upsertDecisionRating round-trips a rating with a note, and a second call for the same (decision, option, criterion) updates rather than duplicates', async () => {
    const { decisionId, optionBranchId } = await seedDecisionWithOption('Rate one option, one criterion');

    const first = await upsertDecisionRating(alice.client, { decisionId, branchId: optionBranchId, criterion: 'cost', level: 'favourable', note: 'Cheaper than the incumbent.', ratedBy: alice.id });
    expect(first).toMatchObject({ decision_id: decisionId, branch_id: optionBranchId, criterion: 'cost', level: 'favourable', note: 'Cheaper than the incumbent.', rated_by: alice.id });

    const second = await upsertDecisionRating(alice.client, { decisionId, branchId: optionBranchId, criterion: 'cost', level: 'unfavourable', note: null, ratedBy: alice.id });
    expect(second).toMatchObject({ decision_id: decisionId, branch_id: optionBranchId, criterion: 'cost', level: 'unfavourable', note: null });

    const rows = await listDecisionRatingsForDecision(alice.client, decisionId);
    const costRows = rows.filter((r) => r.criterion === 'cost' && r.branch_id === optionBranchId);
    expect(costRows).toHaveLength(1);
    expect(costRows[0]).toMatchObject({ level: 'unfavourable', note: null });
  });

  it('rating two different criteria on the same option concurrently leaves both rows intact — different cells never clobber each other', async () => {
    const { decisionId, optionBranchId } = await seedDecisionWithOption('Concurrent different-cell ratings');

    const [cost, effort] = await Promise.all([
      upsertDecisionRating(alice.client, { decisionId, branchId: optionBranchId, criterion: 'cost', level: 'favourable', note: null, ratedBy: alice.id }),
      upsertDecisionRating(alice.client, { decisionId, branchId: optionBranchId, criterion: 'effort', level: 'acceptable', note: null, ratedBy: alice.id }),
    ]);
    expect(cost.criterion).toBe('cost');
    expect(effort.criterion).toBe('effort');

    const rows = await listDecisionRatingsForDecision(alice.client, decisionId);
    expect(rows.filter((r) => r.branch_id === optionBranchId).map((r) => r.criterion).sort()).toEqual(['cost', 'effort']);
  });

  it('a second contributor rating a different criterion on the same option does not disturb the first contributor\'s own row', async () => {
    const { decisionId, optionBranchId } = await seedDecisionWithOption('Two raters, two criteria');
    const bob = await createSignedInUser('ratings-bob-contributor');
    const { error: inviteError } = await alice.client.from('members').insert({ org_id: orgId, user_id: bob.id, role: 'contributor', invited_by: alice.id });
    if (inviteError) throw new Error(`inviting bob as contributor: ${inviteError.message}`);

    await upsertDecisionRating(alice.client, { decisionId, branchId: optionBranchId, criterion: 'cost', level: 'favourable', note: null, ratedBy: alice.id });
    await upsertDecisionRating(bob.client, { decisionId, branchId: optionBranchId, criterion: 'timing', level: 'unfavourable', note: null, ratedBy: bob.id });

    const rows = await listDecisionRatingsForDecision(alice.client, decisionId);
    const cost = rows.find((r) => r.criterion === 'cost');
    const timing = rows.find((r) => r.criterion === 'timing');
    expect(cost).toMatchObject({ rated_by: alice.id, level: 'favourable' });
    expect(timing).toMatchObject({ rated_by: bob.id, level: 'unfavourable' });

    await service.auth.admin.deleteUser(bob.id);
  });

  it('a contributor can rate a proposed decision\'s linked option; a viewer cannot', async () => {
    const { decisionId, optionBranchId } = await seedDecisionWithOption('Permission gate: contributor yes, viewer no');

    const bob = await createSignedInUser('ratings-bob-contributor-2');
    const { error: contributorInviteError } = await alice.client.from('members').insert({ org_id: orgId, user_id: bob.id, role: 'contributor', invited_by: alice.id });
    if (contributorInviteError) throw new Error(`inviting bob as contributor: ${contributorInviteError.message}`);
    const rated = await upsertDecisionRating(bob.client, { decisionId, branchId: optionBranchId, criterion: 'deliveryRisk', level: 'acceptable', note: null, ratedBy: bob.id });
    expect(rated).toMatchObject({ criterion: 'deliveryRisk', level: 'acceptable' });
    await service.auth.admin.deleteUser(bob.id);

    const carol = await createSignedInUser('ratings-carol-viewer');
    const { error: viewerInviteError } = await alice.client.from('members').insert({ org_id: orgId, user_id: carol.id, role: 'viewer', invited_by: alice.id });
    if (viewerInviteError) throw new Error(`inviting carol as viewer: ${viewerInviteError.message}`);
    await expect(upsertDecisionRating(carol.client, { decisionId, branchId: optionBranchId, criterion: 'vendorFit', level: 'favourable', note: null, ratedBy: carol.id })).rejects.toThrow();
    await service.auth.admin.deleteUser(carol.id);
  });

  it('rejects a rating whose branch_id is not actually a linked option on the decision', async () => {
    const { decisionId } = await seedDecisionWithOption('Unlinked branch guard');
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const unlinkedBranch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `ratings-unlinked-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id });

    await expect(upsertDecisionRating(alice.client, { decisionId, branchId: unlinkedBranch.id, criterion: 'cost', level: 'favourable', note: null, ratedBy: alice.id })).rejects.toThrow();
  });

  it('accepts the "Reaches the outcome" rating (item 3) and refuses an unknown criterion', async () => {
    const { decisionId, optionBranchId } = await seedDecisionWithOption('Outcome rating');
    const row = await upsertDecisionRating(alice.client, { decisionId, branchId: optionBranchId, criterion: 'outcome', level: 'acceptable', note: 'Four days, not two', ratedBy: alice.id });
    expect(row).toMatchObject({ criterion: 'outcome', level: 'acceptable', note: 'Four days, not two' });
    const unknown = { decisionId, branchId: optionBranchId, criterion: 'happiness', level: 'favourable', note: null, ratedBy: alice.id } as unknown as Parameters<typeof upsertDecisionRating>[1];
    await expect(upsertDecisionRating(alice.client, unknown)).rejects.toThrow();
  });

  it('rejects a note over the 200-character cap at the database level', async () => {
    const { decisionId, optionBranchId } = await seedDecisionWithOption('Note length guard');
    const tooLong = 'x'.repeat(201);
    await expect(upsertDecisionRating(alice.client, { decisionId, branchId: optionBranchId, criterion: 'effort', level: 'favourable', note: tooLong, ratedBy: alice.id })).rejects.toThrow();

    const atCap = 'x'.repeat(200);
    const ok = await upsertDecisionRating(alice.client, { decisionId, branchId: optionBranchId, criterion: 'effort', level: 'favourable', note: atCap, ratedBy: alice.id });
    expect(ok.note).toBe(atCap);
  });

  it('ratings become read-only once the decision leaves proposed (forced here — atlas.choose_decision_option is exercised end to end in decisions.integration.test.ts)', async () => {
    const { decisionId, optionBranchId } = await seedDecisionWithOption('Read-only once chosen');
    await upsertDecisionRating(alice.client, { decisionId, branchId: optionBranchId, criterion: 'cost', level: 'favourable', note: 'before choosing', ratedBy: alice.id });

    const { error: forceError } = await service.from('decisions').update({ status: 'accepted', decided_by: alice.id, decided_at: new Date().toISOString(), chosen_option_id: ((await service.from('decision_options').select('id').eq('decision_id', decisionId).eq('branch_id', optionBranchId).single()).data)?.id ?? null, branch_id: optionBranchId }).eq('id', decisionId);
    if (forceError) throw new Error(`force-accepting decision: ${forceError.message}`);

    await expect(upsertDecisionRating(alice.client, { decisionId, branchId: optionBranchId, criterion: 'cost', level: 'unfavourable', note: 'trying to edit after choosing', ratedBy: alice.id })).rejects.toThrow();

    const rows = await listDecisionRatingsForDecision(alice.client, decisionId);
    expect(rows.find((r) => r.criterion === 'cost')).toMatchObject({ level: 'favourable', note: 'before choosing' });
  });
});

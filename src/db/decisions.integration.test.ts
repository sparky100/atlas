/**
 * Integration tests for prompt pack F3 PR4's decision schema (ADR-013,
 * extended by ADR-022 — `docs/ADR-022-decisions-schema.md`,
 * `supabase/migrations/20260913110000_decisions.sql`) against a real local
 * Supabase. Same "this sandbox has no Docker route" limitation named in
 * `repository.integration.test.ts`'s own module comment — written and
 * reasoned through against the real RLS/trigger behaviour, not executed
 * here.
 *
 * Covers: the `decisions` round-trip, its draft-only (`status='proposed'`)
 * update guard, `decision_links`'s own status-gated insert, that
 * `decision_arguments` has genuinely no open insert grant yet (PR5's own
 * `atlas.choose_decision_option` is the only writer), a minimal
 * `assumptions`/`evidence` round-trip, and the `'decision'` anchor wiring
 * on `comments` (`atlas.check_anchor`/`atlas.anchor_visible_to_viewer`).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import { createChangeBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { createComment, listCommentsForAnchor } from './comments';
import { createDecision, createDecisionLink, getDecision, listDecisionArgumentsForDecision, listDecisionLinksForDecision, listDecisionsForModel } from './decisions';
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

describe('decisions/decision_links/decision_arguments/assumptions/evidence against a real local Supabase', () => {
  let alice: TestUser; // owner
  let orgId: string;
  let modelId: string;
  let elementId: string;
  let sourceId: string;

  beforeAll(async () => {
    alice = await createSignedInUser('decisions-alice');
    orgId = randomUUID();
    await createOrganisation(alice.client, { id: orgId, name: 'Decisions Test Org', slug: `decisions-${orgId.slice(0, 8)}`, createdBy: alice.id });
    modelId = randomUUID();
    await createModel(alice.client, { id: modelId, orgId, name: 'Decisions Test Model', slug: `decisions-model-${modelId.slice(0, 8)}`, createdBy: alice.id });

    const source = await getOrCreateManualSource(alice.client, { id: randomUUID(), orgId, modelId, userId: alice.id });
    sourceId = source.id;

    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    elementId = randomUUID();
    const envelope: CommitEnvelope = {
      id: randomUUID(),
      branchId: main.id,
      parentCommitId: main.head_commit_id,
      mergedBranchHeadCommitId: null,
      kind: 'manual',
      title: 'seed a system to link decisions to',
      body: null,
      deltas: [makeCreateDelta(randomUUID(), elementId, 'SAP PM', sourceId)],
    };
    const seedResult = await commitToBranch(alice.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
    if (!seedResult.ok) throw new Error(`decisions fixture: seeding a system: ${seedResult.message}`);
  });

  afterAll(async () => {
    await service.auth.admin.deleteUser(alice.id);
  });

  it('createDecision round-trips every field; it is listed and readable back', async () => {
    const decision = await createDecision(alice.client, {
      id: randomUUID(),
      orgId,
      modelId,
      title: 'What replaces SAP PM?',
      statement: 'SAP PM is past its support end date and needs a replacement.',
      ownerId: alice.id,
      neededBy: '2027-01-01',
      sourceFindingKey: 'critical-support-end',
      createdBy: alice.id,
    });
    expect(decision).toMatchObject({
      title: 'What replaces SAP PM?',
      statement: 'SAP PM is past its support end date and needs a replacement.',
      status: 'proposed',
      owner_id: alice.id,
      needed_by: '2027-01-01',
      source_finding_key: 'critical-support-end',
      lens_map_url: null,
      decided_by: null,
      decided_at: null,
      branch_id: null,
      superseded_decision_id: null,
      created_by: alice.id,
    });

    const fetched = await getDecision(alice.client, decision.id);
    expect(fetched).toMatchObject({ id: decision.id, title: 'What replaces SAP PM?' });

    const listed = await listDecisionsForModel(alice.client, modelId);
    expect(listed.map((d) => d.id)).toContain(decision.id);
  });

  it('a plain update to title/statement succeeds while proposed; status/decided_by/branch_id are never touchable by a plain update', async () => {
    const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Draft title', statement: 'Draft context.', ownerId: alice.id, createdBy: alice.id });

    const { error: titleError } = await alice.client.from('decisions').update({ title: 'Revised title' }).eq('id', decision.id);
    expect(titleError).toBeNull();
    expect((await getDecision(alice.client, decision.id))?.title).toBe('Revised title');

    // atlas.guard_decision_update rejects a plain update touching any of the
    // choose_decision_option-only columns, even though the grant itself
    // would already refuse it (the trigger is defence-in-depth, same shape
    // as branches.intent's own guard).
    const { error: statusError } = await service.from('decisions').update({ status: 'accepted', decided_by: alice.id, decided_at: new Date().toISOString(), branch_id: null }).eq('id', decision.id);
    // (service role bypasses RLS but not the trigger — this still proves the trigger, not just the grant, is what refuses it.)
    expect(statusError).not.toBeNull();
  });

  it('once a decision leaves proposed (forced here — atlas.choose_decision_option is PR5), a plain update to any column is rejected', async () => {
    const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Will be force-accepted', statement: 'context', ownerId: alice.id, createdBy: alice.id });
    const otherBranch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `decision-accept-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: (await getMainBranch(alice.client, modelId))?.head_commit_id ?? '' });

    // Simulates what atlas.choose_decision_option (PR5) will do — bypassing
    // RLS/the guard trigger via the service role is the only way to reach
    // this state before that RPC exists; the point of this test is what
    // happens to a plain update *after* that state is reached, not how it
    // got there.
    const { error: forceError } = await service
      .from('decisions')
      .update({ status: 'accepted', decided_by: alice.id, decided_at: new Date().toISOString(), branch_id: otherBranch.id })
      .eq('id', decision.id);
    if (forceError) throw new Error(`force-accepting decision: ${forceError.message}`);

    const { error: editAfterAcceptError } = await alice.client.from('decisions').update({ title: 'Trying to edit an accepted decision' }).eq('id', decision.id);
    expect(editAfterAcceptError).not.toBeNull();
  });

  it('decision_links: insert while proposed succeeds (element and branch link types); insert is rejected once the decision has left proposed', async () => {
    const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Links check', statement: 'context', ownerId: alice.id, createdBy: alice.id });
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const optionBranch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `decision-option-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id });

    const elementLink = await createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'element', linkedId: elementId, createdBy: alice.id });
    expect(elementLink).toMatchObject({ decision_id: decision.id, linked_type: 'element', linked_id: elementId });

    const branchLink = await createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'branch', linkedId: optionBranch.id, createdBy: alice.id });
    expect(branchLink).toMatchObject({ decision_id: decision.id, linked_type: 'branch', linked_id: optionBranch.id });

    const links = await listDecisionLinksForDecision(alice.client, decision.id);
    expect(links.map((l) => l.linked_id).sort()).toEqual([elementId, optionBranch.id].sort());

    const { error: forceError } = await service.from('decisions').update({ status: 'rejected' }).eq('id', decision.id);
    if (forceError) throw new Error(`force-rejecting decision: ${forceError.message}`);

    await expect(createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'element', linkedId: elementId, createdBy: alice.id })).rejects.toThrow();
  });

  it('decision_arguments has no open insert grant — only atlas.choose_decision_option (PR5) writes it; the query itself returns an honest empty list until then', async () => {
    const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'No arguments yet', statement: 'context', ownerId: alice.id, createdBy: alice.id });
    expect(await listDecisionArgumentsForDecision(alice.client, decision.id)).toEqual([]);

    const { error } = await alice.client.from('decision_arguments').insert({ id: randomUUID(), decision_id: decision.id, stance: 'for', body: 'a reason', author: alice.id });
    expect(error).not.toBeNull();
  });

  it('assumptions and evidence: a minimal insert/select round trip (schema-complete, no authoring UI this sprint)', async () => {
    const { data: assumption, error: assumptionError } = await alice.client
      .from('assumptions')
      .insert({ id: randomUUID(), org_id: orgId, model_id: modelId, statement: 'The vendor will still support the old integration for 12 months.', owner: alice.id, created_by: alice.id })
      .select('*')
      .single();
    if (assumptionError) throw new Error(`inserting assumption: ${assumptionError.message}`);
    expect(assumption).toMatchObject({ status: 'open', confidence: 1, linked_review_pending: false });

    const { data: evidence, error: evidenceError } = await alice.client
      .from('evidence')
      .insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'link', pointer: 'https://example.test/vendor-roadmap', added_by: alice.id })
      .select('*')
      .single();
    if (evidenceError) throw new Error(`inserting evidence: ${evidenceError.message}`);
    expect(evidence).toMatchObject({ kind: 'link', pointer: 'https://example.test/vendor-roadmap', source_id: null });
  });

  it("atlas.check_anchor rejects a comment anchored to a decision that doesn't exist; a comment on a real decision round-trips and is visible to a viewer", async () => {
    await expect(createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'decision', anchorId: randomUUID(), body: 'a comment on nothing', authorId: alice.id })).rejects.toThrow();

    const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Comment target', statement: 'context', ownerId: alice.id, createdBy: alice.id });
    const comment = await createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'decision', anchorId: decision.id, body: 'worth discussing', authorId: alice.id });
    expect(comment).toMatchObject({ anchor_type: 'decision', anchor_id: decision.id });

    const bob = await createSignedInUser('decisions-bob-viewer');
    const { error: inviteError } = await alice.client.from('members').insert({ org_id: orgId, user_id: bob.id, role: 'viewer', invited_by: alice.id });
    if (inviteError) throw new Error(`inviting bob as viewer: ${inviteError.message}`);
    const asViewer = await listCommentsForAnchor(bob.client, modelId, 'decision', decision.id);
    expect(asViewer.threads.map((t) => t.root.id)).toContain(comment.id);
    await service.auth.admin.deleteUser(bob.id);
  });
});

/**
 * Integration tests for prompt pack F3's decision schema (ADR-013,
 * extended by ADR-022 — `docs/ADR-022-decisions-schema.md`,
 * `supabase/migrations/20260913110000_decisions.sql`/
 * `20260913120000_choose_decision_option.sql`) against a real local
 * Supabase. Same "this sandbox has no Docker route" limitation named in
 * `repository.integration.test.ts`'s own module comment — written and
 * reasoned through against the real RLS/trigger behaviour, not executed
 * here.
 *
 * Covers: the `decisions` round-trip, its draft-only (`status='proposed'`)
 * update guard, `decision_links`'s own status-gated insert, a minimal
 * `assumptions`/`evidence` round-trip, the `'decision'` anchor wiring on
 * `comments` (`atlas.check_anchor`/`atlas.anchor_visible_to_viewer`),
 * (PR5) `atlas.choose_decision_option` end to end — three `explore`-intent
 * options, choosing one, asserting the chosen branch's flipped `propose`
 * intent, the other two's `cancel_reason`, the one `decision_arguments`
 * row, and `decisions.status`/`branch_id`/`decided_by`/`decided_at` — and
 * (PR6) `listDecisionsLinkingElements`, "why is this here"'s own query.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import { createChangeBranch, getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { createDecisionOption, getDecisionOptionForBranch, workOnDecisionOption } from './decisionOptions';
import { commitToBranch } from './commits';
import { createComment, listCommentsForAnchor } from './comments';
import {
  cancelDecision,
  chooseDecisionOption,
  freezeDecisionPack,
  listDecisionApprovals,
  listDecisionPacks,
  recordDecisionApproval,
  countProposedDecisions,
  createDecision,
  createDecisionLink,
  getDecision,
  listDecisionArgumentsForDecision,
  listDecisionLinksForDecision,
  listDecisionsForModel,
  listDecisionsLinkingElements,
  listOpenDecisionElementLinksForModel,
  updateDecision,
} from './decisions';
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


/** The candidate row the decision_links trigger made for a linked branch option. */
async function optionFor(client: Client, decisionId: string, branchId: string): Promise<string> {
  const option = await getDecisionOptionForBranch(client, decisionId, branchId);
  if (option === null) throw new Error('optionFor: no candidate row for this branch');
  return option.id;
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

  it("listOpenDecisionElementLinksForModel lists open decisions' element links on this model only — never a cancelled decision's, never another model's", async () => {
    const open = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Replace SAP PM?', statement: 'Open.', ownerId: alice.id, createdBy: alice.id });
    await createDecisionLink(alice.client, { decisionId: open.id, linkedType: 'element', linkedId: elementId, createdBy: alice.id });
    const cancelled = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Tolerate SAP PM?', statement: 'Withdrawn.', ownerId: alice.id, createdBy: alice.id });
    await createDecisionLink(alice.client, { decisionId: cancelled.id, linkedType: 'element', linkedId: elementId, createdBy: alice.id });
    await cancelDecision(alice.client, cancelled.id, 'Withdrawn.');

    // A second model in the same org, with its own element and open, linked decision.
    const otherModelId = randomUUID();
    await createModel(alice.client, { id: otherModelId, orgId, name: 'Other Model', slug: `decisions-other-${otherModelId.slice(0, 8)}`, createdBy: alice.id });
    const otherSource = await getOrCreateManualSource(alice.client, { id: randomUUID(), orgId, modelId: otherModelId, userId: alice.id });
    const otherMain = await getMainBranch(alice.client, otherModelId);
    if (!otherMain?.head_commit_id) throw new Error('other main branch not found');
    const otherElementId = randomUUID();
    const otherSeed = await commitToBranch(alice.client, {
      modelId: otherModelId,
      branchId: otherMain.id,
      expectedHeadCommitId: otherMain.head_commit_id,
      envelope: { id: randomUUID(), branchId: otherMain.id, parentCommitId: otherMain.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed', body: null, deltas: [makeCreateDelta(randomUUID(), otherElementId, 'Other PM', otherSource.id)] },
    });
    if (!otherSeed.ok) throw new Error(`other model seed: ${otherSeed.message}`);
    const otherDecision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId: otherModelId, title: 'Elsewhere', statement: 'Other model.', ownerId: alice.id, createdBy: alice.id });
    await createDecisionLink(alice.client, { decisionId: otherDecision.id, linkedType: 'element', linkedId: otherElementId, createdBy: alice.id });

    const links = await listOpenDecisionElementLinksForModel(alice.client, modelId);
    expect(links).toContainEqual({ decisionId: open.id, elementId });
    expect(links.map((l) => l.decisionId)).not.toContain(cancelled.id);
    expect(links.map((l) => l.decisionId)).not.toContain(otherDecision.id);
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

  it('AI marks (step F): set at creation and read back; only ai_draft_edited can be updated; another organisation sees and changes nothing', async () => {
    const draftedAt = '2026-11-19T18:00:00.000Z';
    const decision = await createDecision(alice.client, {
      id: randomUUID(),
      orgId,
      modelId,
      title: 'Drafted with the Designer',
      statement: "Designer's draft options:\n1. Stay as we are.",
      ownerId: alice.id,
      aiDraft: { agent: 'designer', draftedAt, edited: false },
      createdBy: alice.id,
    });
    expect(decision).toMatchObject({ ai_draft_agent: 'designer', ai_draft_edited: false });
    expect(new Date(decision.ai_drafted_at ?? '').toISOString()).toBe(draftedAt);

    // A fully human decision carries no mark.
    const human = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Written by hand', statement: 'Context.', ownerId: alice.id, createdBy: alice.id });
    expect(human).toMatchObject({ ai_draft_agent: null, ai_drafted_at: null, ai_draft_edited: false });

    // The one updatable AI-mark column.
    const edited = await updateDecision(alice.client, decision.id, { aiDraftEdited: true });
    expect(edited.ai_draft_edited).toBe(true);

    // The agent and the time are not in the update grant: Postgres refuses them.
    const { error: agentError } = await alice.client.from('decisions').update({ ai_draft_agent: null }).eq('id', decision.id);
    expect(agentError).not.toBeNull();
    const { error: timeError } = await alice.client.from('decisions').update({ ai_drafted_at: null }).eq('id', decision.id);
    expect(timeError).not.toBeNull();

    // The marks are consistent: an edited mark needs an agent, and agent and time go together.
    await expect(service.from('decisions').update({ ai_draft_edited: true }).eq('id', human.id).then((r) => r.error?.message ?? '')).resolves.toMatch(/ai_draft_edited_needs_agent/);
    await expect(service.from('decisions').update({ ai_draft_agent: 'designer' }).eq('id', human.id).then((r) => r.error?.message ?? '')).resolves.toMatch(/ai_draft_together/);

    // Another organisation's signed-in user cannot read the decision or change its mark.
    const outsider = await createSignedInUser('decisions-ai-outsider');
    try {
      await createOrganisation(outsider.client, { id: randomUUID(), name: 'Outsider Org', slug: `outsider-${randomUUID().slice(0, 8)}`, createdBy: outsider.id });
      expect(await getDecision(outsider.client, decision.id)).toBeNull();
      const { data: touched } = await outsider.client.from('decisions').update({ ai_draft_edited: false }).eq('id', decision.id).select('id');
      expect(touched ?? []).toHaveLength(0);
      expect((await getDecision(alice.client, decision.id))?.ai_draft_edited).toBe(true);
    } finally {
      await service.auth.admin.deleteUser(outsider.id);
    }
  });

  it('a plain update to title/statement succeeds while proposed; status/decided_by/branch_id are never touchable by a plain update', async () => {
    const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Draft title', statement: 'Draft context.', ownerId: alice.id, createdBy: alice.id });

    const { error: titleError } = await alice.client.from('decisions').update({ title: 'Revised title' }).eq('id', decision.id);
    expect(titleError).toBeNull();
    expect((await getDecision(alice.client, decision.id))?.title).toBe('Revised title');

    // status/decided_by/decided_at/branch_id are never granted to a plain
    // authenticated client at all (the same "sensitive column simply isn't
    // grantable" shape branches.status itself already uses) — Postgres
    // refuses this at the column-privilege level before atlas.
    // guard_decision_update's own timing check ever runs. Using alice's
    // own signed-in client here (not the service role, which bypasses
    // column grants entirely, same as it bypasses RLS) is what actually
    // proves this boundary.
    const { error: statusError } = await alice.client.from('decisions').update({ status: 'accepted', decided_by: alice.id, decided_at: new Date().toISOString(), branch_id: null }).eq('id', decision.id);
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
    const forcedOption = await createDecisionOption(alice.client, { decisionId: decision.id, title: 'Forced choice', createdBy: alice.id });
    const { error: forceError } = await service
      .from('decisions')
      .update({ status: 'accepted', decided_by: alice.id, decided_at: new Date().toISOString(), chosen_option_id: forcedOption.id, branch_id: otherBranch.id })
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

  describe('atlas.choose_decision_option (prompt pack F3 PR5)', () => {
    it("choosing one of three explore-intent options flips its own intent to propose, cancels the other two (with a 'Not chosen' reason), records the one decision_arguments row, and closes the decision", async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');

      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Which replacement?', statement: 'context', ownerId: alice.id, createdBy: alice.id });

      const options = await Promise.all(
        ['option-a', 'option-b', 'option-c'].map((name) =>
          createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `${name}-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id }),
        ),
      );
      await Promise.all(options.map((o) => createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'branch', linkedId: o.id, createdBy: alice.id })));

      const chosen = options[1];
      if (!chosen) throw new Error('expected three options');
      const notChosen = options.filter((o) => o.id !== chosen.id);

      const accepted = await chooseDecisionOption(alice.client, decision.id, await optionFor(alice.client, decision.id, chosen.id), 'Option B has the lowest boundary-crossing count and no criticality regressions.');
      expect(accepted).toMatchObject({ status: 'accepted', branch_id: chosen.id, chosen_option_id: await optionFor(alice.client, decision.id, chosen.id), decided_by: alice.id });
      expect(accepted.decided_at).not.toBeNull();

      const chosenBranchAfter = await getBranch(alice.client, chosen.id);
      expect(chosenBranchAfter).toMatchObject({ intent: 'propose', status: 'draft' });

      for (const other of notChosen) {
        const otherAfter = await getBranch(alice.client, other.id);
        expect(otherAfter).toMatchObject({ status: 'cancelled', cancel_reason: `Not chosen: see decision ${decision.id}` });
        expect(otherAfter?.cancelled_at).not.toBeNull();
      }

      const args = await listDecisionArgumentsForDecision(alice.client, decision.id);
      expect(args).toHaveLength(1);
      expect(args[0]).toMatchObject({ decision_id: decision.id, stance: 'for', author: alice.id, body: 'Option B has the lowest boundary-crossing count and no criticality regressions.' });

      // Closed: even title (a grantable column) is no longer plain-editable once accepted.
      const { error: editAfterChooseError } = await alice.client.from('decisions').update({ title: 'Trying to edit after choosing' }).eq('id', decision.id);
      expect(editAfterChooseError).not.toBeNull();
    });

    it('records what would make us reconsider, and a review date; both are optional and cannot be edited afterwards', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Reconsider record', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const option = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `reconsider-option-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id });
      await createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'branch', linkedId: option.id, createdBy: alice.id });
      expect(decision.reconsider_if).toBeNull();
      expect(decision.review_by).toBeNull();

      await expect(chooseDecisionOption(alice.client, decision.id, await optionFor(alice.client, decision.id, option.id), 'Cheapest.', { reconsiderIf: 'Price rises', reviewBy: '2020-01-01' })).rejects.toThrow(/past/);

      const reviewBy = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
      const accepted = await chooseDecisionOption(alice.client, decision.id, await optionFor(alice.client, decision.id, option.id), 'Cheapest.', { reconsiderIf: '  Vendor price rises or support is extended  ', reviewBy });
      expect(accepted).toMatchObject({ status: 'accepted', reconsider_if: 'Vendor price rises or support is extended', review_by: reviewBy });

      // Not in the column update grant: even the owner cannot rewrite them directly.
      const { error: rewriteError } = await alice.client.from('decisions').update({ reconsider_if: 'edited later' }).eq('id', decision.id);
      expect(rewriteError).not.toBeNull();
    });

    it('records a "Stay as we are" baseline: two plain answers, a baseline option that must be one of the decision\'s own, editable only while proposed', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Baseline record', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      expect(decision).toMatchObject({ stay_risk: '', stay_reason: '', baseline_option_id: null, baseline_branch_id: null });
      const baseline = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `baseline-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id });
      const stranger = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `not-an-option-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id });
      await createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'branch', linkedId: baseline.id, createdBy: alice.id });

      // A branch that is not one of the decision's options cannot be its baseline.
      await expect(updateDecision(alice.client, decision.id, { baselineBranchId: stranger.id })).rejects.toThrow(/baseline must be one of/);

      const described = await updateDecision(alice.client, decision.id, { stayRisk: 'Vendor support ends in March', stayReason: 'No budget this year', baselineBranchId: baseline.id });
      expect(described).toMatchObject({ stay_risk: 'Vendor support ends in March', stay_reason: 'No budget this year', baseline_branch_id: baseline.id });

      // The baseline is an ordinary option: it can be chosen.
      const accepted = await chooseDecisionOption(alice.client, decision.id, await optionFor(alice.client, decision.id, baseline.id), 'We cannot deliver a change this year.');
      expect(accepted).toMatchObject({ status: 'accepted', branch_id: baseline.id, baseline_branch_id: baseline.id });

      // Closed with the decision: no further edits.
      await expect(updateDecision(alice.client, decision.id, { stayRisk: 'edited later' })).rejects.toThrow();

      // A signed-in user from a different organisation cannot touch the baseline fields.
      const outsider = await createSignedInUser('baseline-outsider');
      await expect(updateDecision(outsider.client, decision.id, { stayRisk: 'not mine' })).rejects.toThrow();
    });

    it('records a baseline candidate with no delivery branch', async () => {
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Branchless baseline', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const baseline = await createDecisionOption(alice.client, { decisionId: decision.id, title: 'Stay as we are', createdBy: alice.id });
      const other = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Other decision', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const otherOption = await createDecisionOption(alice.client, { decisionId: other.id, title: 'Not this one', createdBy: alice.id });

      await expect(updateDecision(alice.client, decision.id, { baselineOptionId: otherOption.id })).rejects.toThrow(/baseline must be one of/);

      const described = await updateDecision(alice.client, decision.id, { baselineOptionId: baseline.id, stayRisk: 'Vendor support ends in March' });
      expect(described).toMatchObject({ baseline_option_id: baseline.id, baseline_branch_id: null, stay_risk: 'Vendor support ends in March' });
    });

    it('a signed-in user from a different organisation cannot choose an option on this decision', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Cross-org check', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const option = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `xorg-option-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id });
      await createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'branch', linkedId: option.id, createdBy: alice.id });
      const outsider = await createSignedInUser('decisions-outsider');
      await expect(chooseDecisionOption(outsider.client, decision.id, await optionFor(alice.client, decision.id, option.id), 'I am not a member', { reconsiderIf: 'x' })).rejects.toThrow();
      await service.auth.admin.deleteUser(outsider.id);
    });

    it('refuses a non-owner/architect caller, an option of another decision, and an option whose change is not a draft explore-intent change', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Refusal checks', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const option = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `refusal-option-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id });
      await createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'branch', linkedId: option.id, createdBy: alice.id });

      // An option of another decision is not one of this decision's options.
      const elsewhere = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Elsewhere', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const elsewhereOption = await createDecisionOption(alice.client, { decisionId: elsewhere.id, title: 'Not on this decision', createdBy: alice.id });
      await expect(chooseDecisionOption(alice.client, decision.id, elsewhereOption.id, 'not one of its options')).rejects.toThrow(/not one of decision/);

      const bob = await createSignedInUser('decisions-bob-contributor');
      const { error: inviteError } = await alice.client.from('members').insert({ org_id: orgId, user_id: bob.id, role: 'contributor', invited_by: alice.id });
      if (inviteError) throw new Error(`inviting bob as contributor: ${inviteError.message}`);
      await expect(chooseDecisionOption(bob.client, decision.id, await optionFor(alice.client, decision.id, option.id), 'a contributor should not be able to choose')).rejects.toThrow();
      await service.auth.admin.deleteUser(bob.id);

      // F3a's own architect floor (`atlas.submit_merge_request`'s own
      // `v_min_architects`, default 1): an explore-intent option submit
      // needs a real reviewer set including an architect — created purely
      // to satisfy that floor for this one submit.
      const architect = await createSignedInUser('decisions-architect');
      const { error: architectError } = await alice.client.from('members').insert({ org_id: orgId, user_id: architect.id, role: 'architect', invited_by: alice.id });
      if (architectError) throw new Error(`inviting architect: ${architectError.message}`);

      // Submit the option for review — it leaves 'draft', so it's no longer a legal choice even though it's still linked.
      const { error: submitError } = await alice.client.schema('atlas').rpc('submit_merge_request', { p_id: randomUUID(), p_branch_id: option.id, p_classification: {}, p_reviewers: [{ user_id: architect.id, required: true }] });
      if (submitError) throw new Error(`submit_merge_request: ${submitError.message}`);
      await expect(chooseDecisionOption(alice.client, decision.id, await optionFor(alice.client, decision.id, option.id), 'no longer a draft')).rejects.toThrow();
    });

    it('choosing a candidate with no change records the choice only; Start delivery then makes the delivery change (item 5, option A)', async () => {
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Choose a candidate', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const chosen = await createDecisionOption(alice.client, { decisionId: decision.id, title: 'Buy a quoting product', createdBy: alice.id });
      const other = await createDecisionOption(alice.client, { decisionId: decision.id, title: 'Configure the CRM', createdBy: alice.id });
      const baseline = await createDecisionOption(alice.client, { decisionId: decision.id, title: 'Stay as we are', createdBy: alice.id });
      await updateDecision(alice.client, decision.id, { baselineOptionId: baseline.id });
      const { count: branchesBefore } = await alice.client.from('branches').select('id', { count: 'exact', head: true }).eq('model_id', modelId);

      const accepted = await chooseDecisionOption(alice.client, decision.id, chosen.id, 'Quotes in two days.');
      expect(accepted).toMatchObject({ status: 'accepted', chosen_option_id: chosen.id, branch_id: null, decided_by: alice.id });
      const { count: branchesAfter } = await alice.client.from('branches').select('id', { count: 'exact', head: true }).eq('model_id', modelId);
      expect(branchesAfter).toBe(branchesBefore);

      // Only the chosen option can start delivery, and staying as we are has nothing to deliver.
      await expect(workOnDecisionOption(alice.client, other.id)).rejects.toThrow(/not its chosen option/);
      await expect(workOnDecisionOption(alice.client, baseline.id)).rejects.toThrow(/not its chosen option/);

      const delivery = await workOnDecisionOption(alice.client, chosen.id);
      expect(delivery).toMatchObject({ kind: 'change', status: 'draft', intent: 'propose', title: 'Buy a quoting product' });
      const { data: after } = await alice.client.from('decisions').select('*').eq('id', decision.id).single();
      expect(after).toMatchObject({ status: 'accepted', chosen_option_id: chosen.id, branch_id: delivery.id });
      // A second press opens the same change.
      expect((await workOnDecisionOption(alice.client, chosen.id)).id).toBe(delivery.id);

      // The decision itself is still closed: starting delivery opened no other field.
      const { error: editError } = await alice.client.from('decisions').update({ title: 'Edited after delivery started' }).eq('id', decision.id);
      expect(editError).not.toBeNull();
    });

    it('choosing "Stay as we are" never starts delivery', async () => {
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Stay chosen', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const baseline = await createDecisionOption(alice.client, { decisionId: decision.id, title: 'Stay as we are', createdBy: alice.id });
      await updateDecision(alice.client, decision.id, { baselineOptionId: baseline.id });
      await chooseDecisionOption(alice.client, decision.id, baseline.id, 'No budget this year.');
      await expect(workOnDecisionOption(alice.client, baseline.id)).rejects.toThrow(/nothing to deliver/);
    });

    it('a viewer, and a signed-in user from a different organisation, cannot start delivery on a chosen option', async () => {
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Delivery boundary', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const chosen = await createDecisionOption(alice.client, { decisionId: decision.id, title: 'Build it', createdBy: alice.id });
      await chooseDecisionOption(alice.client, decision.id, chosen.id, 'Only option.');

      const outsider = await createSignedInUser('delivery-outsider');
      await expect(workOnDecisionOption(outsider.client, chosen.id)).rejects.toThrow();
      const viewer = await createSignedInUser('delivery-viewer');
      const { error: inviteError } = await alice.client.from('members').insert({ org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: alice.id });
      if (inviteError) throw new Error(`inviting viewer: ${inviteError.message}`);
      await expect(workOnDecisionOption(viewer.client, chosen.id)).rejects.toThrow();

      const { data: after } = await alice.client.from('decisions').select('branch_id').eq('id', decision.id).single();
      expect(after).toMatchObject({ branch_id: null });
      await service.auth.admin.deleteUser(outsider.id);
      await service.auth.admin.deleteUser(viewer.id);
    });
  });

  describe('updateDecision (editing a proposed decision)', () => {
    it("edits title, context, owner, needed-by and Lens map link; only the creator or an org owner/architect may; never once it's cancelled", async () => {
      const creator = await createSignedInUser('decisions-edit-creator');
      const other = await createSignedInUser('decisions-edit-other');
      for (const u of [creator, other]) {
        const { error } = await alice.client.from('members').insert({ org_id: orgId, user_id: u.id, role: 'contributor', invited_by: alice.id });
        if (error) throw new Error(`inviting: ${error.message}`);
      }
      const decision = await createDecision(creator.client, { id: randomUUID(), orgId, modelId, title: 'Typo in titel', statement: '', ownerId: creator.id, createdBy: creator.id });

      const edited = await updateDecision(creator.client, decision.id, { title: 'Typo fixed', statement: 'Now with context.', ownerId: alice.id, neededBy: '2026-12-31', lensMapUrl: 'https://lens.example/map/1' });
      expect(edited).toMatchObject({ title: 'Typo fixed', statement: 'Now with context.', owner_id: alice.id, needed_by: '2026-12-31', lens_map_url: 'https://lens.example/map/1', status: 'proposed' });
      expect(await updateDecision(creator.client, decision.id, { neededBy: null, lensMapUrl: null })).toMatchObject({ needed_by: null, lens_map_url: null });

      // Another contributor can't; an org owner can.
      await expect(updateDecision(other.client, decision.id, { title: 'Not mine' })).rejects.toThrow(/can no longer be edited, or you are not allowed/);
      expect(await updateDecision(alice.client, decision.id, { title: 'Owner tidy-up' })).toMatchObject({ title: 'Owner tidy-up' });

      // Closed once cancelled.
      await cancelDecision(alice.client, decision.id, 'Done with it.');
      await expect(updateDecision(alice.client, decision.id, { title: 'After cancelling' })).rejects.toThrow();

      await service.auth.admin.deleteUser(creator.id);
      await service.auth.admin.deleteUser(other.id);
    });
  });

  describe('atlas.cancel_decision (ADR-022 amendment, 2026-10-03)', () => {
    async function invite(label: string, role: 'contributor' | 'viewer') {
      const user = await createSignedInUser(label);
      const { error } = await alice.client.from('members').insert({ org_id: orgId, user_id: user.id, role, invited_by: alice.id });
      if (error) throw new Error(`inviting ${label}: ${error.message}`);
      return user;
    }

    it('cancels a proposed decision with its reason, who and when, and cancels its draft options; it is then closed to edits and to choosing', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'No longer needed', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const options = await Promise.all(
        ['cancel-a', 'cancel-b'].map((name) =>
          createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `${name}-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id }),
        ),
      );
      await Promise.all(options.map((o) => createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'branch', linkedId: o.id, createdBy: alice.id })));

      const cancelled = await cancelDecision(alice.client, decision.id, '  The vendor withdrew the product.  ');
      expect(cancelled).toMatchObject({ status: 'rejected', cancel_reason: 'The vendor withdrew the product.', decided_by: alice.id, branch_id: null });
      expect(cancelled.decided_at).not.toBeNull();
      expect(await getDecision(alice.client, decision.id)).toMatchObject({ status: 'rejected', cancel_reason: 'The vendor withdrew the product.' });

      for (const option of options) {
        expect(await getBranch(alice.client, option.id)).toMatchObject({ status: 'cancelled', cancel_reason: `Decision cancelled: see decision ${decision.id}` });
      }

      const { error: editError } = await alice.client.from('decisions').update({ title: 'Edited after cancelling' }).eq('id', decision.id);
      expect(editError).not.toBeNull();
      await expect(cancelDecision(alice.client, decision.id, 'again')).rejects.toThrow();
    });

    it('needs a reason; only the decision owner or an org owner/architect may cancel; a cancel reason is never settable by a plain insert or update', async () => {
      const contributor = await invite('decisions-cancel-contributor', 'contributor');
      const other = await invite('decisions-cancel-other', 'contributor');
      const theirs = await createDecision(contributor.client, { id: randomUUID(), orgId, modelId, title: 'Owned by a contributor', statement: '', ownerId: contributor.id, createdBy: contributor.id });

      await expect(cancelDecision(contributor.client, theirs.id, '   ')).rejects.toThrow(/say why/);
      await expect(cancelDecision(other.client, theirs.id, 'not my decision')).rejects.toThrow(/only the decision/);
      expect(await cancelDecision(contributor.client, theirs.id, 'Raised by mistake.')).toMatchObject({ status: 'rejected', decided_by: contributor.id });

      // An org owner may cancel a decision someone else owns.
      const another = await createDecision(contributor.client, { id: randomUUID(), orgId, modelId, title: 'Owner cancels', statement: '', ownerId: contributor.id, createdBy: contributor.id });
      expect(await cancelDecision(alice.client, another.id, 'Superseded by the platform strategy.')).toMatchObject({ status: 'rejected', decided_by: alice.id });

      // The column is ungranted for update, and the check constraint keeps a reason off a proposed row.
      const proposed = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Plain writes', statement: '', ownerId: alice.id, createdBy: alice.id });
      const { error: updateError } = await alice.client.from('decisions').update({ cancel_reason: 'sneaky' }).eq('id', proposed.id);
      expect(updateError).not.toBeNull();
      const { error: insertError } = await alice.client.from('decisions').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, title: 'Insert with a reason', owner_id: alice.id, created_by: alice.id, cancel_reason: 'sneaky' });
      expect(insertError).not.toBeNull();

      await service.auth.admin.deleteUser(contributor.id);
      await service.auth.admin.deleteUser(other.id);
    });

    it('the Decisions badge counts proposed decisions only: a new one adds one, cancelling takes it away', async () => {
      const before = await countProposedDecisions(alice.client, modelId);
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Counted', statement: '', ownerId: alice.id, createdBy: alice.id });
      expect(await countProposedDecisions(alice.client, modelId)).toBe(before + 1);
      await cancelDecision(alice.client, decision.id, 'Counted, then cancelled.');
      expect(await countProposedDecisions(alice.client, modelId)).toBe(before);
    });

    it('an accepted decision cannot be cancelled', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Already chosen', statement: '', ownerId: alice.id, createdBy: alice.id });
      const option = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `chosen-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'explore', mainHeadCommitId: main.head_commit_id });
      await createDecisionLink(alice.client, { decisionId: decision.id, linkedType: 'branch', linkedId: option.id, createdBy: alice.id });
      await chooseDecisionOption(alice.client, decision.id, await optionFor(alice.client, decision.id, option.id), 'The only option.');
      await expect(cancelDecision(alice.client, decision.id, 'too late')).rejects.toThrow(/only a proposed decision/);
    });
  });

  describe('listDecisionsLinkingElements (prompt pack F3 PR6, "why is this here")', () => {
    it('finds a decision linking the given element, ignores one linking an unrelated element, and dedupes a decision linked to two of the given ids at once', async () => {
      const linked = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Concerns the seeded system', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      await createDecisionLink(alice.client, { decisionId: linked.id, linkedType: 'element', linkedId: elementId, createdBy: alice.id });

      const unrelatedElementId = randomUUID();
      const unrelated = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Concerns something else entirely', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      await createDecisionLink(alice.client, { decisionId: unrelated.id, linkedType: 'element', linkedId: unrelatedElementId, createdBy: alice.id });

      // Linked to *both* ids in the query list at once — must appear exactly once, not twice.
      const dualLinked = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Concerns both the system and another id', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const secondQueriedId = randomUUID();
      await createDecisionLink(alice.client, { decisionId: dualLinked.id, linkedType: 'element', linkedId: elementId, createdBy: alice.id });
      await createDecisionLink(alice.client, { decisionId: dualLinked.id, linkedType: 'element', linkedId: secondQueriedId, createdBy: alice.id });

      const found = await listDecisionsLinkingElements(alice.client, [elementId, secondQueriedId]);
      const foundIds = found.map((f) => f.decision.id);
      expect(foundIds).toContain(linked.id);
      expect(foundIds).toContain(dualLinked.id);
      expect(foundIds).not.toContain(unrelated.id);
      expect(foundIds.filter((id) => id === dualLinked.id)).toHaveLength(1);
    });

    it('returns an empty list for an element with no decisions at all, and for an empty input list', async () => {
      expect(await listDecisionsLinkingElements(alice.client, [randomUUID()])).toEqual([]);
      expect(await listDecisionsLinkingElements(alice.client, [])).toEqual([]);
    });
  });
  describe('frozen decision packs (Phase B3)', () => {
    it('freezes numbered versions that round-trip, are never changeable, and are closed to other organisations', async () => {
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Pack me', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const first = await freezeDecisionPack(alice.client, decision.id, '# ADR: Pack me\n\nFirst.', null);
      const second = await freezeDecisionPack(alice.client, decision.id, '# ADR: Pack me\n\nSecond.', null);
      expect([first.version, second.version]).toEqual([1, 2]);
      expect(first.decision_status).toBe('proposed');
      const packs = await listDecisionPacks(alice.client, decision.id);
      expect(packs.map((p) => p.version)).toEqual([2, 1]);
      expect(packs[1]?.body_markdown).toBe('# ADR: Pack me\n\nFirst.');

      // No client can change or remove a pack, or write one around the function.
      const edited = await alice.client.from('decision_packs').update({ body_markdown: 'changed' }).eq('id', first.id).select('id');
      expect(edited.error !== null || edited.data.length === 0).toBe(true);
      const removed = await alice.client.from('decision_packs').delete().eq('id', first.id).select('id');
      expect(removed.error !== null || removed.data.length === 0).toBe(true);
      expect((await listDecisionPacks(alice.client, decision.id)).find((p) => p.id === first.id)?.body_markdown).toBe('# ADR: Pack me\n\nFirst.');

      // A signed-in user from a different organisation can neither freeze nor read.
      const mallory = await createSignedInUser('decisions-mallory');
      try {
        const otherOrg = randomUUID();
        await createOrganisation(mallory.client, { id: otherOrg, name: 'Other Org', slug: `packs-other-${otherOrg.slice(0, 8)}`, createdBy: mallory.id });
        await expect(freezeDecisionPack(mallory.client, decision.id, 'sneaky', null)).rejects.toThrow(/not found/);
        expect(await listDecisionPacks(mallory.client, decision.id)).toEqual([]);
      } finally {
        await service.auth.admin.deleteUser(mallory.id);
      }

      await expect(freezeDecisionPack(alice.client, decision.id, '   ', null)).rejects.toThrow(/check constraint/);
    });
  });
  describe('sign-off on a frozen pack (Phase C2)', () => {
    it('binds a named person and lens to the exact latest version, with the database refusing everything else', async () => {
      const decision = await createDecision(alice.client, { id: randomUUID(), orgId, modelId, title: 'Sign me', statement: 'context', ownerId: alice.id, createdBy: alice.id });
      const first = await freezeDecisionPack(alice.client, decision.id, '# ADR: Sign me\n\nFirst.', null);

      // The person who froze the pack cannot sign it (this org is not a personal one).
      await expect(recordDecisionApproval(alice.client, { packId: first.id, lens: 'architecture', verdict: 'approve' })).rejects.toThrow(/cannot sign/);

      const reviewer = await createSignedInUser('decisions-reviewer');
      const viewer = await createSignedInUser('decisions-viewer');
      const mallory = await createSignedInUser('decisions-approval-mallory');
      try {
        const reviewerMember = await service.from('members').insert({ org_id: orgId, user_id: reviewer.id, role: 'architect', invited_by: alice.id });
        expect(reviewerMember.error).toBeNull();
        const viewerMember = await service.from('members').insert({ org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: alice.id });
        expect(viewerMember.error).toBeNull();

        // A named architect signs version 1, and the row round-trips with who and when set by the database.
        const signed = await recordDecisionApproval(reviewer.client, { packId: first.id, lens: 'architecture', verdict: 'approve', comment: 'Fits the target landscape' });
        expect(signed.decided_by).toBe(reviewer.id);
        expect(signed.decision_id).toBe(decision.id);
        expect(signed.org_id).toBe(orgId);
        expect(signed.verdict).toBe('approve');
        expect((await listDecisionApprovals(alice.client, decision.id)).map((a) => a.id)).toEqual([signed.id]);

        // The same person cannot sign the same lens twice, but may sign another lens.
        await expect(recordDecisionApproval(reviewer.client, { packId: first.id, lens: 'architecture', verdict: 'decline' })).rejects.toThrow(/duplicate key/);
        await recordDecisionApproval(reviewer.client, { packId: first.id, lens: 'security', verdict: 'decline', comment: 'Needs a pen test' });

        // A viewer cannot sign at all.
        await expect(recordDecisionApproval(viewer.client, { packId: first.id, lens: 'data', verdict: 'approve' })).rejects.toThrow();

        // A signed-in user from a different organisation can neither sign nor read.
        const otherOrg = randomUUID();
        await createOrganisation(mallory.client, { id: otherOrg, name: 'Other Org', slug: `approvals-other-${otherOrg.slice(0, 8)}`, createdBy: mallory.id });
        await expect(recordDecisionApproval(mallory.client, { packId: first.id, lens: 'data', verdict: 'approve' })).rejects.toThrow(/not found/);
        expect(await listDecisionApprovals(mallory.client, decision.id)).toEqual([]);

        // Nobody can change or remove a sign-off, or write one around the trigger.
        const edited = await reviewer.client.from('decision_approvals').update({ verdict: 'approve' }).eq('id', signed.id).select('id');
        expect(edited.error !== null || edited.data.length === 0).toBe(true);
        const removed = await reviewer.client.from('decision_approvals').delete().eq('id', signed.id).select('id');
        expect(removed.error !== null || removed.data.length === 0).toBe(true);

        // A material edit is a new version: the old one can no longer be signed, and its sign-offs do not carry over.
        const second = await freezeDecisionPack(alice.client, decision.id, '# ADR: Sign me\n\nSecond.', null);
        await expect(recordDecisionApproval(reviewer.client, { packId: first.id, lens: 'delivery', verdict: 'approve' })).rejects.toThrow(/not the latest/);
        const onSecond = await recordDecisionApproval(reviewer.client, { packId: second.id, lens: 'architecture', verdict: 'approve' });
        expect(onSecond.pack_id).toBe(second.id);
        expect((await listDecisionApprovals(alice.client, decision.id)).filter((a) => a.pack_id === second.id)).toHaveLength(1);
      } finally {
        await service.auth.admin.deleteUser(reviewer.id);
        await service.auth.admin.deleteUser(viewer.id);
        await service.auth.admin.deleteUser(mallory.id);
      }
    });
  });
});

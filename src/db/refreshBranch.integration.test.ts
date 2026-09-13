/**
 * ADR-021 §5 item 5, §7 (C2b): `atlas.refresh_branch` against a real local
 * Supabase — "prepare, replay, decide" end to end, through the real
 * `pushRefresh` (never calling the RPC directly, the same discipline
 * `deltaApplyInSql.integration.test.ts` uses for its own SQL function: going
 * through the real entry point is what proves the pieces are actually wired
 * together, not just individually correct).
 *
 * Covers: the issue's own motivating scenario (retract-vs-modify, Case A,
 * keep-retraction) landing as a real preparation + merge commit pair with
 * mergeBase(B) == main.head afterward; an ordinary field-conflict-only
 * refresh (regression — every refresh now goes through this one RPC,
 * ADR-021 §5 item 5's own "one code path"); and concurrency (two
 * refresh_branch calls racing the same expected head — exactly one wins).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { toRefreshBranchParams } from '../contracts/rows';
import { foldFromGenesis } from '../engine/head';
import type { FieldConflictChoice, StructuralChoice } from '../engine/mergeResolution';
import { createChangeBranch, getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { buildCommitLoader } from './commitLoader';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { computeMergeReviewForBranch, pushRefresh } from './mergeRequests';
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

describe('atlas.refresh_branch (ADR-021, C2b) against a real local Supabase', () => {
  let alice: TestUser;
  let orgId: string;
  let modelId: string;
  let sourceId: string;

  beforeAll(async () => {
    alice = await createSignedInUser('alice-refresh-branch');
    orgId = randomUUID();
    await createOrganisation(alice.client, { id: orgId, name: 'Refresh Branch Test Org', slug: `refresh-org-${orgId.slice(0, 8)}`, createdBy: alice.id });
    modelId = randomUUID();
    await createModel(alice.client, { id: modelId, orgId, name: 'Refresh Branch Test Model', slug: `refresh-model-${modelId.slice(0, 8)}`, createdBy: alice.id });
    const source = await getOrCreateManualSource(alice.client, { id: randomUUID(), orgId, modelId, userId: alice.id });
    sourceId = source.id;
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
    await service.auth.admin.deleteUser(alice.id);
  });

  it('retract-vs-modify (Case A), keep-retraction: a real preparation + merge commit pair, mergeBase(B) == main.head afterward', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main) throw new Error('main branch was not auto-created');

    const elementId = randomUUID();
    const createDelta: Delta = { kind: 'element.create', id: randomUUID(), elementId, elementType: 'system', name: 'E', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 };
    const createResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'create E', body: null, deltas: [createDelta] },
    });
    if (!createResult.ok) throw new Error(`create commit failed: ${createResult.message}`);

    const mainAfterCreate = await getMainBranch(alice.client, modelId);
    if (!mainAfterCreate) throw new Error('main branch disappeared');

    const branch = await createChangeBranch(alice.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: `refresh-test-${randomUUID().slice(0, 8)}`,
      createdBy: alice.id,
      mainHeadCommitId: mainAfterCreate.head_commit_id,
      intent: 'record',
    });

    const retractDelta: Delta = { kind: 'element.retract', id: randomUUID(), elementId, elementType: 'system', previousDeltaId: createDelta.id, sourceId, confidence: 1 };
    const retractResult = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: branch.head_commit_id,
      envelope: { id: randomUUID(), branchId: branch.id, parentCommitId: branch.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'retract E', body: null, deltas: [retractDelta] },
    });
    if (!retractResult.ok) throw new Error(`retract commit failed: ${retractResult.message}`);

    // Main independently updates E — the exact scenario issue #76 named.
    const updateDelta: Delta = { kind: 'element.update', id: randomUUID(), elementId, elementType: 'system', attribute: 'vendor', value: 'Acme', previousDeltaId: createDelta.id, sourceId, confidence: 1 };
    const updateResult = await commitToBranch(alice.client, {
      modelId,
      branchId: mainAfterCreate.id,
      expectedHeadCommitId: mainAfterCreate.head_commit_id,
      envelope: { id: randomUUID(), branchId: mainAfterCreate.id, parentCommitId: mainAfterCreate.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'update E.vendor', body: null, deltas: [updateDelta] },
    });
    if (!updateResult.ok) throw new Error(`update commit failed: ${updateResult.message}`);

    const branchAfterRetract = await getBranch(alice.client, branch.id);
    if (!branchAfterRetract) throw new Error('branch disappeared');
    const mainAfterUpdate = await getMainBranch(alice.client, modelId);
    if (!mainAfterUpdate) throw new Error('main branch disappeared');

    const reviewResult = await computeMergeReviewForBranch(alice.client, modelId, branchAfterRetract);
    if (!reviewResult) throw new Error('no main branch to review against');
    const finding = reviewResult.review.classification.findings.find((f) => f.class === 'structural:retract-vs-modify');
    expect(finding).toBeDefined();

    const structuralChoices: StructuralChoice[] = [{ class: 'retraction', elementId, action: 'keep-retraction' }];
    const refreshResult = await pushRefresh(alice.client, {
      modelId,
      orgId,
      userId: alice.id,
      branch: branchAfterRetract,
      mainHeadCommitId: reviewResult.mainHeadCommitId,
      review: reviewResult.review,
      choices: [],
      structuralChoices,
    });
    if (!refreshResult.ok) throw new Error(`pushRefresh failed: ${refreshResult.message}`);

    const branchAfterRefresh = await getBranch(alice.client, branch.id);
    if (!branchAfterRefresh) throw new Error('branch disappeared');
    // mergeBase(B) == main.head, by construction of a successful refresh (SPEC §7.1).
    expect(branchAfterRefresh.base_commit_id).toBe(mainAfterUpdate.head_commit_id);
    expect(branchAfterRefresh.head_commit_id).toBe(refreshResult.commitId);

    // The merge commit's own parent is a real preparation commit — not the branch's own pre-refresh head directly.
    const { data: mergeCommitRow, error: mergeCommitError } = await alice.client.from('commits').select('parent_commit_id, kind').eq('id', refreshResult.commitId).single();
    if (mergeCommitError) throw new Error(`reading merge commit: ${mergeCommitError.message}`);
    expect((mergeCommitRow as { kind: string }).kind).toBe('merge');
    const prepCommitId = (mergeCommitRow as { parent_commit_id: string }).parent_commit_id;
    expect(prepCommitId).not.toBe(branchAfterRetract.head_commit_id);
    const { data: prepCommitRow, error: prepCommitError } = await alice.client.from('commits').select('kind, parent_commit_id').eq('id', prepCommitId).single();
    if (prepCommitError) throw new Error(`reading preparation commit: ${prepCommitError.message}`);
    expect((prepCommitRow as { kind: string }).kind).toBe('preparation');
    expect((prepCommitRow as { parent_commit_id: string }).parent_commit_id).toBe(branchAfterRetract.head_commit_id);

    // The branch's own resulting head: E is retracted (keep-retraction), matching the reviewer's choice.
    const loader = await buildCommitLoader(alice.client, modelId);
    const resultingHead = foldFromGenesis(branchAfterRefresh.head_commit_id, loader);
    expect(resultingHead.elements.has(elementId)).toBe(false);

    // resolved_conflicts rows were written, referencing real delta ids.
    const { data: resolvedConflictsRows, error: resolvedConflictsError } = await alice.client.from('resolved_conflicts').select('rationale').eq('model_id', modelId);
    if (resolvedConflictsError) throw new Error(`reading resolved_conflicts: ${resolvedConflictsError.message}`);
    expect((resolvedConflictsRows as { rationale: string }[]).some((r) => r.rationale === 'keep-retraction')).toBe(true);
  });

  it('an ordinary field-conflict-only refresh still works through the unified refresh_branch path (regression)', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main) throw new Error('main branch was not auto-created');

    const elementId = randomUUID();
    const createDelta: Delta = { kind: 'element.create', id: randomUUID(), elementId, elementType: 'system', name: 'F', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 };
    const createResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'create F', body: null, deltas: [createDelta] },
    });
    if (!createResult.ok) throw new Error(`create commit failed: ${createResult.message}`);
    const mainAfterCreate = await getMainBranch(alice.client, modelId);
    if (!mainAfterCreate) throw new Error('main branch disappeared');

    const branch = await createChangeBranch(alice.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: `refresh-field-conflict-${randomUUID().slice(0, 8)}`,
      createdBy: alice.id,
      mainHeadCommitId: mainAfterCreate.head_commit_id,
      intent: 'record',
    });

    const ourUpdate: Delta = { kind: 'element.update', id: randomUUID(), elementId, elementType: 'system', attribute: 'name', value: 'Renamed by branch', previousDeltaId: createDelta.id, sourceId, confidence: 1 };
    const ourResult = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: branch.head_commit_id,
      envelope: { id: randomUUID(), branchId: branch.id, parentCommitId: branch.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'rename by branch', body: null, deltas: [ourUpdate] },
    });
    if (!ourResult.ok) throw new Error(`branch update failed: ${ourResult.message}`);

    const theirUpdate: Delta = { kind: 'element.update', id: randomUUID(), elementId, elementType: 'system', attribute: 'name', value: 'Renamed by main', previousDeltaId: createDelta.id, sourceId, confidence: 1 };
    const theirResult = await commitToBranch(alice.client, {
      modelId,
      branchId: mainAfterCreate.id,
      expectedHeadCommitId: mainAfterCreate.head_commit_id,
      envelope: { id: randomUUID(), branchId: mainAfterCreate.id, parentCommitId: mainAfterCreate.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'rename by main', body: null, deltas: [theirUpdate] },
    });
    if (!theirResult.ok) throw new Error(`main update failed: ${theirResult.message}`);

    const branchAfterUpdate = await getBranch(alice.client, branch.id);
    if (!branchAfterUpdate) throw new Error('branch disappeared');
    const reviewResult = await computeMergeReviewForBranch(alice.client, modelId, branchAfterUpdate);
    if (!reviewResult) throw new Error('no main branch to review against');
    expect(reviewResult.review.classification.hasBlockingConflict).toBe(true);

    const choices: FieldConflictChoice[] = [{ subjectId: elementId, attribute: 'name', action: 'keep-theirs' }];
    const refreshResult = await pushRefresh(alice.client, {
      modelId,
      orgId,
      userId: alice.id,
      branch: branchAfterUpdate,
      mainHeadCommitId: reviewResult.mainHeadCommitId,
      review: reviewResult.review,
      choices,
    });
    if (!refreshResult.ok) throw new Error(`pushRefresh failed: ${refreshResult.message}`);

    const branchAfterRefresh = await getBranch(alice.client, branch.id);
    if (!branchAfterRefresh) throw new Error('branch disappeared');
    // No structural finding here, so no preparation commit — the merge commit's own parent is the branch's pre-refresh head directly.
    const { data: mergeCommitRow, error: mergeCommitError } = await alice.client.from('commits').select('parent_commit_id, kind').eq('id', refreshResult.commitId).single();
    if (mergeCommitError) throw new Error(`reading merge commit: ${mergeCommitError.message}`);
    expect((mergeCommitRow as { kind: string }).kind).toBe('merge');
    expect((mergeCommitRow as { parent_commit_id: string }).parent_commit_id).toBe(branchAfterUpdate.head_commit_id);

    const loader = await buildCommitLoader(alice.client, modelId);
    const resultingHead = foldFromGenesis(branchAfterRefresh.head_commit_id, loader);
    expect(resultingHead.elements.get(elementId)?.name).toBe('Renamed by main');
  });

  it('concurrency: two refresh_branch calls with the same expected head — exactly one ok, the other stale_head', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main) throw new Error('main branch was not auto-created');

    const branch = await createChangeBranch(alice.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: `refresh-concurrency-${randomUUID().slice(0, 8)}`,
      createdBy: alice.id,
      mainHeadCommitId: main.head_commit_id,
      intent: 'record',
    });

    const callRefresh = async () => {
      const params = toRefreshBranchParams({
        branchId: branch.id,
        expectedHeadCommitId: branch.head_commit_id,
        mainHeadCommitId: main.head_commit_id,
        prepCommit: null,
        mergeCommit: { id: randomUUID(), title: 'Refresh from main', deltas: [] },
        resolvedConflicts: [],
      });
      return alice.client.schema('atlas').rpc('refresh_branch', params as unknown as Record<string, unknown>);
    };

    const [first, second] = await Promise.all([callRefresh(), callRefresh()]);
    const statuses = [first, second].map((r) => (r.error ? 'error' : (r.data as { status: string }).status));
    expect(statuses.filter((s) => s === 'ok')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'stale_head')).toHaveLength(1);
  });
});

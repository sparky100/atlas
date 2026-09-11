/**
 * Integration tests for Sprint C2 (Prompt 7b) step 7's own two
 * independent, small pieces folded in from the C1 audit
 * (docs/AUDIT-2026-09-C1.md §3 invariant 1 / §4 case 1):
 *  - SPEC §10.2 P-18: an identity-warning dismissal persists server-side
 *    (`atlas.dismiss_identity_pair`, `20260911030000_persist_identity_dismissals.sql`)
 *    rather than only for the browser session that clicked "Keep both".
 *  - A genuinely concurrent refresh (two `Promise.all`'d pushes against
 *    the same starting head, not sequential `await`s) — exactly one
 *    wins, the C13 optimistic-concurrency guard every other commit path
 *    already relies on.
 *
 * Same "needs a running `supabase start`" limitation as
 * `src/db/repository.integration.test.ts`'s own module comment.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { createChangeBranch, getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { createModel } from './models';
import { loadEnv } from './env';
import { computeMergeReviewForBranch, dismissIdentityPair, getMergeRequestById, pushRefresh, submitMergeRequest } from './mergeRequests';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';

const env = loadEnv();
const service = createServiceRoleClient(env);

async function createSignedInUser(label: string): Promise<{ id: string; client: Client }> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);
  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);
  return { id: created.user.id, client: signIn };
}

function makeSystem(id: string, elementId: string, name: string, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 };
}

describe('review queue hardening against a real local Supabase (Sprint C2 step 7)', () => {
  let alice: { id: string; client: Client };
  let orgId: string;
  let modelId: string;
  let sourceId: string;

  beforeAll(async () => {
    alice = await createSignedInUser('reviewhardening-alice');
    orgId = randomUUID();
    await createOrganisation(alice.client, { id: orgId, name: 'Review Hardening Test Org', slug: `reviewhardening-${orgId.slice(0, 8)}`, createdBy: alice.id });
    modelId = randomUUID();
    await createModel(alice.client, { id: modelId, orgId, name: 'Review Hardening Test Model', slug: `reviewhardening-model-${modelId.slice(0, 8)}`, createdBy: alice.id });
    const source = await getOrCreateManualSource(alice.client, { id: randomUUID(), orgId, modelId, userId: alice.id });
    sourceId = source.id;
  });

  afterAll(async () => {
    await service.auth.admin.deleteUser(alice.id);
  });

  it('P-18: an identity-pair dismissal persists across a fresh fetch, and dismissing the same pair twice is a no-op', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const branch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `identity-dismiss-${randomUUID().slice(0, 8)}`, createdBy: alice.id, mainHeadCommitId: main.head_commit_id });
    if (!branch.head_commit_id) throw new Error('branch has no head at creation');

    const oursId = randomUUID();
    const commitResult = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: branch.head_commit_id,
      envelope: { id: randomUUID(), branchId: branch.id, parentCommitId: branch.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'add Alpha System', body: null, deltas: [makeSystem(randomUUID(), oursId, 'Alpha System', sourceId)] },
    });
    expect(commitResult).toMatchObject({ ok: true });

    const theirsId = randomUUID();
    const mainCommitResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'add Alpha System too', body: null, deltas: [makeSystem(randomUUID(), theirsId, 'Alpha System', sourceId)] },
    });
    expect(mainCommitResult).toMatchObject({ ok: true });

    const branchAfterCommit = await getBranch(alice.client, branch.id);
    if (!branchAfterCommit) throw new Error('branch not found after commit');
    const computed = await computeMergeReviewForBranch(alice.client, modelId, branchAfterCommit);
    if (!computed) throw new Error('could not compute merge review');
    const identityFinding = computed.review.classification.findings.find((f) => f.class === 'identity');
    expect(identityFinding).toBeDefined();

    const requestId = randomUUID();
    const request = await submitMergeRequest(alice.client, requestId, branch.id, computed.review);
    expect(request.dismissed_identity_pairs).toEqual([]);

    const pairKey = [identityFinding?.subjectId, identityFinding?.relatedSubjectId].sort().join(' ');
    await dismissIdentityPair(alice.client, requestId, pairKey);

    // A fresh fetch (a different reviewer opening the same request, or a
    // reload) sees the dismissal, not the local-only state SPEC §10.2's
    // own gap named.
    const refetched = await getMergeRequestById(alice.client, requestId);
    expect(refetched?.dismissed_identity_pairs).toEqual([pairKey]);

    // Idempotent: dismissing the same pair again doesn't duplicate it.
    await dismissIdentityPair(alice.client, requestId, pairKey);
    const refetchedAgain = await getMergeRequestById(alice.client, requestId);
    expect(refetchedAgain?.dismissed_identity_pairs).toEqual([pairKey]);
  });

  it('adversarial case 1 (docs/AUDIT-2026-09-C1.md §4): two genuinely concurrent refreshes (Promise.all, not sequential) against the same starting head — exactly one wins', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const branch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `concurrent-refresh-${randomUUID().slice(0, 8)}`, createdBy: alice.id, mainHeadCommitId: main.head_commit_id });
    if (!branch.head_commit_id) throw new Error('branch has no head at creation');

    // Main advances after the branch forks — a real refresh is needed,
    // not the zero-delta "already up to date" case.
    const mainAdvanceResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'advance main', body: null, deltas: [makeSystem(randomUUID(), randomUUID(), 'Main Only System', sourceId)] },
    });
    expect(mainAdvanceResult).toMatchObject({ ok: true });
    const mainAfterAdvance = await getMainBranch(alice.client, modelId);
    if (!mainAfterAdvance?.head_commit_id) throw new Error('main branch not found after advance');

    const computed = await computeMergeReviewForBranch(alice.client, modelId, branch);
    if (!computed) throw new Error('could not compute merge review');
    expect(computed.review.threeWay.upToDateWithMain).toBe(false);

    // Both refreshes start from the exact same `branch` object (the same
    // `head_commit_id`) and race via Promise.all — the real adversarial
    // case, not two sequential `await`s with the second one already
    // seeing a moved head.
    const mainAfterAdvanceHeadCommitId = mainAfterAdvance.head_commit_id;
    const pushOnce = () =>
      pushRefresh(alice.client, {
        modelId,
        orgId,
        userId: alice.id,
        branch,
        mainHeadCommitId: mainAfterAdvanceHeadCommitId,
        review: computed.review,
        choices: [],
      });
    const [first, second] = await Promise.all([pushOnce(), pushOnce()]);

    // Exactly one of the two concurrent pushes wins — the C13 optimistic-
    // concurrency guard every other commit path already relies on, now
    // proven for a genuinely concurrent (Promise.all, not sequential)
    // refresh specifically.
    expect(first.ok !== second.ok).toBe(true);
    const failed = first.ok ? second : first;
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.reason).toBe('conflict');

    // The branch itself ends up with exactly one more commit than it
    // started with (the winner's), not two, and not zero.
    const branchAfterRace = await getBranch(alice.client, branch.id);
    expect(branchAfterRace?.head_commit_id).not.toBe(branch.head_commit_id);
  });
});

/**
 * Integration tests for Sprint M1a's comments backend — profiles, comments,
 * threads, resolve, @mentions, notifications, unresolved counts, and
 * realtime — against a real local Supabase. See
 * src/db/repository.integration.test.ts's own module comment for why this
 * needs a running `supabase start` and cannot run inside the authoring
 * sandbox; the same real-auth, real-RLS approach is used here.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { parseMentionHandles } from '../contracts/comments';
import { foldFromGenesis, headHash } from '../engine/head';
import { serializeHeadProjection } from '../engine/projection';
import { createChangeBranch, getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { buildCommitLoader } from './commitLoader';
import { commitToBranch } from './commits';
import { createComment, editCommentBody, getThreadCounts, listCommentsForAnchor, reopenComment, resolveComment } from './comments';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';
import { listMyNotifications, getUnreadNotificationCount, markNotificationRead } from './notifications';
import { getProfile } from './profiles';
import { subscribeToModelChannel } from './realtime';
import { getOrCreateManualSource } from './sources';
import { upsertUserPreferences } from './userPreferences';

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

function makeRetractDelta(id: string, elementId: string, previousDeltaId: string, sourceId: string): Delta {
  return { kind: 'element.retract', id, elementId, elementType: 'system', previousDeltaId, sourceId, confidence: 1 };
}

describe('comments, mentions, notifications, and realtime against a real local Supabase', () => {
  let alice: TestUser; // owner
  let bob: TestUser; // contributor
  let carol: TestUser; // viewer
  let dave: TestUser; // a second contributor, for the resolve-permission matrix
  let orgId: string;
  let modelId: string;
  let aliceManualSourceId: string;
  let bobHandle: string;

  beforeAll(async () => {
    alice = await createSignedInUser('alice');
    bob = await createSignedInUser('bob');
    carol = await createSignedInUser('carol');
    dave = await createSignedInUser('dave');

    orgId = randomUUID();
    await createOrganisation(alice.client, { id: orgId, name: 'Comments Test Org', slug: `comments-test-${orgId.slice(0, 8)}`, createdBy: alice.id });

    modelId = randomUUID();
    await createModel(alice.client, { id: modelId, orgId, name: 'Comments Test Model', slug: `comments-test-model-${modelId.slice(0, 8)}`, createdBy: alice.id });

    const manualSource = await getOrCreateManualSource(alice.client, { id: randomUUID(), orgId, modelId, userId: alice.id });
    aliceManualSourceId = manualSource.id;

    const { error: inviteBobError } = await alice.client.from('members').insert({ org_id: orgId, user_id: bob.id, role: 'contributor', invited_by: alice.id });
    if (inviteBobError) throw new Error(`invite bob: ${inviteBobError.message}`);
    const { error: inviteCarolError } = await alice.client.from('members').insert({ org_id: orgId, user_id: carol.id, role: 'viewer', invited_by: alice.id });
    if (inviteCarolError) throw new Error(`invite carol: ${inviteCarolError.message}`);
    const { error: inviteDaveError } = await alice.client.from('members').insert({ org_id: orgId, user_id: dave.id, role: 'contributor', invited_by: alice.id });
    if (inviteDaveError) throw new Error(`invite dave: ${inviteDaveError.message}`);

    // atlas.ensure_profile fires on the `members` insert above — bob's
    // handle is derived from his own generated email, not something this
    // test can predict, so read it back rather than guessing.
    const bobProfile = await getProfile(alice.client, bob.id);
    if (!bobProfile) throw new Error('bob has no profile after joining the org');
    bobHandle = bobProfile.handle;
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
    await service.auth.admin.deleteUser(alice.id);
    await service.auth.admin.deleteUser(bob.id);
    await service.auth.admin.deleteUser(carol.id);
    await service.auth.admin.deleteUser(dave.id);
  });

  // ---------------------------------------------------------------------
  // Realtime. Known local-environment characteristic, not a defect in
  // src/db/realtime.ts: the very first postgres_changes subscription made
  // immediately after "supabase db reset" (which restarts the local
  // Realtime container) can join and even report SUBSCRIBED, with the
  // wait:true server-side confirmation this module's own comment names,
  // and still never deliver an event — the container's internal cluster
  // registry ("Muster") reaches its own ready state noticeably later than
  // any individual channel's own join confirmation (observed roughly 15 to
  // 20 seconds after restart via "docker logs supabase_realtime_atlas").
  // Every subscription made after that point — including this exact same
  // test, same code, run a second time with no reset in between — passes
  // in under a second. This only ever reproduces as "reset the database,
  // then immediately run tests," which real CI never does (supabase start
  // runs once, before any test) and production never approaches (a
  // long-lived cluster). If this test ever fails locally right after a
  // supabase db reset, rerun it without resetting again first.
  // ---------------------------------------------------------------------

  it('two clients on the same model channel each see a comment the other inserts', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const elementId = randomUUID();
    await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'add a system for the realtime test',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Realtime Test System', aliceManualSourceId)],
      },
    });

    const seenByAlice: string[] = [];
    const seenByBob: string[] = [];
    let aliceResynced = false;
    let bobResynced = false;

    const aliceHandle = subscribeToModelChannel(alice.client, modelId, alice.id, 'main', {
      onCommentInsert: (comment) => seenByAlice.push(comment.id),
      onResync: () => {
        aliceResynced = true;
      },
    });
    const bobHandleChannel = subscribeToModelChannel(bob.client, modelId, bob.id, 'main', {
      onCommentInsert: (comment) => seenByBob.push(comment.id),
      onResync: () => {
        bobResynced = true;
      },
    });

    try {
      // subscribeToModelChannel sets `postgres_changes_options: { wait: true }`
      // precisely so `onResync` (fired from the SUBSCRIBED callback) means
      // the server's postgres_changes binding is actually live, not just
      // that the channel joined — wait for both before posting, rather than
      // a fixed sleep.
      await expect.poll(() => aliceResynced && bobResynced, { timeout: 10_000, interval: 100 }).toBe(true);

      const comment = await createComment(bob.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, body: 'seen over the wire', authorId: bob.id });

      await expect
        .poll(() => seenByAlice.includes(comment.id) && seenByBob.includes(comment.id), { timeout: 10_000, interval: 200 })
        .toBe(true);
    } finally {
      await aliceHandle.unsubscribe();
      await bobHandleChannel.unsubscribe();
    }
  }, 30_000);

  // ---------------------------------------------------------------------
  // atlas.profiles
  // ---------------------------------------------------------------------

  it('atlas.ensure_profile creates a profile on first membership, with a handle derived from the email local part', async () => {
    const profile = await getProfile(alice.client, bob.id);
    expect(profile).toMatchObject({ user_id: bob.id, handle: bobHandle });
    expect(profile?.handle).toMatch(/^[a-z0-9_-]+$/);
  });

  it('a profile is readable by a fellow org member but never carries an email column', async () => {
    const asCarol = await getProfile(carol.client, bob.id);
    expect(asCarol).not.toBeNull();
    expect(asCarol).not.toHaveProperty('email');
  });

  it('a profile is editable only by its own user', async () => {
    const { error } = await bob.client.schema('atlas').from('profiles').update({ display_name: 'Bobby' }).eq('user_id', alice.id);
    // RLS silently filters rows the caller can't touch rather than erroring —
    // the update itself succeeds, but affects zero rows.
    expect(error).toBeNull();
    const aliceProfile = await getProfile(alice.client, alice.id);
    expect(aliceProfile?.display_name).not.toBe('Bobby');
  });

  // ---------------------------------------------------------------------
  // Anchors, threads, and RLS visibility
  // ---------------------------------------------------------------------

  it('atlas.check_anchor rejects a comment anchored to an element that was never created', async () => {
    await expect(
      createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: randomUUID(), body: 'a comment on nothing', authorId: alice.id }),
    ).rejects.toThrow();
  }, 30_000);

  it('a viewer cannot see a comment anchored to an element that only exists on a draft (non-shared) branch, but a contributor can', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const branch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: 'viewer-visibility-check', createdBy: alice.id, intent: 'propose', mainHeadCommitId: main.head_commit_id });
    if (!branch.head_commit_id) throw new Error('branch has no head at creation');

    const elementId = randomUUID();
    const commitResult = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: branch.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: branch.id,
        parentCommitId: branch.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'add Draft-Only System',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Draft-Only System', aliceManualSourceId)],
      },
    });
    expect(commitResult).toMatchObject({ ok: true });

    await createComment(bob.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, branchId: branch.id, body: 'looks good so far', authorId: bob.id });

    const asContributor = await listCommentsForAnchor(bob.client, modelId, 'element', elementId);
    expect(asContributor.threads).toHaveLength(1);

    const asViewer = await listCommentsForAnchor(carol.client, modelId, 'element', elementId);
    expect(asViewer.threads).toHaveLength(0);
  }, 30_000);

  it('replies are flat and must share their root comment\'s anchor', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');

    const elementId = randomUUID();
    const otherElementId = randomUUID();
    const commitResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'add two systems for the flat-reply-chain test',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Reply Chain System', aliceManualSourceId), makeCreateDelta(randomUUID(), otherElementId, 'A Different System', aliceManualSourceId)],
      },
    });
    expect(commitResult).toMatchObject({ ok: true });

    const root = await createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, body: 'root comment', authorId: alice.id });
    const reply = await createComment(bob.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, parentCommentId: root.id, body: 'a reply', authorId: bob.id });
    expect(reply.parent_comment_id).toBe(root.id);

    await expect(
      createComment(bob.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, parentCommentId: reply.id, body: 'a reply to a reply', authorId: bob.id }),
    ).rejects.toThrow();

    await expect(
      createComment(bob.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: otherElementId, parentCommentId: root.id, body: 'a reply with the wrong anchor', authorId: bob.id }),
    ).rejects.toThrow();

    const thread = await listCommentsForAnchor(alice.client, modelId, 'element', elementId);
    expect(thread.threads).toHaveLength(1);
    expect(thread.threads[0]?.replies).toHaveLength(1);
  }, 30_000);

  // ---------------------------------------------------------------------
  // Survival: merge and refresh (rebase)
  // ---------------------------------------------------------------------

  it('a comment on a branch element survives merge to main, still listed on the element, and becomes visible to a viewer once merged', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const branch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: 'comment-survives-merge', createdBy: alice.id, intent: 'propose', mainHeadCommitId: main.head_commit_id });
    if (!branch.head_commit_id) throw new Error('branch has no head at creation');

    const elementId = randomUUID();
    const commitResult = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: branch.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: branch.id,
        parentCommitId: branch.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'add Merge Survivor System',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Merge Survivor System', aliceManualSourceId)],
      },
    });
    expect(commitResult).toMatchObject({ ok: true });
    const branchAfterCommit = await getBranch(alice.client, branch.id);
    if (!branchAfterCommit?.head_commit_id) throw new Error('branch has no head after commit');

    const comment = await createComment(bob.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, branchId: branch.id, body: 'this one should survive the merge', authorId: bob.id });

    // Comments never block a merge (ADR-006, UI-principles §7.3) — this
    // open, unresolved thread is still sitting here when the merge below
    // succeeds; atlas.merge_branch never looks at `comments` at all.
    const requestId = randomUUID();
    const { error: submitError } = await alice.client.schema('atlas').rpc('submit_merge_request', { p_id: requestId, p_branch_id: branch.id, p_classification: { hasBlockingConflict: false } });
    expect(submitError).toBeNull();
    const { error: approveError } = await alice.client.schema('atlas').rpc('approve_merge_request', { p_merge_request_id: requestId });
    expect(approveError).toBeNull();

    // Same real fold-and-project the engine already does for any main
    // commit (repository.integration.test.ts's own "full submit -> approve
    // -> merge path" test), not a hand-rolled elements_head row.
    const loader = await buildCommitLoader(alice.client, modelId);
    const mergedHead = foldFromGenesis(branchAfterCommit.head_commit_id, loader);
    const projection = serializeHeadProjection(mergedHead);
    const { error: mergeError } = await alice.client.schema('atlas').rpc('merge_branch', {
      p_merge_request_id: requestId,
      p_commit_id: randomUUID(),
      p_title: 'merge comment-survives-merge',
      p_elements_head: projection.elementsHead,
      p_relationships_head: projection.relationshipsHead,
      p_facts: projection.facts,
      p_head_hash: headHash(mergedHead),
    });
    expect(mergeError).toBeNull();

    const afterMerge = await listCommentsForAnchor(bob.client, modelId, 'element', elementId);
    expect(afterMerge.threads).toHaveLength(1);
    expect(afterMerge.threads[0]?.root.id).toBe(comment.id);
    expect(afterMerge.threads[0]?.root.body).toBe('this one should survive the merge');

    // RT-8: the anchor is the same elements_head row's element_id, now
    // reachable from main's ancestry — a viewer who couldn't see the
    // draft-branch comment above now can, with zero re-anchoring.
    const asViewerAfterMerge = await listCommentsForAnchor(carol.client, modelId, 'element', elementId);
    expect(asViewerAfterMerge.threads).toHaveLength(1);
  }, 30_000);

  it('a comment on a branch element is unchanged by a refresh (rebase) pulling main forward', async () => {
    const mainBeforeFork = await getMainBranch(alice.client, modelId);
    if (!mainBeforeFork?.head_commit_id) throw new Error('main branch not found');
    const branch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: 'comment-survives-refresh', createdBy: alice.id, intent: 'propose', mainHeadCommitId: mainBeforeFork.head_commit_id });
    if (!branch.head_commit_id) throw new Error('branch has no head at creation');

    const elementId = randomUUID();
    const commitResult = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: branch.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: branch.id,
        parentCommitId: branch.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'add Refresh Survivor System',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Refresh Survivor System', aliceManualSourceId)],
      },
    });
    expect(commitResult).toMatchObject({ ok: true });
    const branchAfterCommit = await getBranch(alice.client, branch.id);
    if (!branchAfterCommit?.head_commit_id) throw new Error('branch has no head after commit');

    const comment = await createComment(bob.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, branchId: branch.id, body: 'this one should survive a refresh', authorId: bob.id });

    // Advance main out from under the branch's fork point.
    const mainAdvance = await commitToBranch(alice.client, {
      modelId,
      branchId: mainBeforeFork.id,
      expectedHeadCommitId: mainBeforeFork.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: mainBeforeFork.id,
        parentCommitId: mainBeforeFork.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'advance main past the branch fork point',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), randomUUID(), 'Refreshed-In System', aliceManualSourceId)],
      },
    });
    expect(mainAdvance).toMatchObject({ ok: true });
    const mainAfterAdvance = await getMainBranch(alice.client, modelId);
    if (!mainAfterAdvance?.head_commit_id) throw new Error('main branch not found after advancing');

    // The refresh itself: kind = 'merge' on the branch, pulling main's new
    // head in, zero deltas of its own (S-11).
    const { error: refreshError } = await alice.client.schema('atlas').rpc('commit_deltas', {
      p_commit_id: randomUUID(),
      p_model_id: modelId,
      p_branch_id: branch.id,
      p_base_commit_id: branchAfterCommit.head_commit_id,
      p_kind: 'merge',
      p_title: 'refresh: pull main into the branch',
      p_deltas: [],
      p_merged_branch_head_commit_id: mainAfterAdvance.head_commit_id,
    });
    expect(refreshError).toBeNull();

    const afterRefresh = await listCommentsForAnchor(bob.client, modelId, 'element', elementId);
    expect(afterRefresh.threads).toHaveLength(1);
    expect(afterRefresh.threads[0]?.root.id).toBe(comment.id);
    expect(afterRefresh.threads[0]?.root.body).toBe('this one should survive a refresh');
  }, 30_000);

  it('a comment on a retracted element is readable from history and flagged as anchored to a retracted subject', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');

    const elementId = randomUUID();
    const createDeltaId = randomUUID();
    const createResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'add To-Be-Retracted System',
        body: null,
        deltas: [makeCreateDelta(createDeltaId, elementId, 'To-Be-Retracted System', aliceManualSourceId)],
      },
    });
    expect(createResult).toMatchObject({ ok: true });
    const mainAfterCreate = await getMainBranch(alice.client, modelId);
    if (!mainAfterCreate?.head_commit_id) throw new Error('main branch not found after create');

    const retractResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: mainAfterCreate.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: mainAfterCreate.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'retract To-Be-Retracted System',
        body: null,
        deltas: [makeRetractDelta(randomUUID(), elementId, createDeltaId, aliceManualSourceId)],
      },
    });
    expect(retractResult).toMatchObject({ ok: true });

    // Posting a comment on an already-retracted element still succeeds —
    // the anchor existed (rule 5: nothing is ever deleted).
    const comment = await createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, body: 'commenting on something already gone', authorId: alice.id });
    expect(comment.id).toBeTruthy();

    const result = await listCommentsForAnchor(alice.client, modelId, 'element', elementId);
    expect(result.threads).toHaveLength(1);
    expect(result.anchorRetracted).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------------
  // Resolve permission matrix
  // ---------------------------------------------------------------------

  it('resolve permission matrix: the author edits their own body; a contributor resolves their own thread but not another\'s; an owner/architect resolves any thread', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const elementId = randomUUID();
    const commitResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'add Resolve Matrix System',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Resolve Matrix System', aliceManualSourceId)],
      },
    });
    expect(commitResult).toMatchObject({ ok: true });

    // Bob's own thread: he can edit its body and resolve/reopen it himself.
    const bobsThread = await createComment(bob.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, body: 'bobs original wording', authorId: bob.id });
    const edited = await editCommentBody(bob.client, bobsThread.id, 'bobs corrected wording');
    expect(edited.body).toBe('bobs corrected wording');
    expect(edited.edited_at).not.toBeNull();

    // Dave, a fellow contributor but not this thread's author, may not edit its body...
    await expect(editCommentBody(dave.client, bobsThread.id, 'daves attempted edit')).rejects.toThrow();

    // ...nor resolve it.
    await expect(resolveComment(dave.client, { commentId: bobsThread.id, resolvedBy: dave.id })).rejects.toThrow();

    // Bob resolves his own thread himself.
    const resolvedByBob = await resolveComment(bob.client, { commentId: bobsThread.id, resolvedBy: bob.id });
    expect(resolvedByBob).toMatchObject({ status: 'resolved', resolved_by: bob.id });

    // Dave's own separate thread: Dave (a contributor, not the owner/architect)
    // cannot resolve it — only its own author, or an owner/architect, can.
    const davesThread = await createComment(dave.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, body: 'daves thread', authorId: dave.id });
    await expect(resolveComment(bob.client, { commentId: davesThread.id, resolvedBy: bob.id })).rejects.toThrow();

    // Alice, an owner, resolves Dave's thread despite not being its author.
    const resolvedByAlice = await resolveComment(alice.client, { commentId: davesThread.id, resolvedBy: alice.id });
    expect(resolvedByAlice).toMatchObject({ status: 'resolved', resolved_by: alice.id });

    // Reopening follows the same matrix — Alice (owner) may reopen Bob's
    // already-resolved thread even though she didn't resolve it herself.
    const reopened = await reopenComment(alice.client, bobsThread.id);
    expect(reopened).toMatchObject({ status: 'open', resolved_by: null, resolved_at: null });

    // A reply never carries its own resolution state — only a thread's
    // root does (checked both by the CHECK constraint and the trigger).
    const reply = await createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, parentCommentId: davesThread.id, body: 'a reply', authorId: alice.id });
    await expect(resolveComment(alice.client, { commentId: reply.id, resolvedBy: alice.id })).rejects.toThrow();
  }, 30_000);

  it('a viewer cannot post a comment at all', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const elementId = randomUUID();
    await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'add a system for the viewer-cannot-post test',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Viewer Cannot Post System', aliceManualSourceId)],
      },
    });

    await expect(createComment(carol.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, body: 'viewers cannot do this', authorId: carol.id })).rejects.toThrow();
  }, 30_000);

  // ---------------------------------------------------------------------
  // @mentions and notifications
  // ---------------------------------------------------------------------

  it('an @handle mention creates a comment_mentions row and one notification for the mentioned member, in-app only', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const elementId = randomUUID();
    await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'add a system for the mentions test',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Mentions Test System', aliceManualSourceId)],
      },
    });

    const before = await getUnreadNotificationCount(bob.client, bob.id);

    const body = `hey @${bobHandle}, can you take a look? cc @not-a-real-handle`;
    expect(parseMentionHandles(body)).toEqual([bobHandle, 'not-a-real-handle']);

    const comment = await createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, body, authorId: alice.id });

    const { data: mentionRows, error: mentionError } = await alice.client.from('comment_mentions').select('comment_id, user_id').eq('comment_id', comment.id);
    if (mentionError) throw new Error(`reading comment_mentions: ${mentionError.message}`);
    expect(mentionRows).toMatchObject([{ comment_id: comment.id, user_id: bob.id }]);

    const after = await getUnreadNotificationCount(bob.client, bob.id);
    expect(after).toBe(before + 1);

    const notifications = await listMyNotifications(bob.client, bob.id, { unreadOnly: true });
    const thisOne = notifications.find((n) => n.comment_id === comment.id);
    expect(thisOne).toMatchObject({ kind: 'mention', user_id: bob.id, comment_id: comment.id, read_at: null });

    if (thisOne) {
      const marked = await markNotificationRead(bob.client, thisOne.id);
      expect(marked.read_at).not.toBeNull();
    }

    // Alice never notifies herself, even though she authored the comment
    // and could in principle @mention her own handle.
    const aliceProfile = await getProfile(alice.client, alice.id);
    if (aliceProfile) {
      const selfMentionBefore = await getUnreadNotificationCount(alice.client, alice.id);
      await createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, body: `@${aliceProfile.handle} noting this myself`, authorId: alice.id });
      const selfMentionAfter = await getUnreadNotificationCount(alice.client, alice.id);
      expect(selfMentionAfter).toBe(selfMentionBefore);
    }
  }, 30_000);

  it('Sprint F7 item 3: an @mention still writes comment_mentions when the recipient has opted out, but no notification', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const elementId = randomUUID();
    await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'add a system for the notification-preference test',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Notification Preference Test System', aliceManualSourceId)],
      },
    });

    await upsertUserPreferences(bob.client, { userId: bob.id, notifyOnMention: false });
    try {
      const before = await getUnreadNotificationCount(bob.client, bob.id);
      const comment = await createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, body: `@${bobHandle} opted out, should not notify`, authorId: alice.id });

      // The factual mention record still exists — opting out of the
      // notification never erases who was actually @mentioned.
      const { data: mentionRows, error: mentionError } = await alice.client.from('comment_mentions').select('comment_id, user_id').eq('comment_id', comment.id);
      if (mentionError) throw new Error(`reading comment_mentions: ${mentionError.message}`);
      expect(mentionRows).toMatchObject([{ comment_id: comment.id, user_id: bob.id }]);

      // No notification, though — the one thing the preference actually gates.
      const after = await getUnreadNotificationCount(bob.client, bob.id);
      expect(after).toBe(before);
      const notifications = await listMyNotifications(bob.client, bob.id, { unreadOnly: true });
      expect(notifications.find((n) => n.comment_id === comment.id)).toBeUndefined();
    } finally {
      // Leave bob's preferences at their default for every later test in this file.
      await upsertUserPreferences(bob.client, { userId: bob.id, notifyOnMention: true });
    }
  }, 30_000);

  it('a reply notifies the thread\'s other participants (root author + prior repliers, never the replier themselves); a reply that also @mentions a participant sends them a "mention" only, never both', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const elementId = randomUUID();
    await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'add a system for the reply-notification test',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Reply Notification Test System', aliceManualSourceId)],
      },
    });

    // Alice starts the thread. No one has replied yet, so nothing to notify
    // — a root comment is what @mentions are for, not this feature.
    const root = await createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, body: 'root comment, no mentions', authorId: alice.id });

    const aliceBefore = await getUnreadNotificationCount(alice.client, alice.id);
    const bobBeforeOwnReply = await getUnreadNotificationCount(bob.client, bob.id);
    const bobReply = await createComment(bob.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, parentCommentId: root.id, body: 'a plain reply, no mentions', authorId: bob.id });

    // Alice (the root's author) is notified; Bob never notifies himself for
    // his own reply, the same self-skip the mention loop already uses. Both
    // a delta against each user's own pre-action count, not an absolute
    // `toBe(0)`/`toBe(1)` — an earlier, unrelated test elsewhere in this
    // file may have already left either of them a legitimate unread
    // notification of their own (see the comment on `daveBeforeOwnReply`
    // below for the real case that traced to exactly this).
    const aliceAfterBobReply = await getUnreadNotificationCount(alice.client, alice.id);
    expect(aliceAfterBobReply).toBe(aliceBefore + 1);
    const bobAfterOwnReply = await getUnreadNotificationCount(bob.client, bob.id);
    expect(bobAfterOwnReply).toBe(bobBeforeOwnReply);
    const aliceNotifications = await listMyNotifications(alice.client, alice.id, { unreadOnly: true });
    expect(aliceNotifications.find((n) => n.comment_id === bobReply.id)).toMatchObject({ kind: 'reply', user_id: alice.id, comment_id: bobReply.id });

    // Dave replies next, and @mentions Bob in the same reply. Bob is now
    // both a thread participant (he replied above) and an @mention target
    // — mention wins, so he gets exactly one notification, kind "mention",
    // not two and not "reply". Alice, a participant but not mentioned,
    // still gets her "reply" notification as before.
    const aliceBeforeDaveReply = await getUnreadNotificationCount(alice.client, alice.id);
    // Prompt 7g Bug (2)'s own diagnosis traced to here: this must be a
    // delta, like every other check in this test — an *absolute* `toBe(0)`
    // for Dave below broke the moment any earlier, unrelated test in this
    // same file left Dave with a legitimate unread notification of his own
    // (the "resolve permission matrix" test's Alice-replies-to-Dave's-own-
    // thread case, line ~538, correctly notifies Dave as that thread's
    // root author — nothing to do with self-notification). The trigger
    // itself (atlas.process_comment_mentions) was never actually
    // self-notifying anyone; this test's own absolute assertion was.
    const daveBeforeOwnReply = await getUnreadNotificationCount(dave.client, dave.id);
    const daveReply = await createComment(dave.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementId, parentCommentId: root.id, body: `agreed, @${bobHandle}`, authorId: dave.id });

    const aliceAfterDaveReply = await getUnreadNotificationCount(alice.client, alice.id);
    expect(aliceAfterDaveReply).toBe(aliceBeforeDaveReply + 1);
    const aliceSecondNotification = await listMyNotifications(alice.client, alice.id, { unreadOnly: true });
    expect(aliceSecondNotification.find((n) => n.comment_id === daveReply.id)).toMatchObject({ kind: 'reply', user_id: alice.id, comment_id: daveReply.id });

    const bobNotifications = await listMyNotifications(bob.client, bob.id, { unreadOnly: true });
    const bobOnDaveReply = bobNotifications.filter((n) => n.comment_id === daveReply.id);
    expect(bobOnDaveReply).toHaveLength(1);
    expect(bobOnDaveReply[0]).toMatchObject({ kind: 'mention', user_id: bob.id, comment_id: daveReply.id });

    // Dave never notifies himself for his own reply either — no change
    // from his own pre-reply count, whatever that count already was.
    const daveAfterOwnReply = await getUnreadNotificationCount(dave.client, dave.id);
    expect(daveAfterOwnReply).toBe(daveBeforeOwnReply);
  }, 30_000);

  // ---------------------------------------------------------------------
  // thread_counts
  // ---------------------------------------------------------------------

  it('thread_counts returns open and total root-thread counts per anchor, distinguishing "all resolved" from "no comments" (M1 close-out item 1)', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const elementWithOpen = randomUUID();
    const elementWithResolvedOnly = randomUUID();
    const elementWithNone = randomUUID();
    await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'three systems for the unresolved-counts test',
        body: null,
        deltas: [
          makeCreateDelta(randomUUID(), elementWithOpen, 'Has Open Thread', aliceManualSourceId),
          makeCreateDelta(randomUUID(), elementWithResolvedOnly, 'Has Only Resolved Thread', aliceManualSourceId),
          makeCreateDelta(randomUUID(), elementWithNone, 'Has No Comments', aliceManualSourceId),
        ],
      },
    });

    const openRoot = await createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementWithOpen, body: 'still open', authorId: alice.id });
    await createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementWithOpen, parentCommentId: openRoot.id, body: 'a reply, not its own thread', authorId: alice.id });

    const resolvedRoot = await createComment(alice.client, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: elementWithResolvedOnly, body: 'already handled', authorId: alice.id });
    await resolveComment(alice.client, { commentId: resolvedRoot.id, resolvedBy: alice.id });

    const counts = await getThreadCounts(alice.client, modelId, [elementWithOpen, elementWithResolvedOnly, elementWithNone]);
    const byAnchor = new Map(counts.map((c) => [c.anchor_id, { open: c.open_count, total: c.total_count }]));

    // The reply on elementWithOpen's own thread doesn't count as a second
    // root thread — both open and total stay at 1.
    expect(byAnchor.get(elementWithOpen)).toEqual({ open: 1, total: 1 });

    // The whole point of this RPC over the one it replaced: an anchor with
    // every thread resolved is now distinguishable from one with none at
    // all — both used to be equally absent from the result.
    expect(byAnchor.get(elementWithResolvedOnly)).toEqual({ open: 0, total: 1 });
    expect(byAnchor.get(elementWithNone)).toBeUndefined();
  }, 30_000);

});

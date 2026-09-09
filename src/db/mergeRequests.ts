/**
 * Sprint C1 step 7: the merge review queue's data layer. `merge_requests`
 * queries, thin RPC wrappers over the six atlas.* lifecycle functions
 * (submit/request_changes/approve/reject/merge_branch from step 2's
 * `20260906161000_merge_review_queue.sql`, plus this step's own
 * `resubmit_merge_request`), computing a fresh `MergeReview` for a branch,
 * and pushing the field-conflict resolution commit SPEC §7.4 describes.
 *
 * Scope note: SPEC §7.4 also names bespoke structural-conflict actions
 * (keep retraction / keep element, duplicate-relationship survivor pick,
 * cardinality primary pick) and identity's "merge now" (`atlas.merge_elements`,
 * itself deferred past this sprint — SPEC §11). Building the dependency-
 * closure cascade those need ("keeping the retraction also retracts 3
 * relationships and re-parents 2 containers") is a substantial, separable
 * unit of work. This module gives a reviewer a one-click resolution for
 * field conflicts (the common case) and a real path for every other
 * conflict class: reopen the branch (`requestChanges`) and fix it with the
 * ordinary branch editor (Sprint C1 steps 3-4 — un-retract an element,
 * remove a dangling relationship, drop a duplicate), then push a refresh
 * with no resolutions of its own and resubmit. The review UI names this
 * explicitly on structural-conflict cards rather than silently omitting
 * their actions.
 *
 * Every RPC below is called via `.schema('atlas')`: these functions live
 * in the atlas schema (SPEC §2), not public, and `supabase.rpc()` on its
 * own only ever resolves against whatever schema the client is scoped to
 * (public by default) — see src/db/commits.ts's own note on this.
 */
import type { CommitEnvelope, Delta, UUID } from '../contracts/delta';
import { foldFromGenesis, headHash } from '../engine/head';
import { computeMergeReview, type MergeReview } from '../engine/merge';
import { buildFieldConflictResolutions, unresolvedFieldConflictKeys, type FieldConflictChoice } from '../engine/mergeResolution';
import { serializeHeadProjection } from '../engine/projection';
import { listAliasesForModel } from './aliases';
import { getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { buildCommitLoader } from './commitLoader';
import { commitToBranch, type CommitResult, type ResolvedConflictInput } from './commits';
import { createMergeResolutionSource } from './sources';
import type { BranchRow, MergeRequestRow } from './types';

export async function getMergeRequestById(supabase: Client, id: UUID): Promise<MergeRequestRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('merge_requests').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getMergeRequestById: ${error.message}`);
  return data as MergeRequestRow | null;
}

const OPEN_STATUSES = ['pending', 'changes_requested', 'approved'] as const;

/** At most one, by `merge_requests_one_open_per_branch_idx` (SPEC §3.4/§3.7). */
export async function getOpenMergeRequestForBranch(supabase: Client, branchId: UUID): Promise<MergeRequestRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('merge_requests').select('*').eq('branch_id', branchId).in('status', OPEN_STATUSES).maybeSingle();
  if (error) throw new Error(`getOpenMergeRequestForBranch: ${error.message}`);
  return data as MergeRequestRow | null;
}

/** The review queue's own list (UI-principles §2.4's `/review` route) — every open request on this model, oldest first (first in, first reviewed). */
export async function listOpenMergeRequestsForModel(supabase: Client, modelId: UUID): Promise<MergeRequestRow[]> {
  const { data, error } = await supabase.from('merge_requests').select('*').eq('model_id', modelId).in('status', OPEN_STATUSES).order('created_at', { ascending: true });
  if (error) throw new Error(`listOpenMergeRequestsForModel: ${error.message}`);
  return data as MergeRequestRow[];
}

export interface BranchMergeReview {
  review: MergeReview;
  /** Main's current head — distinct from `review.threeWay.mergeBaseCommitId` whenever the branch is behind (`!review.threeWay.upToDateWithMain`); a refresh's `mergedBranchHeadCommitId` needs this one, not the merge base. */
  mainHeadCommitId: UUID;
}

/**
 * The engine's own §7 computation (threeWayDiff + classifyMerge) for a
 * branch against its model's current main — everything a submit, a review-
 * queue render, or a refresh's resubmit needs. `null` when `main` itself
 * can't be found for `modelId` (nothing to compare against) — every branch
 * has a real head commit unconditionally now (ADR-018), so that's no
 * longer a reason this can return `null`.
 */
export async function computeMergeReviewForBranch(supabase: Client, modelId: UUID, branch: BranchRow): Promise<BranchMergeReview | null> {
  const main = await getMainBranch(supabase, modelId);
  if (!main) return null;

  const [loader, aliasesByElementId] = await Promise.all([buildCommitLoader(supabase, modelId), listAliasesForModel(supabase, modelId)]);
  const review = computeMergeReview(branch.head_commit_id, main.head_commit_id, loader, { aliasesByElementId });
  return { review, mainHeadCommitId: main.head_commit_id };
}

/** `merge_requests.classification` is stored as opaque jsonb — a `MergeReview.classification` serialises through `JSON.parse(JSON.stringify(...))` losslessly (plain strings/numbers/booleans/arrays/objects throughout), so this is a direct cast, not a schema-checked parse; the review queue always recomputes from commits as the source of truth (this module's own `computeMergeReviewForBranch`) rather than trusting the cache for anything but display. */
function classificationJson(review: MergeReview): Record<string, unknown> {
  return review.classification as unknown as Record<string, unknown>;
}

export async function submitMergeRequest(supabase: Client, id: UUID, branchId: UUID, review: MergeReview): Promise<MergeRequestRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('submit_merge_request', { p_id: id, p_branch_id: branchId, p_classification: classificationJson(review) });
  if (error) throw new Error(`submitMergeRequest: ${error.message}`);
  return data as MergeRequestRow;
}

/** Reopens an open request for edits (SPEC §7.4's implementation note) — a reviewer asking for changes, or the requester themselves reopening a stale/conflicted request to fix it. Moves the request to `changes_requested` and its branch back to `draft`. */
export async function requestChanges(supabase: Client, mergeRequestId: UUID, reviewNotes?: string): Promise<MergeRequestRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('request_changes', { p_merge_request_id: mergeRequestId, p_review_notes: reviewNotes ?? null });
  if (error) throw new Error(`requestChanges: ${error.message}`);
  return data as MergeRequestRow;
}

/** `changes_requested` -> `pending` with a refreshed cached classification (this step's own `atlas.resubmit_merge_request`, `20260906162000_resubmit_merge_request.sql`) — the "at each refresh" half of SPEC §7.4's "cached at request and at each refresh" that plain `submit_merge_request` can't do on an already-open row. */
export async function resubmitMergeRequest(supabase: Client, mergeRequestId: UUID, review: MergeReview): Promise<MergeRequestRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('resubmit_merge_request', { p_merge_request_id: mergeRequestId, p_classification: classificationJson(review) });
  if (error) throw new Error(`resubmitMergeRequest: ${error.message}`);
  return data as MergeRequestRow;
}

export async function approveMergeRequest(supabase: Client, mergeRequestId: UUID): Promise<MergeRequestRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('approve_merge_request', { p_merge_request_id: mergeRequestId });
  if (error) throw new Error(`approveMergeRequest: ${error.message}`);
  return data as MergeRequestRow;
}

export async function rejectMergeRequest(supabase: Client, mergeRequestId: UUID, reviewNotes?: string): Promise<MergeRequestRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('reject_merge_request', { p_merge_request_id: mergeRequestId, p_review_notes: reviewNotes ?? null });
  if (error) throw new Error(`rejectMergeRequest: ${error.message}`);
  return data as MergeRequestRow;
}

export type MergeApprovedResult = { ok: true; commitId: UUID } | { ok: false; reason: 'refresh_required' | 'error'; message: string };

/**
 * `approved` -> `merged` (SPEC §7.4's final step, `atlas.merge_branch`).
 * `branch` must be this request's own branch, freshly fetched (its
 * `head_commit_id` is what actually gets folded and hashed — the payload
 * has to match what the server re-derives inside the same transaction, or
 * `atlas.merge_branch`'s own `head_hash` check on `commit_deltas` would
 * reject it). Per SPEC §7.1: once `mergeBase(B) == main.head` (a merge
 * request's own approval precondition), the branch's own folded head *is*
 * the fully-merged result — `base == theirs` at that point, so `ours`
 * already contains everything `theirs` has, plus the branch's own deltas.
 */
export async function mergeApprovedRequest(supabase: Client, modelId: UUID, mergeRequestId: UUID, branch: BranchRow, title: string): Promise<MergeApprovedResult> {
  const loader = await buildCommitLoader(supabase, modelId);
  const mergedHead = foldFromGenesis(branch.head_commit_id, loader);
  const projection = serializeHeadProjection(mergedHead);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('merge_branch', {
    p_merge_request_id: mergeRequestId,
    p_commit_id: crypto.randomUUID(),
    p_title: title,
    p_elements_head: projection.elementsHead,
    p_relationships_head: projection.relationshipsHead,
    p_facts: projection.facts,
    p_head_hash: headHash(mergedHead),
  });
  if (error) return { ok: false, reason: 'error', message: error.message };
  // atlas.merge_branch's `returns commits` means its own `return null;` for
  // the stale case doesn't reach here as a bare JSON null — PostgREST
  // serialises a NULL composite as a row of null columns instead
  // (confirmed against a real instance, Sprint C1-H item 1). Checking the
  // row's own primary key for null is what actually detects "no commit was
  // made," in both this shape and a true null, robust to either.
  if (data === null || (data as { id: UUID | null }).id === null) {
    return { ok: false, reason: 'refresh_required', message: 'main advanced since this request was approved — it has been returned to pending for another look.' };
  }
  return { ok: true, commitId: (data as { id: UUID }).id };
}

export interface PushRefreshInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID;
  /** Must be `status === 'draft'` — reopen a proposed/approved request with `requestChanges` first. */
  branch: BranchRow;
  mainHeadCommitId: UUID;
  /** This branch's current review (for the field-conflict data the choices resolve against) — recompute it fresh, don't reuse a stale one from before other edits landed. */
  review: MergeReview;
  /** Empty is a valid refresh: pulling in main with nothing to resolve (SPEC §7.1's "then the final merge is a merge commit with zero deltas"). */
  choices: FieldConflictChoice[];
}

/**
 * SPEC §7.5's refresh, restricted to this step's field-conflict actions: a
 * `merge` commit on the branch (`parent = branch.head`, `mergedBranchHead =
 * main.head`) carrying one resolution delta per staged choice plus the
 * matching `resolved_conflicts` rows — an ordinary commit through
 * `src/db/commits.ts`'s existing path (SPEC §7.5's own implementation
 * note), not a distinct procedure. Structural conflicts this refresh
 * doesn't resolve are simply carried across unchanged, same as if the
 * reviewer had fixed them by hand before calling this. Refuses (C15) rather
 * than committing when a FIELD_CONFLICT key has no matching choice.
 */
export async function pushRefresh(supabase: Client, input: PushRefreshInput): Promise<CommitResult> {
  const { modelId, orgId, userId, branch, mainHeadCommitId, review, choices } = input;

  // SPEC §7.5's C15: every FIELD_CONFLICT key needs an explicit choice
  // before this refresh lands, or main's value would silently win with no
  // record at all (mergeResolution.ts's own comment on `apply()` never
  // re-validating `previousDeltaId`).
  const unresolved = unresolvedFieldConflictKeys(review.threeWay.fields, choices);
  if (unresolved.length > 0) {
    return { ok: false, reason: 'invalid', message: `${String(unresolved.length)} field conflict(s) still need a resolution before refreshing: ${unresolved.map((u) => `${u.subjectId}.${u.attribute}`).join(', ')}` };
  }

  let deltas: Delta[] = [];
  let resolvedConflicts: ResolvedConflictInput[] = [];
  if (choices.length > 0) {
    const sourceId = crypto.randomUUID();
    await createMergeResolutionSource(supabase, { id: sourceId, orgId, modelId, createdBy: userId, branchTitle: branch.title ?? branch.name });
    const built = buildFieldConflictResolutions(review.threeWay.fields, review.threeWay.ours, choices, sourceId, () => crypto.randomUUID());
    deltas = built.deltas;
    resolvedConflicts = built.resolvedConflicts.map((rc) => ({ id: crypto.randomUUID(), ...rc }));
  }

  const envelope: CommitEnvelope = {
    id: crypto.randomUUID(),
    branchId: branch.id,
    parentCommitId: branch.head_commit_id,
    mergedBranchHeadCommitId: mainHeadCommitId,
    kind: 'merge',
    title: deltas.length > 0 ? `Refresh from main, resolving ${String(deltas.length)} conflict(s)` : 'Refresh from main',
    body: null,
    deltas,
  };

  return commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId: branch.head_commit_id, envelope, resolvedConflicts });
}

// Re-exported so a caller building a full "resolve, refresh, resubmit" flow
// doesn't need a second import from ../db/branches just for the main head.
export { getBranch, getMainBranch };

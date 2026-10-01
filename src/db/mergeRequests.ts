/**
 * Sprint C1 step 7: the merge review queue's data layer. `merge_requests`
 * queries, thin RPC wrappers over the six atlas.* lifecycle functions
 * (submit/request_changes/approve/reject/merge_branch from step 2's
 * `20260906161000_merge_review_queue.sql`, plus this step's own
 * `resubmit_merge_request`), computing a fresh `MergeReview` for a branch,
 * and pushing the refresh SPEC §7.5 describes.
 *
 * Refresh covers both SPEC §7.4's field-conflict actions (keep this
 * change / keep main / enter a value) and its structural-conflict actions
 * (keep retraction / keep element with the dependent cascade, duplicate-
 * relationship survivor pick, cardinality primary/role pick — ADR-021,
 * C2b) — `pushRefresh` below builds both kinds of resolution off one
 * shared `merge_resolution` source and commits them atomically via
 * `atlas.refresh_branch` (ADR-021 §5 item 5). Identity's "merge now"
 * (`atlas.merge_elements`) remains deferred past this sprint (SPEC §11) —
 * "keep both" (dismiss) is the only action there.
 *
 * Every RPC below is called via `.schema('atlas')`: these functions live
 * in the atlas schema (SPEC §2), not public, and `supabase.rpc()` on its
 * own only ever resolves against whatever schema the client is scoped to
 * (public by default) — see src/db/commits.ts's own note on this.
 */
import type { Delta, UUID } from '../contracts/delta';
import { fromRefreshBranchResult, toRefreshBranchParams, type RefreshBranchCommitInput, type ResolvedConflictWireRow } from '../contracts/rows';
import { listOwnDeltas } from '../engine/branch';
import type { Head } from '../engine/deltas';
import { foldFromGenesis, headHash } from '../engine/head';
import { computeMergeReview, type MergeReview } from '../engine/merge';
import {
  buildFieldConflictResolutions,
  buildStructuralResolutions,
  unresolvedFieldConflictKeys,
  unresolvedStructuralFindings,
  type FieldConflictChoice,
  type StructuralChoice,
} from '../engine/mergeResolution';
import { serializeHeadProjection } from '../engine/projection';
import { createAlias, listAliasesForModel } from './aliases';
import { getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { buildCommitLoader } from './commitLoader';
import { getSourcesByIds } from './elements';
import { clearPendingAliases, createMergeResolutionSource } from './sources';
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

/**
 * F9 step 2: how many merge requests the review queue shows — the count
 * behind the Changes nav item's badge and the Changes page's "Review queue"
 * tab. Same rule as `useReviewQueue`: open requests only, and never a
 * `record`/`correct` change's (those merge in one click from the change
 * page, never through the shared queue — F0). One head-only request with
 * an inner join to `branches` for the intent, so no id list is ever sent
 * (CLAUDE.md rule 8).
 */
export async function countReviewQueueMergeRequests(supabase: Client, modelId: UUID): Promise<number> {
  const { count, error } = await supabase
    .from('merge_requests')
    .select('id, branches!inner(intent)', { count: 'exact', head: true })
    .eq('model_id', modelId)
    .in('status', OPEN_STATUSES)
    .not('branches.intent', 'in', '(record,correct)');
  if (error) throw new Error(`countReviewQueueMergeRequests: ${error.message}`);
  return count ?? 0;
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

export async function submitMergeRequest(supabase: Client, id: UUID, branchId: UUID, review: MergeReview, reviewers: readonly { userId: UUID; required: boolean }[] | null = null): Promise<MergeRequestRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('submit_merge_request', {
    p_id: id,
    p_branch_id: branchId,
    p_classification: classificationJson(review),
    p_reviewers: reviewers ? reviewers.map((r) => ({ user_id: r.userId, required: r.required })) : null,
  });
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

/** SPEC §10.2 P-18 (Sprint C2 step 7): persists an identity-warning "Keep both" dismissal — `pairKey` is the same sorted "<idA> <idB>" string `useReviewRequest.ts` already derives, so a reload or a different reviewer never sees the pair flagged again. `atlas.dismiss_identity_pair` (`20260911030000_persist_identity_dismissals.sql`) is append-only and idempotent — dismissing an already-dismissed pair is a no-op, not an error. */
export async function dismissIdentityPair(supabase: Client, mergeRequestId: UUID, pairKey: string): Promise<MergeRequestRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('dismiss_identity_pair', { p_merge_request_id: mergeRequestId, p_pair_key: pairKey });
  if (error) throw new Error(`dismissIdentityPair: ${error.message}`);
  return data as MergeRequestRow;
}

export type MergeApprovedResult = { ok: true; commitId: UUID; newHead: Head } | { ok: false; reason: 'refresh_required' | 'error'; message: string };

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

  // F2-lite import close-out: "aliases from same-as picks are written on
  // merge, not at import; cancel/reject leaves no alias." This is the one
  // place a merge actually lands, so it's the one place that can apply
  // them — `branch`'s own deltas (never main's, never a sibling branch's)
  // are what a spreadsheet import attached `pending_aliases` to. Best-
  // effort: a failure here never undoes the merge that already succeeded
  // above, it just leaves an alias unwritten (the same "surfaced, not
  // silent" gap ADR-008 rule 4 tolerates elsewhere — nothing that fails
  // this quietly again on the next real merge, since there won't be one).
  try {
    const ownDeltas = listOwnDeltas({ baseCommitId: branch.base_commit_id, headCommitId: branch.head_commit_id }, loader);
    const sourceIds = [...new Set(ownDeltas.map((d) => d.sourceId))];
    if (sourceIds.length > 0) {
      const sourcesById = await getSourcesByIds(supabase, sourceIds);
      for (const source of sourcesById.values()) {
        if (source.kind !== 'spreadsheet' || source.pending_aliases.length === 0) continue;
        for (const alias of source.pending_aliases) {
          await createAlias(supabase, { id: crypto.randomUUID(), orgId: source.org_id, modelId, elementId: alias.elementId, aliasValue: alias.aliasValue, aliasType: 'name', sourceId: source.id, createdBy: source.created_by });
        }
        await clearPendingAliases(supabase, source.id);
      }
    }
  } catch {
    // The merge already succeeded (the RPC above committed) — an alias is
    // a convenience for the *next* import/search, never a fact this merge
    // itself depends on, so a failure here is swallowed rather than
    // reported as a merge failure it isn't.
  }

  return { ok: true, commitId: (data as { id: UUID }).id, newHead: mergedHead };
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
  /** ADR-021 §4, C2b — one per blocking structural finding the reviewer has resolved. Empty (the default) when the branch has no structural findings, or none are resolved yet — `unresolvedStructuralFindings` still refuses the push either way. */
  structuralChoices?: StructuralChoice[];
}

/**
 * SPEC §7.5's refresh: "prepare, replay, decide" (ADR-021 §2, §3.3, C2b) —
 * one shared `merge_resolution` source, `buildFieldConflictResolutions` and
 * `buildStructuralResolutions` both driven by it, then one call to
 * `atlas.refresh_branch` (ADR-021 §5 item 5) that writes the optional
 * `preparation` commit and the `merge` commit atomically. Every refresh
 * goes through this one RPC now, prep-commit or not, rather than keeping
 * the old single-`commit_deltas` path as a special case for the empty-`P`
 * majority (ADR-021 §5 item 5's own "otherwise everything goes through the
 * RPC for one code path"). Refuses (C15, amended) rather than committing
 * when any FIELD_CONFLICT key or blocking structural finding has no
 * matching choice.
 */
/**
 * `atlas.refresh_branch` computes the merge commit's resulting head
 * server-side (a real three-way merge of "ours"/"theirs"/base, ADR-021 §1.1
 * — not a linear `fold` onto a known parent the way `commitToBranch`'s own
 * payload-building fold is), so unlike `CommitResult` there's no locally-
 * computed `Head` to hand back here for E8 item (3)'s cache-seeding to use.
 */
export type RefreshResult = { ok: true; commitId: UUID } | { ok: false; reason: 'invalid' | 'conflict'; message: string };

export async function pushRefresh(supabase: Client, input: PushRefreshInput): Promise<RefreshResult> {
  const { modelId, orgId, userId, branch, mainHeadCommitId, review, choices, structuralChoices = [] } = input;

  const unresolvedFields = unresolvedFieldConflictKeys(review.threeWay.fields, choices);
  if (unresolvedFields.length > 0) {
    return {
      ok: false,
      reason: 'invalid',
      message: `${String(unresolvedFields.length)} field conflict(s) still need a resolution before refreshing: ${unresolvedFields.map((u) => `${u.subjectId}.${u.attribute}`).join(', ')}`,
    };
  }
  const unresolvedStructural = unresolvedStructuralFindings(review.classification.findings, structuralChoices);
  if (unresolvedStructural.length > 0) {
    return {
      ok: false,
      reason: 'invalid',
      message: `${String(unresolvedStructural.length)} structural conflict(s) still need a resolution before refreshing: ${unresolvedStructural.map((f) => f.detail).join('; ')}`,
    };
  }

  let mergeDeltas: Delta[] = [];
  let prepDeltas: Delta[] = [];
  let resolvedConflicts: ResolvedConflictWireRow[] = [];
  if (choices.length > 0 || structuralChoices.length > 0) {
    const sourceId = crypto.randomUUID();
    await createMergeResolutionSource(supabase, { id: sourceId, orgId, modelId, createdBy: userId, branchTitle: branch.title ?? branch.name });
    const mintId = () => crypto.randomUUID();

    if (choices.length > 0) {
      const built = buildFieldConflictResolutions(review.threeWay.fields, review.threeWay.ours, choices, sourceId, mintId);
      mergeDeltas = [...mergeDeltas, ...built.deltas];
      resolvedConflicts = [
        ...resolvedConflicts,
        ...built.resolvedConflicts.map((rc) => ({ id: crypto.randomUUID(), winning_delta_id: rc.winningDeltaId, discarded_delta_id: rc.discardedDeltaId, resolution_delta_id: rc.resolutionDeltaId, rationale: null })),
      ];
    }
    if (structuralChoices.length > 0) {
      const built = buildStructuralResolutions(review, structuralChoices, sourceId, mintId);
      prepDeltas = built.prepDeltas;
      mergeDeltas = [...mergeDeltas, ...built.mergeDeltas];
      resolvedConflicts = [
        ...resolvedConflicts,
        ...built.resolvedConflicts.map((rc) => ({ id: crypto.randomUUID(), winning_delta_id: rc.winningDeltaId, discarded_delta_id: rc.discardedDeltaId, resolution_delta_id: rc.resolutionDeltaId, rationale: rc.rationale })),
      ];
    }
  }

  const totalResolutions = mergeDeltas.length;
  const prepCommit: RefreshBranchCommitInput | null = prepDeltas.length > 0 ? { id: crypto.randomUUID(), title: `Prepare refresh from main: ${String(prepDeltas.length)} preparatory delta(s)`, deltas: prepDeltas } : null;
  const mergeCommit: RefreshBranchCommitInput = {
    id: crypto.randomUUID(),
    title: totalResolutions > 0 ? `Refresh from main, resolving ${String(totalResolutions)} conflict(s)` : 'Refresh from main',
    deltas: mergeDeltas,
  };

  const params = toRefreshBranchParams({
    branchId: branch.id,
    expectedHeadCommitId: branch.head_commit_id,
    mainHeadCommitId,
    prepCommit,
    mergeCommit,
    resolvedConflicts,
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('refresh_branch', params as unknown as Record<string, unknown>);
  if (error) return { ok: false, reason: 'invalid', message: `pushRefresh: ${error.message}` };

  const result = fromRefreshBranchResult(data as never);
  if (result.status === 'stale_head') {
    return { ok: false, reason: 'conflict', message: 'main (or another refresh) advanced since this branch head was last read — reload and try again.' };
  }
  if (result.status === 'invalid') {
    return { ok: false, reason: 'invalid', message: result.reason };
  }
  return { ok: true, commitId: result.mergeCommitId };
}

// Re-exported so a caller building a full "resolve, refresh, resubmit" flow
// doesn't need a second import from ../db/branches just for the main head.
export { getBranch, getMainBranch };

/**
 * Sprint C2 (Prompt 7b), ADR-006 amendment: the review queue's per-element
 * accept/skip — computing the closure preview and executing "confirm ->
 * split_branch -> merge_branch on the split, whole, in one user action"
 * (step 3's own wording). `atlas.split_branch` (`20260911020000_split_branch.sql`)
 * is the one new RPC this needs; the merge half reuses `mergeApprovedRequest`
 * (`src/db/mergeRequests.ts`) unchanged, against the merge request
 * `splitAndMergeSubset` below creates already `approved`.
 */
import type { CommitEnvelope, UUID } from '../contracts/delta';
import { envelopeToDeltaRows } from '../contracts/rows';
import { listOwnDeltaOrigins, mergeBase } from '../engine/branch';
import { foldFromGenesis } from '../engine/head';
import { buildSplitDeltas, computeSplitClosure, type SplitClosureResult } from '../engine/splitClosure';
import { buildCommitLoader } from './commitLoader';
import type { Client } from './client';
import type { BranchRow } from './types';

export interface SplitClosurePreviewInput {
  modelId: UUID;
  /** The branch being reviewed — the one a reviewer is accepting a subset of. */
  branch: BranchRow;
  mainHeadCommitId: UUID;
  requestedSubjectIds: ReadonlySet<UUID>;
}

/**
 * The closure preview (step 3's "accepting 4 pulls in 2; 1 retract blocked
 * because X depends on it," shown before the reviewer confirms). Pure
 * computation over already-fetched history — safe to call on every
 * checkbox toggle in the review UI, not just once at confirm time.
 */
export async function previewSplitClosure(supabase: Client, input: SplitClosurePreviewInput): Promise<SplitClosureResult> {
  const { modelId, branch, mainHeadCommitId, requestedSubjectIds } = input;
  const loader = await buildCommitLoader(supabase, modelId);
  const base = mergeBase(branch.head_commit_id, mainHeadCommitId, loader);
  const baseHead = foldFromGenesis(base, loader);
  const origins = listOwnDeltaOrigins({ baseCommitId: base, headCommitId: branch.head_commit_id }, loader);
  return computeSplitClosure(origins.map((o) => o.delta), baseHead, requestedSubjectIds);
}

export interface ExecuteSplitInput {
  modelId: UUID;
  branch: BranchRow;
  mainHeadCommitId: UUID;
  requestedSubjectIds: ReadonlySet<UUID>;
  /** The split branch's own name (`branches.name`, unique per model) and title — the caller mints these (S-1: ids and human-facing names are the client's own call, same as every other branch-creating flow, `ChangesView.tsx`'s own form). */
  splitBranchName: string;
  splitBranchTitle: string;
}

export type SplitResult =
  | { ok: true; splitBranch: BranchRow; mergeRequestId: UUID; closure: SplitClosureResult }
  /** Every requested id was blocked, or none of them were ever part of this branch's own changeset — nothing to split off. Not an error the reviewer needs a stack trace for. */
  | { ok: false; reason: 'nothing_accepted'; closure: SplitClosureResult }
  | { ok: false; reason: 'error'; message: string };

/**
 * ADR-006 amendment step 2: creates the split branch, approved, with one
 * fresh commit — the closure's own effect, never the original branch's
 * delta rows (`buildSplitDeltas`'s own doc comment). Does not itself call
 * `merge_branch` — the caller does that next, against the
 * `mergeRequestId` this returns, exactly the same way any other approved
 * request is merged (`mergeApprovedRequest`) — "in the same user action"
 * means two calls from the same click handler, not one bigger RPC that
 * would duplicate `merge_branch`'s own logic.
 */
export async function splitAndMergeSubset(supabase: Client, input: ExecuteSplitInput): Promise<SplitResult> {
  const { modelId, branch, mainHeadCommitId, requestedSubjectIds, splitBranchName, splitBranchTitle } = input;
  const loader = await buildCommitLoader(supabase, modelId);
  const base = mergeBase(branch.head_commit_id, mainHeadCommitId, loader);
  const baseHead = foldFromGenesis(base, loader);
  const origins = listOwnDeltaOrigins({ baseCommitId: base, headCommitId: branch.head_commit_id }, loader);
  const closure = computeSplitClosure(origins.map((o) => o.delta), baseHead, requestedSubjectIds);
  if (closure.accepted.size === 0) {
    return { ok: false, reason: 'nothing_accepted', closure };
  }

  const freshDeltas = buildSplitDeltas(origins, closure, baseHead, () => crypto.randomUUID());
  const commitId = crypto.randomUUID();
  // `branchId` here is only ever used to compute `deltaRows` locally
  // (envelopeToDeltaRows needs *an* envelope id to stamp onto every row as
  // `commit_id` before the RPC below overrides it with the real one via
  // `p_commit_id`) — never sent to the server as a real branch reference.
  const envelope: CommitEnvelope = { id: commitId, branchId: branch.id, parentCommitId: base, mergedBranchHeadCommitId: null, kind: 'manual', title: splitBranchTitle, body: null, deltas: freshDeltas };
  const deltaRows = envelopeToDeltaRows(envelope, { orgId: '', modelId: '', createdBy: '' }).map((row) => ({
    id: row.id,
    kind: row.kind,
    subject_id: row.subject_id,
    attribute: row.attribute,
    element_type: row.element_type,
    relationship_type: row.relationship_type,
    name: row.name,
    parent_id: row.parent_id,
    from_element_id: row.from_element_id,
    to_element_id: row.to_element_id,
    value: row.value,
    previous_delta_id: row.previous_delta_id,
    source_id: row.source_id,
    source_ref: row.source_ref,
    effective_date: row.effective_date,
    confidence: row.confidence,
  }));

  const newBranchId = crypto.randomUUID();
  const mergeRequestId = crypto.randomUUID();
  // A trivially-clean classification: the closure guarantees (by
  // construction and its own property test) that this commit folds
  // cleanly over the merge base — there is nothing left for the review
  // queue's own classification machinery to find, the same way an
  // already-reviewed branch's accepted subset has nothing left to review.
  const classification = { findings: [], hasBlockingConflict: false, clean: [...closure.accepted] };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('split_branch', {
    p_new_branch_id: newBranchId,
    p_branch_id: branch.id,
    p_new_branch_name: splitBranchName,
    p_new_branch_title: splitBranchTitle,
    p_commit_id: commitId,
    p_commit_title: splitBranchTitle,
    p_deltas: deltaRows,
    p_merge_request_id: mergeRequestId,
    p_classification: classification,
  });
  if (error) return { ok: false, reason: 'error', message: error.message };

  return { ok: true, splitBranch: data as BranchRow, mergeRequestId, closure };
}

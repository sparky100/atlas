/**
 * ADR-019 (docs/ADR-000-foundations.md), SPEC §3.6/§9/§7.4, E7
 * (docs/prompts/atlas-prompt-pack.md): a reversible identity merge —
 * "these two elements are the same real thing." The merge itself is an
 * ordinary `manual` commit through `commitToBranch` (its own module
 * comment) carrying `src/engine/mergeElements.ts`'s computed deltas —
 * merging two elements is, mechanically, exactly the edit a person would
 * make by hand, so it needs no new commit kind and inherits the exact same
 * role/branch-status checks every other edit already goes through.
 * `atlas.record_element_merge` (`.schema('atlas').rpc`, same convention
 * `mergeRequests.ts`'s own module comment names) then records
 * `element_merges` and the `merged_id` alias atomically, for a commit that
 * has already fully succeeded and is real, permanent history either way.
 *
 * Undo needs no RPC at all: it's the exact same `commitToBranch` path,
 * carrying `buildUndoMergeElementsDeltas`'s own computed inverse.
 */
import type { CommitEnvelope, UUID } from '../contracts/delta';
import { buildCommitLoader } from './commitLoader';
import type { Client } from './client';
import { type CommitResult, commitToBranch } from './commits';
import { foldFromGenesis } from '../engine/head';
import { buildMergeElementsDeltas, buildUndoMergeElementsDeltas } from '../engine/mergeElements';
import type { ElementMergeRow } from './types';

export interface MergeElementsInput {
  modelId: UUID;
  branchId: UUID;
  expectedHeadCommitId: UUID;
  survivorId: UUID;
  loserId: UUID;
  /** A real `sources` row id (`getOrCreateManualSource`, same convention every other editing hook already uses) — never the source *kind* string. */
  sourceId: UUID;
  rationale: string;
  evidenceId?: UUID | null;
}

export type MergeElementsResult =
  | { status: 'merged'; commitId: UUID; elementMergeId: UUID }
  | { status: 'invalid'; message: string }
  | { status: 'conflict'; message: string };

/**
 * Merges `loserId` into `survivorId` on `branchId`. `commitToBranch`
 * validates and writes the retract-and-repoint commit first (the same
 * optimistic-concurrency/role checks any other edit gets); only once that
 * has actually succeeded does this record `element_merges`/the alias —
 * never the other way around, since there is nothing to record if the
 * commit itself was refused.
 */
export async function mergeElements(supabase: Client, input: MergeElementsInput): Promise<MergeElementsResult> {
  const { modelId, branchId, expectedHeadCommitId, survivorId, loserId, sourceId, rationale, evidenceId } = input;

  const loader = await buildCommitLoader(supabase, modelId);
  const head = foldFromGenesis(expectedHeadCommitId, loader);
  const survivorName = head.elements.get(survivorId)?.name ?? survivorId;
  const loserName = head.elements.get(loserId)?.name ?? loserId;

  let mergeDeltas;
  try {
    ({ deltas: mergeDeltas } = buildMergeElementsDeltas(head, survivorId, loserId, sourceId, () => crypto.randomUUID()));
  } catch (e) {
    return { status: 'invalid', message: e instanceof Error ? e.message : 'Could not merge these elements.' };
  }

  const commitId = crypto.randomUUID();
  // A merge deserves its own explicit title, not describeEnvelope's generic
  // "X (N changes)" — the same "domain-specific phrasing instead" carve-out
  // CommitEnvelope.title's own doc comment already grants merge/
  // template_seed/genesis commits, for the identical reason: the action the
  // user chose is specific and meaningful enough to name directly.
  const envelope: CommitEnvelope = {
    id: commitId,
    branchId,
    parentCommitId: expectedHeadCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `Merge "${loserName}" into "${survivorName}"`,
    body: rationale,
    deltas: mergeDeltas,
  };

  const commitResult = await commitToBranch(supabase, { modelId, branchId, expectedHeadCommitId, envelope });
  if (!commitResult.ok) return { status: commitResult.reason, message: commitResult.message };

  const elementMergeId = crypto.randomUUID();
  const aliasId = crypto.randomUUID();
  const { error } = await supabase.schema('atlas').rpc('record_element_merge', {
    p_id: elementMergeId,
    p_model_id: modelId,
    p_surviving_element_id: survivorId,
    p_merged_element_id: loserId,
    p_rationale: rationale,
    p_commit_id: commitResult.commitId,
    p_alias_id: aliasId,
    p_source_id: sourceId,
    p_evidence_id: evidenceId ?? null,
  });
  if (error) throw new Error(`mergeElements: the merge commit succeeded but recording it failed: ${error.message}`);

  return { status: 'merged', commitId: commitResult.commitId, elementMergeId };
}

/** Owner-of-the-merged-model-scoped read (`element_merges_select`'s RLS, member-scoped) — the one lookup `undoElementMerge` needs. */
export async function getElementMerge(supabase: Client, elementMergeId: UUID): Promise<ElementMergeRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('element_merges').select('*').eq('id', elementMergeId).maybeSingle();
  if (error) throw new Error(`getElementMerge: ${error.message}`);
  return data as ElementMergeRow | null;
}

export interface UndoElementMergeInput {
  modelId: UUID;
  branchId: UUID;
  expectedHeadCommitId: UUID;
  elementMergeId: UUID;
  sourceId: UUID;
}

/**
 * Undoes a merge — an ordinary new commit inverting the original merge
 * commit's own deltas (`buildUndoMergeElementsDeltas`'s own module
 * comment). `element_merges` itself is never touched (CLAUDE.md rule 5):
 * it stays a permanent, accurate record that the merge happened, exactly
 * as every other append-only table in this schema already works.
 */
export async function undoElementMerge(supabase: Client, input: UndoElementMergeInput): Promise<CommitResult> {
  const { modelId, branchId, expectedHeadCommitId, elementMergeId, sourceId } = input;

  const elementMerge = await getElementMerge(supabase, elementMergeId);
  if (!elementMerge) return { ok: false, reason: 'invalid', message: `element merge ${elementMergeId} not found` };

  const loader = await buildCommitLoader(supabase, modelId);
  const mergeCommitNode = loader(elementMerge.commit_id);
  if (!mergeCommitNode) return { ok: false, reason: 'invalid', message: `merge commit ${elementMerge.commit_id} not found` };

  const { deltas } = buildUndoMergeElementsDeltas(mergeCommitNode.deltas, elementMerge.merged_element_id, sourceId, () => crypto.randomUUID());

  const commitId = crypto.randomUUID();
  const envelope: CommitEnvelope = {
    id: commitId,
    branchId,
    parentCommitId: expectedHeadCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'Undo merge',
    body: null,
    deltas,
  };

  return commitToBranch(supabase, { modelId, branchId, expectedHeadCommitId, envelope });
}

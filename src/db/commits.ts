/**
 * Committing a `CommitEnvelope` to a branch — the one place this repository
 * implements optimistic concurrency (SPEC-data-model.md §5.2's C13, C6).
 *
 * Sprint U1 step 3a: this used to be two round trips (insert the commit and
 * its deltas, then compare-and-swap `branches.head_commit_id`), leaving a
 * lost race's just-inserted commit as a harmless but permanent orphan. It's
 * now one call to `atlas.commit_deltas`, a Postgres function that does all
 * of that — plus, when the branch is `main`, materialising
 * `elements_head`/`relationships_head`/`facts` for the new head — inside a
 * single transaction. A lost race now means the whole call fails and
 * nothing was written, not an orphan row. commits.ts computes the fold
 * result and its projection (reusing the same tested engine that already
 * did this for validation) and hands the RPC the data to write; the engine
 * stays the one place fold/apply is defined (see supabase/migrations/
 * 20260906090000_facts_and_commit_deltas.sql's module comment for why that
 * split, not a PL/pgSQL reimplementation, was the right call).
 *
 * `orgId`/`createdBy` are gone from `CommitToBranchInput`: the RPC derives
 * `org_id` from `modelId` and `author_id`/`created_by` from `auth.uid()`
 * itself, never from a client-supplied value — there's no longer a
 * parameter here for a caller to even get wrong.
 */
import type { UUID } from '../contracts/delta';
import { envelopeToDeltaRows, type CommitRow } from '../contracts/rows';
import type { CommitEnvelope } from '../contracts/delta';
import { cloneHead, fold } from '../engine/deltas';
import { foldFromGenesis, headHash } from '../engine/head';
import { serializeHeadProjection } from '../engine/projection';
import { getBranch } from './branches';
import type { Client } from './client';
import { buildCommitLoader } from './commitLoader';

export type CommitResult =
  | { ok: true; commitId: UUID }
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'conflict'; message: string };

export interface CommitToBranchInput {
  modelId: UUID;
  branchId: UUID;
  /** The commit this caller last saw as the branch's head. The commit-writing engine's C13: a stale value here is exactly what turns a concurrent edit into a rejected commit instead of a lost update. */
  expectedHeadCommitId: UUID;
  /** `envelope.parentCommitId` must equal `expectedHeadCommitId` — both are required, rather than deriving one from the other, so a caller can't accidentally commit against a head it never actually fetched. */
  envelope: CommitEnvelope;
}

/** Exported for direct unit testing — the only part of commitToBranch that needs no database at all. */
export function shapeErrors(envelope: CommitEnvelope, expectedHeadCommitId: UUID): string[] {
  const errors: string[] = [];
  // C1: a non-merge commit needs at least one delta.
  if (envelope.kind !== 'merge' && envelope.deltas.length === 0) {
    errors.push('a non-merge commit must have at least one delta (C1)');
  }
  // C14: kind === "merge" iff mergedBranchHeadCommitId is set.
  if ((envelope.kind === 'merge') !== (envelope.mergedBranchHeadCommitId !== null)) {
    errors.push('kind "merge" must be set if and only if mergedBranchHeadCommitId is (C14)');
  }
  if (envelope.parentCommitId !== expectedHeadCommitId) {
    errors.push('envelope.parentCommitId must equal expectedHeadCommitId');
  }
  // C4: at most one delta per fact key per commit.
  const seen = new Set<string>();
  for (const delta of envelope.deltas) {
    const key = `${'elementId' in delta ? delta.elementId : delta.relationshipId} ${'attribute' in delta ? delta.attribute : '$exists'}`;
    if (seen.has(key)) {
      errors.push(`more than one delta targets the same fact in this commit (C4): ${key}`);
    }
    seen.add(key);
  }
  return errors;
}

/** Postgres error codes atlas.commit_deltas can raise (or that fire via the triggers/constraints it relies on) that mean "the caller's believed head was stale" rather than "the request itself was invalid." */
const CONFLICT_ERROR_CODES = new Set([
  '23505', // unique_violation on (branch_id, parent_commit_id) — another commit already claimed this parent.
  '23514', // check_violation from atlas.guard_branch_head_advance — wrong parent or non-draft branch.
]);

/**
 * Commits `input.envelope` to `input.branchId`, provided nothing else has
 * advanced the branch past `input.expectedHeadCommitId` in the meantime.
 * Validates what it can before writing anything: C1/C4/C14 structurally,
 * then a real `fold` of the proposed deltas onto the branch's current head
 * — reusing the same engine `apply` that would reject an update targeting
 * a missing subject, a restore of something not retracted, and so on
 * (SPEC §6.2's own preconditions), rather than re-implementing them here.
 * If the branch is `main`, the resulting head is also serialised and sent
 * along so `atlas.commit_deltas` can materialise it in the same
 * transaction.
 */
export async function commitToBranch(supabase: Client, input: CommitToBranchInput): Promise<CommitResult> {
  const { modelId, branchId, expectedHeadCommitId, envelope } = input;

  const structuralErrors = shapeErrors(envelope, expectedHeadCommitId);
  if (structuralErrors.length > 0) {
    return { ok: false, reason: 'invalid', message: structuralErrors.join('; ') };
  }

  const branch = await getBranch(supabase, branchId);
  if (!branch) {
    return { ok: false, reason: 'invalid', message: `branch ${branchId} not found` };
  }

  const loader = await buildCommitLoader(supabase, modelId);
  const parentNode = loader(expectedHeadCommitId);
  if (!parentNode) {
    return { ok: false, reason: 'invalid', message: `expectedHeadCommitId ${expectedHeadCommitId} is not a known commit` };
  }

  let currentHead;
  try {
    currentHead = foldFromGenesis(expectedHeadCommitId, loader);
  } catch (e) {
    return { ok: false, reason: 'invalid', message: `could not compute the current head: ${(e as Error).message}` };
  }

  let newHead;
  try {
    newHead = fold(cloneHead(currentHead), envelope.deltas, { authorId: envelope.authorId, createdAt: new Date().toISOString() });
  } catch (e) {
    return { ok: false, reason: 'invalid', message: (e as Error).message };
  }

  // orgId/modelId/createdBy are throwaway here — atlas.commit_deltas fills
  // in the real org_id/model_id/created_by (from its own params and
  // auth.uid()) itself, and never trusts a client-supplied value for them.
  // envelopeToDeltaRows still needs *something* structurally; the map below
  // strips all five DB-assigned fields (those three plus commit_id/seq)
  // back out before this goes into the RPC call.
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

  const isMain = branch.kind === 'main';
  const projection = isMain ? serializeHeadProjection(newHead) : null;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.rpc('commit_deltas', {
    p_commit_id: envelope.id,
    p_model_id: modelId,
    p_branch_id: branchId,
    p_base_commit_id: expectedHeadCommitId,
    p_kind: envelope.kind,
    p_message: envelope.message,
    p_deltas: deltaRows,
    p_merged_branch_head_commit_id: envelope.mergedBranchHeadCommitId,
    p_elements_head: projection?.elementsHead ?? null,
    p_relationships_head: projection?.relationshipsHead ?? null,
    p_facts: projection?.facts ?? null,
    p_head_hash: isMain ? headHash(newHead) : null,
  } satisfies Record<string, unknown>);

  if (error) {
    if (CONFLICT_ERROR_CODES.has(error.code)) {
      return { ok: false, reason: 'conflict', message: error.message };
    }
    return { ok: false, reason: 'invalid', message: error.message };
  }

  const commitRow = data as CommitRow;
  return { ok: true, commitId: commitRow.id };
}

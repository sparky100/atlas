/**
 * Committing a `CommitEnvelope` to a branch — the one place this repository
 * implements optimistic concurrency (SPEC-data-model.md §5.2's C13, C6).
 *
 * Two round trips, not one atomic stored procedure: insert the commit (and
 * its deltas), then compare-and-swap `branches.head_commit_id` from the
 * caller's believed current head to the new commit. If another commit won
 * the race in between, the swap affects zero rows and this returns a
 * `conflict` result — the just-inserted commit row is left in place,
 * append-only (deltas/commits are never deleted, SPEC §2), as a harmless
 * orphan no branch ever points to and no fold ever reaches. A single
 * security-definer procedure doing this atomically in one round trip is a
 * reasonable future optimisation (it would avoid the orphan entirely) but
 * isn't needed for this product's actual contention level — one or two
 * architects on one branch at a time — so it isn't built here.
 */
import type { UUID } from '../contracts/delta';
import { toCommitRow, envelopeToDeltaRows, type CommitRow } from '../contracts/rows';
import type { CommitEnvelope } from '../contracts/delta';
import { cloneHead, fold } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';
import type { Client } from './client';
import { buildCommitLoader } from './commitLoader';

export type CommitResult =
  | { ok: true; commitId: UUID }
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'conflict'; message: string };

export interface CommitToBranchInput {
  orgId: UUID;
  modelId: UUID;
  branchId: UUID;
  /** The commit this caller last saw as the branch's head. The commit-writing engine's C13: a stale value here is exactly what turns a concurrent edit into a rejected commit instead of a lost update. */
  expectedHeadCommitId: UUID;
  /** `envelope.parentCommitId` must equal `expectedHeadCommitId` — both are required, rather than deriving one from the other, so a caller can't accidentally commit against a head it never actually fetched. */
  envelope: CommitEnvelope;
  createdBy: UUID;
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

/**
 * Commits `input.envelope` to `input.branchId`, provided nothing else has
 * advanced the branch past `input.expectedHeadCommitId` in the meantime.
 * Validates what it can before writing anything: C1/C4/C14 structurally,
 * then a real `fold` of the proposed deltas onto the branch's current head
 * — reusing the same engine `apply` that would reject an update targeting
 * a missing subject, a restore of something not retracted, and so on
 * (SPEC §6.2's own preconditions), rather than re-implementing them here.
 */
export async function commitToBranch(supabase: Client, input: CommitToBranchInput): Promise<CommitResult> {
  const { orgId, modelId, branchId, expectedHeadCommitId, envelope, createdBy } = input;

  const structuralErrors = shapeErrors(envelope, expectedHeadCommitId);
  if (structuralErrors.length > 0) {
    return { ok: false, reason: 'invalid', message: structuralErrors.join('; ') };
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

  try {
    fold(cloneHead(currentHead), envelope.deltas, { authorId: envelope.authorId, createdAt: new Date().toISOString() });
  } catch (e) {
    return { ok: false, reason: 'invalid', message: (e as Error).message };
  }

  const commitRow = toCommitRow(envelope, { orgId, modelId, depth: parentNode.depth + 1 });
  const { error: commitInsertError } = await supabase.from('commits').insert(commitRow satisfies Omit<CommitRow, 'head_hash' | 'created_at'>);
  if (commitInsertError) {
    // Either RLS denied it (not this user's branch, branch not draft, ...)
    // or the unique (branch_id, parent_commit_id) index caught a lost race
    // at insert time already — either way, nothing was written.
    return { ok: false, reason: 'conflict', message: commitInsertError.message };
  }

  const deltaRows = envelopeToDeltaRows(envelope, { orgId, modelId, createdBy });
  if (deltaRows.length > 0) {
    const { error: deltasInsertError } = await supabase.from('deltas').insert(deltaRows);
    if (deltasInsertError) {
      // The commit row above is now an orphan — see the module comment.
      return { ok: false, reason: 'invalid', message: deltasInsertError.message };
    }
  }

  const { data: advanced, error: advanceError } = await supabase
    .from('branches')
    .update({ head_commit_id: envelope.id })
    .eq('id', branchId)
    .eq('head_commit_id', expectedHeadCommitId)
    .select('id');
  if (advanceError) return { ok: false, reason: 'conflict', message: advanceError.message };
  if (advanced.length === 0) {
    return { ok: false, reason: 'conflict', message: 'the branch head moved since it was last read; refresh and retry' };
  }

  return { ok: true, commitId: envelope.id };
}

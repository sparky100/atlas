/**
 * F2 (full K1) PR8, SPEC-capture.md §8.2: folds the reviewer's chosen
 * *target* change branch to its current head — the twin of
 * `loadCaptureDraftHead.ts`, kept as its own file (same additive
 * `foldFromGenesis`/`buildCommitLoader` shape, disjoint from E8) because
 * its own precondition differs: a target branch must be `kind = 'change'`
 * and `status = 'draft'` (the same branch `atlas.commit_deltas`/
 * `atlas.apply_capture_decisions` themselves require), never
 * `capture_draft` — promoting *into* another draft's own capture branch
 * makes no sense and is refused here before any fold is even attempted.
 *
 * `buildPromotionEnvelope.ts` uses this head for `previousDeltaId`
 * re-derivation (§8.1's own note: "Promotion... re-derives previousDeltaId
 * against that branch's current head at apply time, so a stale draft
 * never blocks a review") and for `existsDeltaId` fallback on a matched
 * candidate's first-time attribute assertion, exactly the role
 * `buildCaptureDraftEnvelope.ts`'s own `mainHead` played in PR7 — just
 * against a change branch's head instead of main's.
 */
import type { UUID } from '../contracts/delta';
import { getBranch } from '../db/branches';
import type { Client } from '../db/client';
import { buildCommitLoader } from '../db/commitLoader';
import type { Head } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';

export class TargetBranchHeadError extends Error {}

export interface LoadedTargetBranch {
  head: Head;
  headCommitId: UUID;
}

export async function loadTargetBranchHead(supabase: Client, modelId: UUID, targetBranchId: UUID): Promise<LoadedTargetBranch> {
  const branch = await getBranch(supabase, targetBranchId);
  if (!branch) throw new TargetBranchHeadError(`loadTargetBranchHead: branch ${targetBranchId} not found`);
  if (branch.kind !== 'change') throw new TargetBranchHeadError(`loadTargetBranchHead: branch ${targetBranchId} is not a change branch`);
  if (branch.status !== 'draft') throw new TargetBranchHeadError(`loadTargetBranchHead: branch ${targetBranchId} is ${branch.status} (must be draft) — TARGET_BRANCH_NOT_DRAFT`);

  const loader = await buildCommitLoader(supabase, modelId);
  const head = foldFromGenesis(branch.head_commit_id, loader);
  return { head, headCommitId: branch.head_commit_id };
}

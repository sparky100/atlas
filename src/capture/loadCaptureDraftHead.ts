/**
 * F2 (full K1) PR8, SPEC-capture.md §8.2: folds a capture job's own
 * `capture_draft` branch to its current head. One of the two additive
 * `foldFromGenesis`/`buildCommitLoader` reads this sprint keeps disjoint
 * from E8's own client-cache refactor (neither `src/db/branchProjection.ts`
 * nor `src/engine/head.ts` gain a parameter for this — this is a brand-new
 * function calling the same already-tested primitives directly, the exact
 * shape `src/db/roadmapChangeEvents.ts` already used for F5).
 *
 * Every fact on a capture_draft's own head still carries the *original*
 * capture provenance (`sourceId`/`sourceRef`/`effectiveDate`/`confidence`)
 * from `write_capture_draft` (PR7) — `buildPromotionEnvelope.ts` reads this
 * head's own `facts` map to copy that provenance onto a promoted delta
 * verbatim, and to find the specific draft delta an `edited` decision
 * discards (`resolved_conflicts.discarded_delta_id`).
 */
import type { UUID } from '../contracts/delta';
import { getBranch } from '../db/branches';
import type { Client } from '../db/client';
import { buildCommitLoader } from '../db/commitLoader';
import type { Head } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';

export class CaptureDraftHeadError extends Error {}

export async function loadCaptureDraftHead(supabase: Client, modelId: UUID, draftBranchId: UUID): Promise<Head> {
  const branch = await getBranch(supabase, draftBranchId);
  if (!branch) throw new CaptureDraftHeadError(`loadCaptureDraftHead: branch ${draftBranchId} not found`);
  if (branch.kind !== 'capture_draft') throw new CaptureDraftHeadError(`loadCaptureDraftHead: branch ${draftBranchId} is not a capture_draft branch`);

  const loader = await buildCommitLoader(supabase, modelId);
  return foldFromGenesis(branch.head_commit_id, loader);
}

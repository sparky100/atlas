import type { UUID } from '../contracts/delta';
import type { Head } from '../engine/deltas';
import { capabilitiesLeftWithoutSystem, liveHead, projectFutureHead, type PlannedChange } from '../engine/plannedFuture';
import type { Client } from './client';
import { listChangeBranches, OPEN_CHANGE_STATUSES } from './branches';
import type { BranchRow } from './types';

export interface PlannedFuture {
  /** Today's live picture (planned and retired systems left out) — the "unchanged" side of any comparison. */
  today: Head;
  /** The picture as at the chosen date. */
  head: Head;
  /** Planned changes laid on, in the order applied. */
  applied: BranchRow[];
  /** Planned changes with no target date, so left out — the picture can't place them in time. */
  undated: BranchRow[];
  /** Elements two applied changes both touch. */
  overlaps: { elementId: UUID; name: string; changes: BranchRow[] }[];
  /** Capabilities some system supports today and none will by this date. */
  capabilitiesWithoutSystem: { elementId: UUID; name: string }[];
}

/**
 * Which changes count as planned: still open, with the "propose" intent.
 * Choosing an option flips it to "propose" (`atlas.choose_decision_option`),
 * so a chosen option counts and an option still being compared ("explore")
 * never does — a future nobody has agreed to doesn't belong in the picture.
 * Merged changes are already in today's head, so they are not laid on again.
 */
export function isPlannedChange(branch: BranchRow): boolean {
  return branch.kind === 'change' && branch.intent === 'propose' && OPEN_CHANGE_STATUSES.includes(branch.status);
}

/**
 * @param loadHead Folds one commit to its head (the app's cached fold, `loadHeadAtCommitCached`). Passed in so this module doesn't depend on the UI layer's cache.
 */
export async function loadPlannedFuture(
  supabase: Client,
  modelId: UUID,
  mainHeadCommitId: UUID,
  asAt: string,
  todayIso: string,
  loadHead: (commitId: UUID) => Promise<Head>,
): Promise<PlannedFuture> {
  const planned = (await listChangeBranches(supabase, modelId)).filter(isPlannedChange);
  const undated = planned.filter((b) => b.target_date === null);
  const due = planned.filter((b): b is BranchRow & { target_date: string } => b.target_date !== null && b.target_date <= asAt);

  const today = liveHead(await loadHead(mainHeadCommitId), todayIso);
  // Only fold the changes that fall on or before the date; with none, there is nothing to fold.
  const changes: PlannedChange[] =
    asAt <= todayIso
      ? []
      : await Promise.all(
          due.map(async (b) => {
            const [asIs, toBe] = await Promise.all([loadHead(b.base_commit_id), loadHead(b.head_commit_id)]);
            return { id: b.id, targetDate: b.target_date, asIs, toBe };
          }),
        );

  const projection = projectFutureHead(today, changes, asAt, todayIso);
  const byId = new Map(planned.map((b) => [b.id, b]));
  const nameOf = (id: UUID) => projection.head.elements.get(id)?.name ?? today.elements.get(id)?.name ?? 'Unnamed';

  return {
    today,
    head: projection.head,
    applied: projection.applied.flatMap((id) => byId.get(id) ?? []),
    undated,
    overlaps: projection.overlaps.map((o) => ({ elementId: o.elementId, name: nameOf(o.elementId), changes: o.changeIds.flatMap((id) => byId.get(id) ?? []) })),
    capabilitiesWithoutSystem: capabilitiesLeftWithoutSystem(today, projection.head).map((id) => ({ elementId: id, name: nameOf(id) })),
  };
}

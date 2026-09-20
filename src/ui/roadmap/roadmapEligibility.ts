/**
 * Which branches ever show as a change marker on the roadmap, and under
 * which of F5's own "as-is/to-be" states (docs/prompts/atlas-prompt-pack.md).
 * `target_date` is the one column both `record`'s "delivered date" and
 * `propose`'s "target date" share (`branchIntent.ts`'s own doc comment);
 * `correct`/`explore` carry no date at all and never appear here — F0's
 * own text is explicit that "explore never appears on the roadmap," and a
 * dateless `correct` has nothing for a horizontal-time view to place it
 * at.
 *
 * This is a *whole-roadmap* as-is/to-be, distinct from
 * `BranchViewModeControl`'s own per-branch as-is/to-be/diff (that one
 * picks which side of *one* branch's own fork to render; this one picks
 * which *set of branches* the timeline includes at all) — as-is shows
 * only what's actually landed; to-be adds the pipeline of what's still
 * open with a stated date, the same "what's coming" reading a roadmap is
 * for.
 */
import type { BranchRow } from '../../db/types';

export type RoadmapMode = 'asIs' | 'toBe';

const OPEN_STATUSES: readonly BranchRow['status'][] = ['draft', 'proposed', 'in_review', 'approved'];

export function isRoadmapEligibleBranch(branch: Pick<BranchRow, 'intent' | 'status' | 'target_date'>, mode: RoadmapMode): boolean {
  if (branch.intent !== 'record' && branch.intent !== 'propose') return false;
  if (branch.target_date === null) return false;
  if (branch.status === 'merged') return true;
  return mode === 'toBe' && OPEN_STATUSES.includes(branch.status);
}

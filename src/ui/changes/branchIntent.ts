/**
 * Prompt pack F0 ("change intent — the why"): the one place intent-derived
 * UI logic lives, mirroring `branchStatus.ts`/`changeStepper.ts`'s own
 * shape exactly (a plain new `branches` enum, never read by `src/engine`,
 * threaded through `src/ui` via exhaustive switches) — see
 * `src/db/types.ts`'s `BranchIntent` doc comment for why this stays a
 * workflow/UI concept, not an engine one.
 */
import type { BranchIntent, BranchRow } from '../../db/types';

/** F0's own four entry points, each with a real default — every branch-creation call site names which one it is. */
export type IntentEntryPoint = 'elementPage' | 'directorDoor' | 'whatHappened' | 'changesList' | 'homeSearch';

/**
 * F0: "set at creation (defaulting from the entry point: element page →
 * correct or propose; director door → propose; 'what happened' →
 * record)". `homeSearch`/`changesList` aren't named in that list —
 * `homeSearch` is treated as the generic `propose` default (closest
 * existing behaviour, not a scoped correction of one already-existing
 * fact); `changesList`'s own inline "New change" form is the one surface
 * with no fixed entry-point default at all, so it renders an explicit
 * picker instead of calling this function — see `ChangesView.tsx`.
 */
export function defaultIntentForEntryPoint(entryPoint: IntentEntryPoint): BranchIntent {
  switch (entryPoint) {
    case 'elementPage':
      return 'correct';
    case 'directorDoor':
      return 'propose';
    case 'whatHappened':
      return 'record';
    case 'homeSearch':
      return 'propose';
    case 'changesList':
      return 'propose';
  }
}

export const INTENT_OPTIONS: readonly { value: BranchIntent; label: string }[] = [
  { value: 'record', label: 'Record — something already happened' },
  { value: 'propose', label: 'Propose — something is planned' },
  { value: 'correct', label: 'Correct — the record was wrong' },
  { value: 'explore', label: 'Explore — a candidate future' },
];

/**
 * F0's own four header sentences, verbatim shape from the prompt pack:
 * "Recording: Dynamics went live 3 Sept" / "Proposing: replace ADQM by
 * March" / "Correction" / "Exploring: option B for Customer Contact" —
 * `correct` is deliberately the one intent with no title suffix (its own
 * prose: "provenance answers 'who says so'", not a summary sentence).
 * `null` (a non-`change` branch, or a `change` branch predating this
 * migration) falls back to the plain title/name this page always showed
 * before F0 existed.
 */
export function intentHeaderLine(branch: Pick<BranchRow, 'intent' | 'title' | 'name'>): string {
  const title = branch.title ?? branch.name;
  switch (branch.intent) {
    case 'record':
      return `Recording: ${title}`;
    case 'propose':
      return `Proposing: ${title}`;
    case 'correct':
      return 'Correction';
    case 'explore':
      return `Exploring: ${title}`;
    case null:
      return title;
  }
}

/** F0: "review weight per intent (correct and record: single approver, no split; propose and explore: full queue)" — resolved with the human as "reuse the existing single-approver `merge_requests` mechanism for every intent; record/correct just never render the multi-step review queue UI" (no new privilege model, see the plan's own Decision 1). `'single'` means the change page's own one-click "Approve & merge" action (PR3); `'queue'` means the existing `ReviewQueuePage` flow, unchanged. */
export type IntentReviewWeight = 'single' | 'queue';

export function intentReviewWeight(intent: BranchIntent): IntentReviewWeight {
  switch (intent) {
    case 'record':
    case 'correct':
      return 'single';
    case 'propose':
    case 'explore':
      return 'queue';
  }
}

/**
 * F0's own per-intent date requirement — both `record`'s "delivered date"
 * and `propose`'s "target date" are the same `branches.target_date`
 * column (already "the intended delivery date shown on the change page
 * and roadmap" per that column's own doc comment): a judgment call to
 * reuse one column with an intent-dependent label rather than add a
 * second, near-duplicate date column. `correct`/`explore` need no date at
 * all (F0's own text: "correct — no date"; `explore` names no date
 * either).
 */
export function dateFieldLabelForIntent(intent: BranchIntent): string | null {
  switch (intent) {
    case 'record':
      return 'Delivered date';
    case 'propose':
      return 'Target date';
    case 'correct':
    case 'explore':
      return null;
  }
}

export function isDateRequiredForIntent(intent: BranchIntent): boolean {
  return intent === 'record' || intent === 'propose';
}

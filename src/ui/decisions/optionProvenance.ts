import type { DecisionOptionMark } from '../../contracts/decisionOptionMark';
import type { DecisionOptionRow } from '../../db/types';

/**
 * The words shown with an option an agent suggested (Simon, 2026-11-19: AI
 * help must be clearly indicated). Says only what was recorded: that the
 * Designer drafted it and, when the person changed it before it was added,
 * who. Later edits on the change page are not recorded, and the wording does
 * not claim they are. `null` for an option added by hand.
 */
export function optionProvenance(mark: DecisionOptionMark | undefined, nameOf: (userId: string) => string): string | null {
  if (mark === undefined) return null;
  if (mark.editedBy === null) return 'Suggested by the Designer';
  return `Suggested by the Designer, edited by ${nameOf(mark.editedBy)} before it was added`;
}

/** The same wording from the candidate row, which is the copy the decision page now reads. */
export function optionRowProvenance(option: DecisionOptionRow, nameOf: (userId: string) => string): string | null {
  if (option.source !== 'designer') return null;
  if (option.edited_by === null) return 'Suggested by the Designer';
  return `Suggested by the Designer, edited by ${nameOf(option.edited_by)} before it was added`;
}

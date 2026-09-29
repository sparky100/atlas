/**
 * F6.3 (decision page rework, Part B): the one-line "what this option does"
 * under each option's header ("Retires PM, adds Hana equivalent, re-points
 * 4 flows") — derived from `OptionTouch` (`optionTouch.ts`), itself built
 * from `summarizeOwnDeltas`'s own `ChangeSubjectSummary[]`: the option's
 * *own* deltas since its fork point, never a diff of two projected states
 * (see `optionTouch.ts`'s own module comment for why that distinction
 * matters — main can drift independently after the option forks).
 * Distinct from `describeEnvelope` (`src/engine/describeEnvelope.ts`): that
 * reads `deltas[0]` plus a count, right for a commit title but not for
 * "everything this option changed" — this reads every touched subject.
 *
 * `null` means "nothing to summarise" — the caller renders "No changes
 * recorded yet" instead (an empty-delta option, decision 3 in the sprint's
 * own brief), never an empty string.
 */
import type { OptionTouch } from './optionTouch';

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export function summarizeOptionChanges(touch: OptionTouch): string | null {
  const parts: string[] = [];
  if (touch.retiredElements.length === 1) parts.push(`retires ${touch.retiredElements[0]?.name ?? 'an element'}`);
  else if (touch.retiredElements.length > 1) parts.push(`retires ${String(touch.retiredElements.length)} elements`);

  if (touch.addedElements.length === 1) parts.push(`adds ${touch.addedElements[0]?.name ?? 'an element'}`);
  else if (touch.addedElements.length > 1) parts.push(`adds ${String(touch.addedElements.length)} elements`);

  if (touch.repointedRelationshipCount > 0) {
    parts.push(`re-points ${String(touch.repointedRelationshipCount)} ${pluralize(touch.repointedRelationshipCount, 'connection')}`);
  }

  const [first, ...rest] = parts;
  if (first === undefined) return null;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(', ');
}

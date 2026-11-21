/**
 * F6.3 (decision page rework, Part B): the one-line "what this option does"
 * under each option's header ("Retires PM, adds Hana equivalent, re-points
 * 4 flows") — derived from `OptionTouch` (`optionTouch.ts`), itself built
 * from `summarizeOwnDeltas`'s own `ChangeSubjectSummary[]` resolved against
 * the option's own current head: the option's *own* deltas since its fork
 * point, never a diff of two projected states (see `optionTouch.ts`'s own
 * module comment for why that distinction matters — main can drift
 * independently after the option forks).
 * Distinct from `describeEnvelope` (`src/engine/describeEnvelope.ts`): that
 * reads `deltas[0]` plus a count, right for a commit title but not for
 * "everything this option changed" — this reads every touched subject.
 *
 * "Retires" and "removes … from the model" are deliberately two different
 * verbs, matching the outcome row's own two distinct outcomes (ADR-000):
 * a lifecycle retirement (`OptionTouch.lifecycleRetiredElements`,
 * `useElementRetire.ts` — the element still exists) reads "retires X";
 * a real removal (`OptionTouch.retiredElements`, `useElementRemoveFromModel.ts`
 * — the element no longer exists at all) reads "removes X from the model".
 * A "replaced by X" option (a lifecycle retirement *with* a `replaces`
 * edge) needs no third verb of its own here — it already reads correctly
 * as "Retires PM, adds Hana equivalent" from the two parts above, exactly
 * the sprint's own worked example.
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
  if (touch.lifecycleRetiredElements.length === 1) parts.push(`retires ${touch.lifecycleRetiredElements[0]?.name ?? 'an element'}`);
  else if (touch.lifecycleRetiredElements.length > 1) parts.push(`retires ${String(touch.lifecycleRetiredElements.length)} elements`);

  if (touch.retiredElements.length === 1) parts.push(`removes ${touch.retiredElements[0]?.name ?? 'an element'} from the model`);
  else if (touch.retiredElements.length > 1) parts.push(`removes ${String(touch.retiredElements.length)} elements from the model`);

  if (touch.addedElements.length === 1) parts.push(`adds ${touch.addedElements[0]?.name ?? 'an element'}`);
  else if (touch.addedElements.length > 1) parts.push(`adds ${String(touch.addedElements.length)} elements`);

  if (touch.repointedRelationshipCount > 0) {
    parts.push(`re-points ${String(touch.repointedRelationshipCount)} ${pluralize(touch.repointedRelationshipCount, 'connection')}`);
  }

  const [first, ...rest] = parts;
  if (first === undefined) return null;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(', ');
}

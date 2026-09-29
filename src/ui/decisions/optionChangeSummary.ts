/**
 * F6.3 (decision page rework, Part B): the one-line "what this option does"
 * under each option's header ("Retires PM, adds Hana equivalent, re-points
 * 4 flows") — derived purely from `computeVersionDiff(mainHead, optionHead)`
 * (`src/engine/versionDiff.ts`), never a second fetch or a new engine
 * concept. Distinct from `describeEnvelope` (`src/engine/describeEnvelope.ts`):
 * that reads `deltas[0]` plus a count, right for a commit title but not for
 * "everything this option changed vs main" — this reads every element/
 * relationship state the diff produced.
 *
 * `null` means "nothing to summarise" — the caller renders "No changes
 * recorded yet" instead (an empty-delta option, decision 3 in the sprint's
 * own brief), never an empty string.
 */
import type { VersionDiff } from '../../engine/versionDiff';

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export function summarizeOptionChanges(diff: VersionDiff): string | null {
  const removedElements = diff.elements.filter((e) => e.state === 'removed');
  const addedElements = diff.elements.filter((e) => e.state === 'added');
  // `replaces` edges are bookkeeping for the retire/add facts already
  // counted above, not a "connection" in their own right — excluded here so
  // a retire-with-replacement option doesn't double-count the same fact as
  // both "retires X" and "re-points 1 connection".
  const repointedRelationships = diff.relationships.filter((r) => {
    if (r.state === 'added') return r.toBe?.relationshipType !== 'replaces';
    if (r.state === 'removed') return r.asIs?.relationshipType !== 'replaces';
    return false;
  });

  const parts: string[] = [];
  if (removedElements.length === 1) parts.push(`retires ${removedElements[0]?.asIs?.name ?? 'an element'}`);
  else if (removedElements.length > 1) parts.push(`retires ${String(removedElements.length)} elements`);

  if (addedElements.length === 1) parts.push(`adds ${addedElements[0]?.toBe?.name ?? 'an element'}`);
  else if (addedElements.length > 1) parts.push(`adds ${String(addedElements.length)} elements`);

  if (repointedRelationships.length > 0) {
    parts.push(`re-points ${String(repointedRelationships.length)} ${pluralize(repointedRelationships.length, 'connection')}`);
  }

  const [first, ...rest] = parts;
  if (first === undefined) return null;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(', ');
}

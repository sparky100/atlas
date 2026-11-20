import type { UUID } from '../../contracts/delta';
import type { Head } from '../../engine/deltas';
import { computeVersionDiff } from '../../engine/versionDiff';

/**
 * What the "Clean changes" section of a review lists: the elements and
 * relationships this change actually adds, edits or retires, that have no
 * conflict or warning. `classifyMerge` also calls every subject that nobody
 * touched "trivially clean", so its list is the whole model; the heading used
 * to count that list while the section showed only the changed ones (a change
 * that added one system said "Clean changes (86)"). The heading and the list
 * now both come from here, so they always agree.
 */
export function cleanChangeList(base: Head, ours: Head, cleanIds: readonly UUID[]) {
  const diff = computeVersionDiff(base, ours);
  const cleanIdSet = new Set(cleanIds);
  return {
    elements: diff.elements.filter((e) => cleanIdSet.has(e.elementId) && e.state !== 'unchanged'),
    relationships: diff.relationships.filter((r) => cleanIdSet.has(r.relationshipId) && r.state !== 'unchanged'),
  };
}

export function cleanChangeCount(base: Head, ours: Head, cleanIds: readonly UUID[]): number {
  const { elements, relationships } = cleanChangeList(base, ours, cleanIds);
  return elements.length + relationships.length;
}

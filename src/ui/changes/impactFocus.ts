/**
 * What a change's impact panels show first (ADR-024's "Amended — change
 * impact"). A change in a project shows the affected capabilities in that
 * project's declared scope; everything else it reaches is still listed, but
 * collapsed — a widely used system can reach many capabilities, and the
 * project already says which ones the work is about. With no project, or
 * nothing in scope among them, everything is shown: narrowing to an empty
 * list would read as "nothing affected", which is false.
 *
 * Display only. Reviewer routing (`deriveReviewers.ts`) reads the full
 * `affectedCapabilities` list, collapsed ones included.
 */
import type { UUID } from '../../contracts/delta';
import type { AffectedCapability, ImpactReason } from '../../db/changeSummary';
import type { AffectedValueStream } from '../valueStreams/impactTraversal';

export interface ImpactFocus {
  /** True when the shown lists are narrowed to the project's declared scope. */
  focused: boolean;
  shownCapabilities: AffectedCapability[];
  collapsedCapabilities: AffectedCapability[];
  shownValueStreams: AffectedValueStream[];
  collapsedValueStreams: AffectedValueStream[];
}

export function focusImpact(affectedCapabilities: readonly AffectedCapability[], affectedValueStreams: readonly AffectedValueStream[], projectScopeIds: ReadonlySet<UUID> | null): ImpactFocus {
  const inScope = projectScopeIds === null ? [] : affectedCapabilities.filter((ac) => projectScopeIds.has(ac.capability.element_id));
  if (inScope.length === 0) {
    return { focused: false, shownCapabilities: [...affectedCapabilities], collapsedCapabilities: [], shownValueStreams: [...affectedValueStreams], collapsedValueStreams: [] };
  }
  const shownIds = new Set(inScope.map((ac) => ac.capability.element_id));
  const shownValueStreams: AffectedValueStream[] = [];
  const collapsedValueStreams: AffectedValueStream[] = [];
  for (const entry of affectedValueStreams) {
    // A stream is shown when a shown capability reaches one of its stages —
    // and then only with those stages, so the panel never credits a stage to
    // the project that only a collapsed capability reaches.
    const shownStages = entry.stages.filter((s) => s.viaCapabilities.some((c) => shownIds.has(c.element_id)));
    if (shownStages.length > 0) shownValueStreams.push({ stream: entry.stream, stages: shownStages });
    else collapsedValueStreams.push(entry);
  }
  return {
    focused: true,
    shownCapabilities: inScope,
    collapsedCapabilities: affectedCapabilities.filter((ac) => !shownIds.has(ac.capability.element_id)),
    shownValueStreams,
    collapsedValueStreams,
  };
}

export function describeImpactReason(reason: ImpactReason): string {
  switch (reason.kind) {
    case 'direct':
      return 'edited directly';
    case 'edited':
      return `${reason.systemName} edited`;
    case 'module':
      return `module ${reason.moduleName} edited`;
    case 'integration':
      return reason.relationshipType === 'uses' ? `integration: ${reason.consumerName} uses ${reason.otherName}` : `integration: ${reason.consumerName} sends data to ${reason.otherName}`;
    case 'supports':
      return `${reason.systemName}'s support for it changed`;
  }
}

/** Every reason for one capability as a single line, duplicates (the same integration edited in two commits) dropped. */
export function describeImpactReasons(reasons: readonly ImpactReason[]): string {
  return [...new Set(reasons.map(describeImpactReason))].join('; ');
}

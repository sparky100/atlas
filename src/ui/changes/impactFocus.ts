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
import type { AffectedCapability, ChangeAffectedValueStream, ImpactReason, ValueStreamReason } from '../../db/changeSummary';

export interface ImpactFocus {
  /** True when the shown lists are narrowed to the project's declared scope. */
  focused: boolean;
  shownCapabilities: AffectedCapability[];
  collapsedCapabilities: AffectedCapability[];
  shownValueStreams: ChangeAffectedValueStream[];
  collapsedValueStreams: ChangeAffectedValueStream[];
}

export function focusImpact(affectedCapabilities: readonly AffectedCapability[], affectedValueStreams: readonly ChangeAffectedValueStream[], projectScopeIds: ReadonlySet<UUID> | null): ImpactFocus {
  const inScope = projectScopeIds === null ? [] : affectedCapabilities.filter((ac) => projectScopeIds.has(ac.capability.element_id));
  if (inScope.length === 0) {
    return { focused: false, shownCapabilities: [...affectedCapabilities], collapsedCapabilities: [], shownValueStreams: [...affectedValueStreams], collapsedValueStreams: [] };
  }
  const shownIds = new Set(inScope.map((ac) => ac.capability.element_id));
  const shownValueStreams: ChangeAffectedValueStream[] = [];
  const collapsedValueStreams: ChangeAffectedValueStream[] = [];
  for (const entry of affectedValueStreams) {
    // A stream is shown when the change names it or one of its stages
    // directly (ADR-023's "Amended — change impact": that is what the change
    // is about, whatever the project's scope), or a shown capability reaches
    // one of its stages — and then only with those stages, so the panel never
    // credits a stage to the project that only a collapsed capability reaches.
    const shownStages = entry.stages.filter((s) => s.reasons.length > 0 || s.viaCapabilities.some((c) => shownIds.has(c.element_id)));
    if (shownStages.length > 0 || entry.reasons.length > 0) shownValueStreams.push({ ...entry, stages: shownStages });
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

export function describeValueStreamReason(reason: ValueStreamReason): string {
  switch (reason.kind) {
    case 'stage':
      return reason.change === 'edited' ? 'stage edited directly' : `stage ${reason.change}`;
    case 'stream':
      return reason.change === 'edited' ? 'stream edited directly' : `stream ${reason.change}`;
    case 'enables':
      return reason.change === 'added' ? `${reason.capabilityName} now enables it` : reason.change === 'removed' ? `${reason.capabilityName} no longer enables it` : `${reason.capabilityName}'s enables link changed`;
  }
}

/** Every direct reason for one stage or stream as a single line, duplicates dropped. */
export function describeValueStreamReasons(reasons: readonly ValueStreamReason[]): string {
  return [...new Set(reasons.map(describeValueStreamReason))].join('; ');
}

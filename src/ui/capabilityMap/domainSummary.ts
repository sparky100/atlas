/**
 * Capability map redesign (density pass): a collapsed domain's own summary
 * — the plain coverage sentence and the segmented mini-bar's per-segment
 * state — pulled out as pure functions so the exact same "has a
 * supporting system" definition backs both, from the same
 * `subtreeCapabilityIds` set `computeCapabilityRollup` already produces,
 * rather than two independently-derived lists that could drift apart.
 * Unit-tested directly, without rendering `CapabilityMapView`.
 */
import type { UUID } from '../../contracts/delta';
import type { RelationshipsHeadRow } from '../../contracts/rows';
import { supportingSystemIds } from './metrics';

export interface DomainCoverageSegment {
  capabilityId: UUID;
  hasSupport: boolean;
}

/** One segment per subtree capability (the domain's own id plus every L2/L3 descendant), in the same order `subtreeCapabilityIds` already provides — the collapsed row's mini-bar renders these left to right. */
export function domainCoverageSegments(subtreeCapabilityIds: readonly UUID[], subtreeSupportsEdges: readonly RelationshipsHeadRow[]): DomainCoverageSegment[] {
  return subtreeCapabilityIds.map((capabilityId) => ({
    capabilityId,
    hasSupport: supportingSystemIds(capabilityId, subtreeSupportsEdges).length > 0,
  }));
}

/** "5 of 7 capabilities have a supporting system" — the collapsed domain row's own plain-text count, worded as a sentence rather than the old "X/Y supported" fraction, from the same rollup numbers (`supportedCapabilityCount`/`totalCapabilityCount`). */
export function domainCoverageSummary(supportedCount: number, totalCount: number): string {
  return `${String(supportedCount)} of ${String(totalCount)} capabilit${totalCount === 1 ? 'y has' : 'ies have'} a supporting system`;
}

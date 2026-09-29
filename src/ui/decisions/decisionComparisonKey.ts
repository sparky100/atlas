/**
 * F6.3 (decision page rework, Part B): `useDecisionComparison.ts`'s own
 * `useEffect` dependency key, extracted so it's unit-testable directly —
 * hooks aren't rendered in this repo's test setup (no React Testing
 * Library), so the only way to actually prove "a ratings change doesn't
 * re-run the comparison effect" is to test the pure key-building function
 * the effect's dependency array is keyed on, not the hook itself.
 *
 * Joined strings, not array identity (`useRelationshipTargetSearch.ts`'s
 * own `typesKey` precedent) — `capabilityIds`/`otherConcernElementIds`/
 * `options` are fresh arrays every render, so a `useEffect` keyed on the
 * arrays themselves would re-fire every render regardless of content.
 * `baseCommitId` is part of each option's own key (not just `branchId`/
 * `headCommitId`) because it's a real input to the comparison now (Part
 * B's own-delta derivation, `compareOptions.ts`) — a rebase that moves
 * `base_commit_id` without moving `head_commit_id` would otherwise never
 * re-trigger a refetch.
 */
import type { UUID } from '../../contracts/delta';

export interface DecisionComparisonKeyOption {
  branchId: UUID;
  baseCommitId: UUID;
  headCommitId: UUID;
}

export function decisionComparisonKey(capabilityIds: readonly UUID[], otherConcernElementIds: readonly UUID[], options: readonly DecisionComparisonKeyOption[]): string {
  const capabilityIdsKey = capabilityIds.join(',');
  const otherConcernElementIdsKey = otherConcernElementIds.join(',');
  const optionsKey = options.map((o) => `${o.branchId}:${o.baseCommitId}:${o.headCommitId}`).join(',');
  return `${capabilityIdsKey}|${otherConcernElementIdsKey}|${optionsKey}`;
}

/**
 * "Platform · Module" — a bare module name ("PM", "FI") is ambiguous
 * without knowing whose module it is. Pulled out of `RelationshipsSection.tsx`
 * so it's unit-testable without mounting a component, the same split
 * `relationshipRemovalEffect.ts` already uses; the naming itself is
 * `moduleDisplayName`'s own (`src/ui/elements/moduleDisplayName.ts`), the
 * one shared implementation every surface that can show a module name
 * uses — this file's own job is just resolving `other`'s parent out of
 * whatever map this page already has.
 */
import type { UUID } from '../../../contracts/delta';
import type { ElementsHeadRow } from '../../../contracts/rows';
import { moduleDisplayName } from '../../elements/moduleDisplayName';

/**
 * `other`'s own display name — "Platform · Module" when `other` is a
 * container whose parent is a live platform system found in `endpoints`,
 * otherwise just `other.name`. `endpoints` is whatever map the caller
 * already has (`useElementPage.ts` folds a container's own parent into its
 * `relationshipEndpoints` alongside every other endpoint) — this never
 * looks anything up beyond that map.
 */
export function endpointDisplayName(other: ElementsHeadRow, endpoints: ReadonlyMap<UUID, ElementsHeadRow>): string {
  const parent = other.parent_id !== null ? (endpoints.get(other.parent_id) ?? null) : null;
  return moduleDisplayName(other, parent);
}

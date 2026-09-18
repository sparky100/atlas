/**
 * "Platform · Module" — a bare module name ("PM", "FI") is ambiguous
 * without knowing whose module it is, the same reasoning
 * `landscapeModules.ts`'s own `withModuleLabels` already applies on the
 * landscape canvas. Pulled out of `RelationshipsSection.tsx` so it's
 * unit-testable without mounting a component, the same split
 * `relationshipRemovalEffect.ts` already uses.
 */
import type { UUID } from '../../../contracts/delta';
import type { ElementsHeadRow } from '../../../contracts/rows';
import { isPlatform } from '../../elements/systemKind';

/**
 * `other`'s own display name — "Platform · Module" when `other` is a
 * container whose parent is a live platform system found in `endpoints`,
 * otherwise just `other.name`. `endpoints` is whatever map the caller
 * already has (`useElementPage.ts` folds a container's own parent into its
 * `relationshipEndpoints` alongside every other endpoint) — this never
 * looks anything up beyond that map.
 */
export function endpointDisplayName(other: ElementsHeadRow, endpoints: ReadonlyMap<UUID, ElementsHeadRow>): string {
  if (other.element_type !== 'container' || other.parent_id === null) return other.name;
  const parent = endpoints.get(other.parent_id);
  return parent && isPlatform(parent) ? `${parent.name} · ${other.name}` : other.name;
}

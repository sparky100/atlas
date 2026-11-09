/**
 * V2 "landscape focus and filters": "canvas shows only matches" — a plain
 * `matches*`/`filter*` pure-function pair, mirroring
 * `src/ui/capabilityMap/capabilityMapPickerFilter.ts`'s own shape. Filtering
 * happens entirely client-side against rows `useLandscape.ts` already
 * loads (every one of `lifecycleStatus`/`criticality`/`kind`/`domain` is
 * already on `ElementsHeadRow.attributes` — no new query) and, unlike
 * focus mode (a draw-time concern, `LandscapeCanvas.tsx`), feeds the
 * *layout* — a filtered-out system is removed before
 * `computeLandscapeLayout` runs at all, so lane emptiness/height/edge
 * geometry all correctly reflect the reduced set (`useLandscapeDisplay.ts`).
 */
import type { Criticality, LifecycleStatus, SystemDomain, SystemKind, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { attributesRecord } from '../elements/attributesRecord';
import { domainOf } from '../elements/systemDomain';
import { kindOf } from '../elements/systemKind';
import type { LandscapeSystemGrouping } from './layout';

export interface LandscapeFilters {
  /** Level-1 capability lane keys (element ids) — OR-matched against a system's own lane membership (primary placement or a secondary "+N" reference, both from `groupSystemsByLane`). */
  capabilityIds: readonly UUID[];
  lifecycleStatuses: readonly LifecycleStatus[];
  criticalities: readonly Criticality[];
  kinds: readonly SystemKind[];
  domains: readonly SystemDomain[];
}

export const EMPTY_LANDSCAPE_FILTERS: LandscapeFilters = { capabilityIds: [], lifecycleStatuses: [], criticalities: [], kinds: [], domains: [] };

export function hasActiveLandscapeFilters(filters: LandscapeFilters): boolean {
  return filters.capabilityIds.length > 0 || filters.lifecycleStatuses.length > 0 || filters.criticalities.length > 0 || filters.kinds.length > 0 || filters.domains.length > 0;
}

function lifecycleStatusOf(system: ElementsHeadRow): LifecycleStatus | null {
  const value = attributesRecord(system.attributes).lifecycleStatus;
  return value === 'planned' || value === 'active' || value === 'retiring' || value === 'retired' ? value : null;
}

function criticalityOf(system: ElementsHeadRow): Criticality | null {
  const value = attributesRecord(system.attributes).criticality;
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low' ? value : null;
}

/**
 * Actors are exempt from every facet here: they carry none of
 * `lifecycleStatus`/`criticality`/`kind`/`domain`, and don't `supports` a
 * capability either, so there is nothing on an actor any of these five
 * filters could ever test — callers only ever run this against systems,
 * never actors, and an actor is always shown regardless of filter state.
 *
 * An unrecorded lifecycle/criticality never satisfies an active filter on
 * that facet — a system with no criticality set is hidden the moment
 * "critical" is checked, not silently exempted. `kindOf`/`domainOf` always
 * default to a real value (`'application'`/`'it'`), so they have no
 * equivalent "unrecorded" case to guard.
 *
 * `laneKeysForSystem` absent (e.g. a system this diagram somehow has no
 * lane classification for) fails the capability facet the same way an
 * unrecorded lifecycle/criticality does — hidden, not exempted.
 */
export function matchesLandscapeFilters(system: ElementsHeadRow, filters: LandscapeFilters, laneKeysForSystem: ReadonlySet<string> | undefined): boolean {
  if (filters.lifecycleStatuses.length > 0) {
    const status = lifecycleStatusOf(system);
    if (status === null || !filters.lifecycleStatuses.includes(status)) return false;
  }
  if (filters.criticalities.length > 0) {
    const criticality = criticalityOf(system);
    if (criticality === null || !filters.criticalities.includes(criticality)) return false;
  }
  if (filters.kinds.length > 0 && !filters.kinds.includes(kindOf(system))) return false;
  if (filters.domains.length > 0 && !filters.domains.includes(domainOf(system))) return false;
  if (filters.capabilityIds.length > 0 && !filters.capabilityIds.some((id) => laneKeysForSystem?.has(id))) return false;
  return true;
}

export function filterLandscapeSystems(systems: readonly ElementsHeadRow[], filters: LandscapeFilters, laneKeysBySystemIdMap: ReadonlyMap<UUID, ReadonlySet<string>>): ElementsHeadRow[] {
  return systems.filter((s) => matchesLandscapeFilters(s, filters, laneKeysBySystemIdMap.get(s.element_id)));
}

/**
 * Every lane key a system touches — its own primary placement plus every
 * lane it merely *references* (`layout.ts`'s "+N" secondary-supporter
 * chips) — built from `groupSystemsByLane`'s own two outputs, cheap (no
 * pixel math), the exact input the capability facet above needs.
 */
export function laneKeysBySystemId(grouping: Pick<LandscapeSystemGrouping, 'byLane' | 'referenceTargets'>): Map<UUID, Set<string>> {
  const result = new Map<UUID, Set<string>>();
  for (const [laneKey, members] of grouping.byLane) {
    for (const member of members) {
      const set = result.get(member.element_id) ?? new Set<string>();
      set.add(laneKey);
      result.set(member.element_id, set);
    }
  }
  for (const ref of grouping.referenceTargets) {
    const set = result.get(ref.elementId) ?? new Set<string>();
    set.add(ref.laneKey);
    result.set(ref.elementId, set);
  }
  return result;
}

/**
 * People and teams that only own things have no `uses`/`flows_to` line, so
 * on the landscape they float unconnected. They are shown only when asked
 * for (`showOwners`); an external organisation, and any actor an edge
 * actually touches, always stays.
 */
export function visibleLandscapeActors(actors: readonly ElementsHeadRow[], edges: readonly RelationshipsHeadRow[], showOwners: boolean): ElementsHeadRow[] {
  if (showOwners) return [...actors];
  const connectedIds = new Set(edges.flatMap((e) => [e.from_element_id, e.to_element_id]));
  return actors.filter((a) => connectedIds.has(a.element_id) || attributesRecord(a.attributes).isExternal === true);
}

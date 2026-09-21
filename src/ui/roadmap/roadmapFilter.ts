/**
 * F5's own "filters (capability, owner, criticality, contracts ending)"
 * (docs/prompts/atlas-prompt-pack.md), mirroring
 * `src/ui/landscape/landscapeFilter.ts`'s `matches*`/`filter*` shape.
 *
 * "Contracts ending" has no data source: this repo's own model has no
 * contract entity or contract-end-date attribute anywhere (grepped —
 * nothing). `supportEndsAt` (vendor support end) is the only real
 * date-shaped candidate, so `supportEndingSoon` filters on that — reusing
 * `STALE_AFTER_MONTHS`/`monthsUntil`, the same "within the horizon"
 * threshold `metrics.ts`'s own `lifecycleExposure` already uses, rather
 * than inventing a second one. The filter chip/label says "Support
 * ending," never "Contracts ending" — this repo doesn't model contracts,
 * and labelling it as one would assert a fact nothing here actually
 * tracks.
 */
import type { Criticality, UUID } from '../../contracts/delta';
import { monthsUntil, STALE_AFTER_MONTHS } from '../../contracts/thresholds';
import type { RoadmapLifecycleBar } from './roadmapLifecycleRows';

export interface RoadmapFilters {
  capabilityIds: readonly UUID[];
  ownerIds: readonly UUID[];
  criticalities: readonly Criticality[];
  supportEndingSoon: boolean;
}

export const EMPTY_ROADMAP_FILTERS: RoadmapFilters = { capabilityIds: [], ownerIds: [], criticalities: [], supportEndingSoon: false };

export function hasActiveRoadmapFilters(filters: RoadmapFilters): boolean {
  return filters.capabilityIds.length > 0 || filters.ownerIds.length > 0 || filters.criticalities.length > 0 || filters.supportEndingSoon;
}

function isSupportEndingSoon(bar: RoadmapLifecycleBar, now: Date): boolean {
  if (bar.supportEndsAt === undefined) return false;
  const date = new Date(bar.supportEndsAt);
  return !Number.isNaN(date.getTime()) && monthsUntil(date, now) <= STALE_AFTER_MONTHS;
}

/**
 * `groupKey` is the bar's own capability-facet key — `RoadmapLifecycleBar.capabilityKey`
 * (the level-1 capability reached via its primary `supports` edge) when
 * set, else the group key the caller fell back to (`UNASSIGNED_GROUP_KEY`
 * included) — so the capability facet matches the bar's own capability
 * identically under capability and value-stream grouping, the same way the
 * landscape's own capability filter matches lane membership, not some
 * other, unrelated per-bar capability field.
 */
export function matchesRoadmapFilters(bar: RoadmapLifecycleBar, groupKey: string, filters: RoadmapFilters, now: Date = new Date()): boolean {
  if (filters.capabilityIds.length > 0 && !filters.capabilityIds.includes(groupKey)) return false;
  if (filters.ownerIds.length > 0 && !filters.ownerIds.some((id) => bar.ownerActorIds.includes(id))) return false;
  if (filters.criticalities.length > 0 && (bar.criticality === undefined || !filters.criticalities.includes(bar.criticality as Criticality))) return false;
  if (filters.supportEndingSoon && !isSupportEndingSoon(bar, now)) return false;
  return true;
}

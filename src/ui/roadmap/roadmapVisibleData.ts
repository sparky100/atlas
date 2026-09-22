/**
 * The currently-applied filters/mode, applied once — shared by the on-screen
 * `RoadmapView` and the table/PNG export (`roadmapExport.ts`,
 * `roadmapPngExport.ts`) so what gets exported can never silently drift from
 * what's on screen (the same "the visible set is already in hand" stance
 * `useElementExport.ts`'s own module comment states for F8).
 */
import type { UUID } from '../../contracts/delta';
import type { RoadmapBranchEvents } from '../../db/roadmapChangeEvents';
import { isRoadmapEligibleBranch, type RoadmapMode } from './roadmapEligibility';
import { matchesRoadmapFilters, type RoadmapFilters } from './roadmapFilter';
import type { RoadmapGroup } from './roadmapLifecycleRows';

export interface RoadmapVisibleData {
  filteredGroups: readonly RoadmapGroup[];
  eligibleEvents: readonly RoadmapBranchEvents[];
}

export function computeRoadmapVisibleData(groups: readonly RoadmapGroup[], branchEvents: readonly RoadmapBranchEvents[], mode: RoadmapMode, filters: RoadmapFilters, now: Date): RoadmapVisibleData {
  const filteredGroups = groups
    // The capability facet matches the bar's own level-1 capability, not the
    // group key — the same bar groups under a stream id in value-stream mode,
    // so `group.key` is no longer the right thing to filter capabilities on.
    .map((group) => ({ ...group, bars: group.bars.filter((bar) => matchesRoadmapFilters(bar, bar.capabilityKey ?? group.key, filters, now)) }))
    .filter((group) => group.bars.length > 0);
  const eligibleEvents = branchEvents.filter(({ branch }) => isRoadmapEligibleBranch(branch, mode));
  return { filteredGroups, eligibleEvents };
}

/** The one description string for a change event — shared by `RoadmapChangesList`'s on-screen row and the CSV/PNG export's own change row, so the wording can't drift between what's shown and what's exported. */
export function changeDescription(event: RoadmapBranchEvents['events'][number]): string {
  if (event.kind === 'add') return `${event.elementName} added`;
  if (event.kind === 'retire') return `${event.elementName} retired`;
  return event.capabilityName === undefined
    ? `${event.fromSystemName} replaced by ${event.toSystemName}`
    : `${event.fromSystemName} replaced by ${event.toSystemName} (${event.capabilityName})`;
}

export interface RoadmapSystemEvent {
  event: RoadmapBranchEvents['events'][number];
  branch: RoadmapBranchEvents['branch'];
}

/**
 * The on-screen "Changes on this roadmap" list shows only this many of the
 * most recently-dated changes (latest `target_date` first), not every change
 * ever recorded — the full list grows without bound and buries what's
 * actually next. Shared with the CSV/PNG export so what's exported can never
 * drift from what's on screen (the same invariant the rest of this module
 * already maintains for filters/mode).
 */
export const RECENT_CHANGES_LIMIT = 6;

export interface RoadmapChangeRow {
  branch: RoadmapBranchEvents['branch'];
  event: RoadmapBranchEvents['events'][number];
}

/** Flattened, mode-eligible change rows, latest `target_date` first, capped at `RECENT_CHANGES_LIMIT`. */
export function recentRoadmapChanges(eligibleEvents: readonly RoadmapBranchEvents[]): RoadmapChangeRow[] {
  const rows: RoadmapChangeRow[] = [];
  for (const { branch, events } of eligibleEvents) {
    for (const event of events) rows.push({ branch, event });
  }
  rows.sort((a, b) => (b.branch.target_date ?? '').localeCompare(a.branch.target_date ?? ''));
  return rows.slice(0, RECENT_CHANGES_LIMIT);
}

/** Every mode-eligible event touching `systemId` — shared by `RoadmapView`'s own marker rendering and the PNG export, so a marker never appears in one and not the other. */
export function eventsForSystem(systemId: UUID, branchEvents: readonly RoadmapBranchEvents[], mode: RoadmapMode): RoadmapSystemEvent[] {
  const result: RoadmapSystemEvent[] = [];
  for (const { branch, events } of branchEvents) {
    if (!isRoadmapEligibleBranch(branch, mode)) continue;
    for (const event of events) {
      if (event.kind === 'add' && event.elementId === systemId) result.push({ event, branch });
      else if (event.kind === 'retire' && event.elementId === systemId) result.push({ event, branch });
      else if (event.kind === 'replace' && (event.fromSystemId === systemId || event.toSystemId === systemId)) result.push({ event, branch });
    }
  }
  return result;
}

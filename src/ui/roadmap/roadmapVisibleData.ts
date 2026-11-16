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
import type { RoadmapGroup, RoadmapLifecycleBar } from './roadmapLifecycleRows';
import { computeRoadmapForwardRange, computeRoadmapWindow, defaultRoadmapWindowStart, roadmapPastStart, type RoadmapHorizon, type RoadmapTimelineRange } from './roadmapTimelineScale';

export interface RoadmapVisibleData {
  filteredGroups: readonly RoadmapGroup[];
  eligibleEvents: readonly RoadmapBranchEvents[];
  /** Systems left off because they were already retired before the timeline starts (each counted once). */
  hiddenRetiredCount: number;
  /** Changes left off because they were delivered before the timeline starts. */
  hiddenChangeCount: number;
}

/** `YYYY-MM-DD` in local time — the shape change and system dates are stored in, so plain string comparison orders them. */
function isoDay(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Already retired before `floor`: it has nothing left to draw. A retired system with no end date has no place on the timeline, so it comes back only with "Show the past year". */
function isGoneBefore(bar: RoadmapLifecycleBar, floorIso: string, showPast: boolean): boolean {
  if (bar.lifecycleTag?.state !== 'retired') return false;
  return bar.plannedEnd === undefined ? !showPast : bar.plannedEnd < floorIso;
}

/**
 * The Roadmap starts at today (or a year earlier with `showPast`): systems
 * retired before that and changes delivered before that are left off, and
 * counted so the page can say so.
 */
export function computeRoadmapVisibleData(groups: readonly RoadmapGroup[], branchEvents: readonly RoadmapBranchEvents[], mode: RoadmapMode, filters: RoadmapFilters, now: Date, showPast = false): RoadmapVisibleData {
  const floorIso = isoDay(roadmapPastStart(now, showPast));
  // The capability facet matches the bar's own level-1 capability, not the
  // group key — the same bar groups under a stream id in value-stream mode,
  // so `group.key` is no longer the right thing to filter capabilities on.
  const matching = groups.map((group) => ({ ...group, bars: group.bars.filter((bar) => matchesRoadmapFilters(bar, bar.capabilityKey ?? group.key, filters, now)) }));
  const hiddenRetiredCount = new Set(matching.flatMap((group) => group.bars.filter((bar) => isGoneBefore(bar, floorIso, showPast)).map((bar) => bar.systemId))).size;
  const filteredGroups = matching
    .map((group) => ({ ...group, bars: group.bars.filter((bar) => !isGoneBefore(bar, floorIso, showPast)) }))
    .filter((group) => group.bars.length > 0);
  const modeEligible = branchEvents.filter(({ branch }) => isRoadmapEligibleBranch(branch, mode));
  const eligibleEvents = modeEligible.filter(({ branch }) => (branch.target_date ?? '') >= floorIso);
  return { filteredGroups, eligibleEvents, hiddenRetiredCount, hiddenChangeCount: modeEligible.length - eligibleEvents.length };
}

/** Every date a bar or marker can sit on — only the latest matters, since the timeline never starts earlier than today (or a year back). */
function allDatesFor(groups: readonly RoadmapGroup[], branchEvents: readonly RoadmapBranchEvents[], mode: RoadmapMode): (string | undefined)[] {
  const dates: (string | undefined)[] = [];
  for (const group of groups) {
    for (const bar of group.bars) dates.push(bar.introduced, bar.plannedEnd, bar.supportEndsAt);
  }
  for (const { branch } of branchEvents) {
    if (isRoadmapEligibleBranch(branch, mode)) dates.push(branch.target_date ?? undefined);
  }
  return dates;
}

/** The one timeline range, shared by the page and both exports so what is exported is what is on screen. A window start earlier than the floor (a stale link) is pulled up to it. */
export function roadmapRangeFor(groups: readonly RoadmapGroup[], branchEvents: readonly RoadmapBranchEvents[], mode: RoadmapMode, horizon: RoadmapHorizon, windowStart: Date | undefined, now: Date, showPast: boolean): RoadmapTimelineRange {
  const floor = roadmapPastStart(now, showPast);
  const full = computeRoadmapForwardRange(allDatesFor(groups, branchEvents, mode), now, showPast);
  const start = windowStart === undefined || windowStart.getTime() < floor.getTime() ? defaultRoadmapWindowStart(horizon, now, showPast) : windowStart;
  return computeRoadmapWindow(horizon, full, now, start);
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

/** One plain line saying what the start date left off, or `null` when nothing was left off. */
export function hiddenNoteFor(retired: number, changes: number, showPast: boolean): string | null {
  const parts: string[] = [];
  if (retired > 0) parts.push(`${String(retired)} already-retired ${retired === 1 ? 'system' : 'systems'}`);
  if (changes > 0) parts.push(`${String(changes)} earlier ${changes === 1 ? 'change' : 'changes'}`);
  if (parts.length === 0) return null;
  const what = parts.join(' and ');
  return showPast ? `${what} from before the past year ${retired + changes === 1 ? 'is' : 'are'} not shown.` : `${what} ${retired + changes === 1 ? 'is' : 'are'} hidden. Turn on “Show the past year” to see the most recent.`;
}

/**
 * F5's own table export — one flat CSV covering both a system's lifecycle
 * row and every change event on the roadmap, over exactly the currently
 * filtered/moded set `roadmapVisibleData.ts` computes (never the full,
 * unfiltered model — the same "the visible set is already in hand" stance
 * `useElementExport.ts`'s own module comment states for F8).
 *
 * One flat table rather than F8's per-type-sheet `.xlsx` — a roadmap has
 * only ever one kind of row-subject (a system) plus change events, so there
 * is no per-type column drift to reconcile the way element export has
 * across capability/system/container/actor.
 */
import { type RoadmapGroup, type RoadmapLifecycleBar } from './roadmapLifecycleRows';
import { changeDescription, recentRoadmapChanges } from './roadmapVisibleData';
import type { RoadmapBranchEvents } from '../../db/roadmapChangeEvents';

const HEADER = ['Type', 'Capability', 'System', 'Introduced', 'Planned end', 'Support ends', 'Criticality', 'Lifecycle status', 'Date', 'Description'] as const;

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

function groupNameOf(group: Pick<RoadmapGroup, 'label'>): string {
  return group.label;
}

function lifecycleRow(groupName: string, bar: RoadmapLifecycleBar): string[] {
  return [
    'Lifecycle',
    groupName,
    bar.name,
    bar.introduced ?? '',
    bar.plannedEnd ?? '',
    bar.supportEndsAt ?? '',
    bar.criticality ?? '',
    bar.lifecycleStatus ?? '',
    '',
    '',
  ];
}

function changeRowCells(branch: RoadmapBranchEvents['branch'], event: RoadmapBranchEvents['events'][number]): string[] {
  const date = branch.target_date ?? '';
  if (event.kind === 'add') return ['Change', '', event.elementName, '', '', '', '', '', date, changeDescription(event)];
  if (event.kind === 'retire') return ['Change', '', event.elementName, '', '', '', '', '', date, changeDescription(event)];
  return ['Change', event.capabilityName ?? '', event.toSystemName, '', '', '', '', '', date, changeDescription(event)];
}

/** RFC 4180 CSV of the visible roadmap — lifecycle rows first (grouped as shown), then the most recent change events (latest first), matching the on-screen order of `RoadmapView`/`RoadmapChangesList`. */
export function roadmapToCsv(filteredGroups: readonly RoadmapGroup[], eligibleEvents: readonly RoadmapBranchEvents[]): string {
  const lines = [csvRow(HEADER)];

  for (const group of filteredGroups) {
    const groupName = groupNameOf(group);
    for (const bar of group.bars) lines.push(csvRow(lifecycleRow(groupName, bar)));
  }

  for (const { branch, event } of recentRoadmapChanges(eligibleEvents)) lines.push(csvRow(changeRowCells(branch, event)));

  return lines.join('\r\n');
}

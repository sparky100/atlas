import { Link } from 'react-router';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import type { RoadmapBranchEvents } from '../../db/roadmapChangeEvents';
import type { RoadmapFilters } from './roadmapFilter';
import { isRoadmapEligibleBranch, type RoadmapMode } from './roadmapEligibility';
import { UNASSIGNED_GROUP_KEY, type RoadmapCapabilityGroup, type RoadmapLifecycleBar } from './roadmapLifecycleRows';
import { computeRoadmapTimelineRange, percentAt, percentAtIso, type RoadmapTimelineRange } from './roadmapTimelineScale';
import { changeDescription, computeRoadmapVisibleData, eventsForSystem } from './roadmapVisibleData';
import styles from './RoadmapView.module.css';

export interface RoadmapViewProps {
  groups: readonly RoadmapCapabilityGroup[];
  branchEvents: readonly RoadmapBranchEvents[];
  mode: RoadmapMode;
  filters: RoadmapFilters;
  orgSlug: string;
  modelSlug: string;
  now?: Date;
}

function allDatesFor(groups: readonly RoadmapCapabilityGroup[], branchEvents: readonly RoadmapBranchEvents[], mode: RoadmapMode): (string | undefined)[] {
  const dates: (string | undefined)[] = [];
  for (const group of groups) {
    for (const bar of group.bars) {
      dates.push(bar.introduced, bar.plannedEnd, bar.supportEndsAt);
    }
  }
  for (const { branch } of branchEvents) {
    if (isRoadmapEligibleBranch(branch, mode)) dates.push(branch.target_date ?? undefined);
  }
  return dates;
}

/**
 * A single system's own row: a fixed-width name column, then a relative
 * track its bar/markers are absolutely positioned within — the same
 * "compute the geometry, let CSS draw it" split `roadmapTimelineScale.ts`'s
 * own module comment describes. `data-tone` on the bar carries the
 * capability map redesign's own "fact, not a flag" stance forward: a thin
 * shape and colour, never a filled alarm treatment.
 */
function RoadmapRow({ bar, events, range, orgSlug, modelSlug }: { bar: RoadmapLifecycleBar; events: readonly { event: RoadmapBranchEvents['events'][number]; branch: RoadmapBranchEvents['branch'] }[]; range: RoadmapTimelineRange; orgSlug: string; modelSlug: string }) {
  const startPct = percentAtIso(bar.introduced, range);
  const endPct = percentAtIso(bar.plannedEnd, range);
  const supportEndPct = percentAtIso(bar.supportEndsAt, range);
  const left = startPct ?? 0;
  const width = (endPct ?? 100) - left;

  return (
    <div className={styles.row}>
      <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${bar.systemId}`} className={styles.rowName} title={bar.name}>
        <Text as="span" size="sm">
          {bar.name}
        </Text>
      </Link>
      <div className={styles.track}>
        <div className={styles.lifecycleBar} data-tone={bar.lifecycleStatus === 'retiring' || bar.lifecycleStatus === 'retired' ? 'warn' : 'neutral'} style={{ left: `${String(left)}%`, width: `${String(Math.max(width, 0.5))}%` }} />
        {supportEndPct !== undefined && <div className={styles.supportEndTick} style={{ left: `${String(supportEndPct)}%` }} title={`Support ends ${bar.supportEndsAt ?? ''}`} />}
        {events.map(({ event, branch }, index) => {
          const pct = percentAtIso(branch.target_date ?? undefined, range);
          if (pct === undefined) return null;
          const key = `${branch.id}-${String(index)}`;
          if (event.kind === 'add') {
            return <span key={key} className={styles.marker} data-kind="add" style={{ left: `${String(pct)}%` }} title={`Added — ${branch.title ?? branch.name}`} aria-hidden="true" />;
          }
          if (event.kind === 'retire') {
            return <span key={key} className={styles.marker} data-kind="retire" style={{ left: `${String(pct)}%` }} title={`Retired — ${branch.title ?? branch.name}`} aria-hidden="true" />;
          }
          // ADR-001 amendment: `fromSystemId` is the replacement, `toSystemId`
          // is the retiring element (`buildReplacesDelta.ts`'s own "B
          // replaces A" = `from: B, to: A` convention) — the opposite of
          // this marker's own pre-PR7 fields, where `from` meant the
          // retiring system. `isFrom` here means "this bar is the
          // replacement," so its own tooltip/glyph read the other way
          // round from before.
          const isFrom = event.fromSystemId === bar.systemId;
          return (
            <span key={key} className={styles.marker} data-kind="replace" style={{ left: `${String(pct)}%` }} title={isFrom ? `Replaces ${event.toSystemName} — ${branch.title ?? branch.name}` : `Replaced by ${event.fromSystemName} — ${branch.title ?? branch.name}`} aria-hidden="true">
              {isFrom ? '←' : '→'}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Quarter tick marks along the range — orientation for "time horizontal," not a precise axis (a roadmap reads by season/quarter, not by day). */
function RoadmapAxis({ range }: { range: RoadmapTimelineRange }) {
  const ticks: { label: string; pct: number }[] = [];
  const start = new Date(range.start.getFullYear(), Math.floor(range.start.getMonth() / 3) * 3, 1);
  for (const cursor = new Date(start); cursor.getTime() <= range.end.getTime(); cursor.setMonth(cursor.getMonth() + 3)) {
    const quarter = Math.floor(cursor.getMonth() / 3) + 1;
    ticks.push({ label: `Q${String(quarter)} ${String(cursor.getFullYear())}`, pct: percentAt(cursor, range) });
  }
  return (
    <div className={styles.axis} role="img" aria-label="Timeline, by quarter">
      {ticks.map((tick) => (
        <span key={tick.label} className={styles.axisTick} style={{ left: `${String(tick.pct)}%` }}>
          <Text as="span" size="xs" tone="faint">
            {tick.label}
          </Text>
        </span>
      ))}
    </div>
  );
}

/**
 * A reliable, always-shown list of every change on the roadmap — the
 * source of truth regardless of whether a given event also found a
 * lifecycle-bar row to sit on (an added system with no lifecycle dates
 * recorded yet has nowhere on the timeline to place its own marker, but
 * the change it came from is never silently dropped for that reason).
 */
function RoadmapChangesList({ branchEvents, mode }: { branchEvents: readonly RoadmapBranchEvents[]; mode: RoadmapMode }) {
  const rows = branchEvents.filter(({ branch }) => isRoadmapEligibleBranch(branch, mode)).flatMap(({ branch, events }) => events.map((event) => ({ branch, event })));
  if (rows.length === 0) return null;

  rows.sort((a, b) => (a.branch.target_date ?? '').localeCompare(b.branch.target_date ?? ''));

  return (
    <div className={styles.changesList}>
      <Text as="h2" size="md">
        Changes on this roadmap
      </Text>
      <ul>
        {rows.map(({ branch, event }, index) => (
          <li key={`${branch.id}-${String(index)}`}>
            <Text as="span" size="sm" tone="muted">
              {branch.target_date}
            </Text>{' '}
            <Text as="span" size="sm">
              {changeDescription(event)}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * F5's own roadmap timeline (docs/prompts/atlas-prompt-pack.md) — rows
 * grouped by capability, bars from a system's own lifecycle dates, plain
 * DOM/CSS rather than Canvas (UI-principles decision 7: Canvas is reserved
 * for Landscape's own 2,000-node performance budget, never the default for
 * a capability/system-scale view). No hero panel, no aggregate stat — the
 * same role-boundary stance the capability map redesign already
 * established for this app's other structural-reference views.
 */
export function RoadmapView({ groups, branchEvents, mode, filters, orgSlug, modelSlug, now = new Date() }: RoadmapViewProps) {
  const { filteredGroups, eligibleEvents } = computeRoadmapVisibleData(groups, branchEvents, mode, filters, now);
  const range = computeRoadmapTimelineRange(allDatesFor(groups, branchEvents, mode), now);

  if (filteredGroups.length === 0 && eligibleEvents.length === 0) {
    return <EmptyState>No systems with a recorded lifecycle date (introduced, planned end or support end) yet.</EmptyState>;
  }

  return (
    <div className={styles.roadmap}>
      {filteredGroups.length > 0 && (
        <>
          <RoadmapAxis range={range} />
          <div role="list" aria-label="Capability domains">
            {filteredGroups.map((group) => (
              <div key={group.key} className={styles.group} role="listitem">
                <Text as="h2" size="md" className={styles.groupHeader}>
                  {group.key === UNASSIGNED_GROUP_KEY ? 'Unassigned' : (group.capability?.name ?? 'Unassigned')}
                </Text>
                <div role="list" aria-label={`${group.key === UNASSIGNED_GROUP_KEY ? 'Unassigned' : (group.capability?.name ?? 'Unassigned')} systems`}>
                  {group.bars.map((bar) => (
                    <div key={bar.systemId} role="listitem">
                      <RoadmapRow bar={bar} events={eventsForSystem(bar.systemId, branchEvents, mode)} range={range} orgSlug={orgSlug} modelSlug={modelSlug} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <RoadmapChangesList branchEvents={branchEvents} mode={mode} />
    </div>
  );
}

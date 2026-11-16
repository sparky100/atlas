import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { LandscapeFind, type LandscapeFindOption } from '../landscape/LandscapeFind';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { LifecycleTag } from '../components/LifecycleTag/LifecycleTag';
import { Text } from '../components/Text/Text';
import { useCanvasWidth } from '../landscape/useCanvasWidth';
import type { RoadmapBranchEvents } from '../../db/roadmapChangeEvents';
import type { RoadmapFilters } from './roadmapFilter';
import type { RoadmapMode } from './roadmapEligibility';
import { roadmapBarCaption, type RoadmapGroup, type RoadmapLifecycleBar } from './roadmapLifecycleRows';
import { computeRoadmapAxisTicks, isWithinRange, percentAtIso, thinAxisTicksToFit, todayPercent, type RoadmapGranularity, type RoadmapHorizon, type RoadmapTimelineRange } from './roadmapTimelineScale';
import { changeDescription, computeRoadmapVisibleData, eventsForSystem, hiddenNoteFor, recentRoadmapChanges, roadmapRangeFor } from './roadmapVisibleData';
import styles from './RoadmapView.module.css';

/** A conservative mobile-safe width to thin ticks against before `useCanvasWidth`'s `ResizeObserver` reports a real measurement — the report this fixes was "overlapping right on load, every time," so the very first paint has to already be thinned, not just the settled one. */
const AXIS_WIDTH_FALLBACK_PX = 300;

export interface RoadmapViewProps {
  /** The groups list's accessible name — what the groups are (F10: capability domains, value streams or projects). */
  groupsLabel?: string;
  groups: readonly RoadmapGroup[];
  branchEvents: readonly RoadmapBranchEvents[];
  mode: RoadmapMode;
  filters: RoadmapFilters;
  /** Which time unit the axis shows (months/quarters/years) — a view control, not a filter, so it lives beside `mode` rather than inside `filters`. */
  granularity: RoadmapGranularity;
  /** Which viewing window the timeline shows — `'all'` fits every date; a fixed horizon shows a sliding 1y/3y window. */
  horizon: RoadmapHorizon;
  /** The fixed-horizon window's left edge (month start); `undefined` centers on now. Ignored when `horizon` is `'all'`. */
  windowStart: Date | undefined;
  /** "Show the past year": starts the timeline a year back and brings recently retired systems and delivered changes into it. */
  showPast: boolean;
  orgSlug: string;
  modelSlug: string;
  now?: Date;
}

/**
 * A single system's own row: a fixed-width name column, then a relative
 * track its bar/markers are absolutely positioned within — the same
 * "compute the geometry, let CSS draw it" split `roadmapTimelineScale.ts`'s
 * own module comment describes. `data-tone` on the bar carries the
 * capability map redesign's own "fact, not a flag" stance forward: a thin
 * shape and colour, never a filled alarm treatment.
 */
function RoadmapRow({ bar, events, range, todayPct, showPast, orgSlug, modelSlug, found }: { found: boolean; showPast: boolean; bar: RoadmapLifecycleBar; events: readonly { event: RoadmapBranchEvents['events'][number]; branch: RoadmapBranchEvents['branch'] }[]; range: RoadmapTimelineRange; todayPct: number | undefined; orgSlug: string; modelSlug: string }) {
  const startPct = percentAtIso(bar.introduced, range);
  const endPct = percentAtIso(bar.plannedEnd, range);
  const supportEndPct = isWithinRange(bar.supportEndsAt, range) ? percentAtIso(bar.supportEndsAt, range) : undefined;
  const left = startPct ?? 0;
  const width = (endPct ?? 100) - left;

  return (
    <div className={styles.row} data-system-id={bar.systemId} data-found={found ? 'true' : undefined}>
      <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${bar.systemId}`} className={styles.rowName} title={bar.name}>
        <Text as="span" size="sm">
          {bar.name}
        </Text>
        <Text as="span" size="xs" tone="muted" className={styles.rowCaption}>
          {roadmapBarCaption(bar)}
        </Text>
        {bar.lifecycleTag && <LifecycleTag {...bar.lifecycleTag} />}
      </Link>
      <div className={styles.track}>
        {showPast && todayPct !== undefined && <div className={styles.pastBand} style={{ width: `${String(todayPct)}%` }} aria-hidden="true" />}
        <div className={styles.lifecycleBar} data-tone={bar.lifecycleStatus === 'retiring' || bar.lifecycleStatus === 'retired' ? 'warn' : 'neutral'} style={{ left: `${String(left)}%`, width: `${String(Math.max(width, 0.5))}%` }} />
        {todayPct !== undefined && <div className={styles.todayLine} style={{ left: `${String(todayPct)}%` }} title="Today" aria-hidden="true" />}
        {supportEndPct !== undefined && <div className={styles.supportEndTick} style={{ left: `${String(supportEndPct)}%` }} title={`Support ends ${bar.supportEndsAt ?? ''}`} />}
        {events.map(({ event, branch }, index) => {
          // A change outside the visible window is left off rather than pinned to an edge.
          if (!isWithinRange(branch.target_date ?? undefined, range)) return null;
          const pct = percentAtIso(branch.target_date ?? undefined, range);
          if (pct === undefined) return null;
          const key = `${branch.id}-${String(index)}`;
          if (event.kind === 'add') {
            return <span key={key} className={styles.marker} data-kind="add" style={{ left: `${String(pct)}%` }} title={`Added — ${branch.title ?? branch.name}`} aria-hidden="true" />;
          }
          if (event.kind === 'retire') {
            return <span key={key} className={styles.marker} data-kind="retire" style={{ left: `${String(pct)}%` }} title={`Retired — ${branch.title ?? branch.name}`} aria-hidden="true" />;
          }
          const isFrom = event.fromSystemId === bar.systemId;
          return (
            <span key={key} className={styles.marker} data-kind="replace" style={{ left: `${String(pct)}%` }} title={isFrom ? `Replaced by ${event.toSystemName} — ${branch.title ?? branch.name}` : `Replaces ${event.fromSystemName} — ${branch.title ?? branch.name}`} aria-hidden="true">
              {isFrom ? '→' : '←'}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Tick marks along the range — orientation for "time horizontal," not a
 * precise axis (a roadmap reads by season/quarter, not by day).
 * Granularity (months/quarters/years) picks the unit; `thinAxisTicksToFit`
 * then drops whichever ticks would collide at this container's own
 * measured width — `computeRoadmapAxisTicks` itself has no notion of
 * pixels, so without this step a narrow (mobile) axis can show ticks
 * closer together than their labels need, regardless of granularity.
 */
function RoadmapAxis({ range, granularity }: { range: RoadmapTimelineRange; granularity: RoadmapGranularity }) {
  const { ref, width } = useCanvasWidth();
  const ticks = thinAxisTicksToFit(computeRoadmapAxisTicks(range, granularity), width ?? AXIS_WIDTH_FALLBACK_PX);
  return (
    <div ref={ref} className={styles.axis} role="img" aria-label="Timeline by quarter">
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
 * A reliable, always-shown list of the most recent changes on the roadmap —
 * the source of truth regardless of whether a given event also found a
 * lifecycle-bar row to sit on (an added system with no lifecycle dates
 * recorded yet has nowhere on the timeline to place its own marker, but
 * the change it came from is never silently dropped for that reason).
 * Capped at `RECENT_CHANGES_LIMIT`, most recent first, so the list stays
 * scannable rather than growing to every change ever recorded.
 */
function RoadmapChangesList({ eligibleEvents }: { eligibleEvents: readonly RoadmapBranchEvents[] }) {
  const rows = recentRoadmapChanges(eligibleEvents);
  if (rows.length === 0) return null;

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

/** Says what the start date left off; nothing when nothing was left off. */
function HiddenNote({ retired, changes, showPast }: { retired: number; changes: number; showPast: boolean }) {
  const note = hiddenNoteFor(retired, changes, showPast);
  if (note === null) return null;
  return (
    <Text as="p" size="sm" tone="muted" data-testid="roadmap-hidden-note">
      {note}
    </Text>
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
export function RoadmapView({ groupsLabel = 'Capability domains', groups, branchEvents, mode, filters, granularity, horizon, windowStart, showPast, orgSlug, modelSlug, now = new Date() }: RoadmapViewProps) {
  const { filteredGroups, eligibleEvents, hiddenRetiredCount, hiddenChangeCount } = computeRoadmapVisibleData(groups, branchEvents, mode, filters, now, showPast);
  const range = roadmapRangeFor(groups, branchEvents, mode, horizon, windowStart, now, showPast);
  const todayPct = todayPercent(range, now);

  // "Find on this roadmap": only systems a row is drawn for, so a pick always lands. A system under several groups is one option.
  const findOptions = useMemo<LandscapeFindOption[]>(() => {
    const byId = new Map<string, LandscapeFindOption>();
    for (const group of filteredGroups) for (const bar of group.bars) if (!byId.has(bar.systemId)) byId.set(bar.systemId, { elementId: bar.systemId, name: bar.name, detail: 'system' });
    return [...byId.values()];
  }, [filteredGroups]);
  const [found, setFound] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (found === null) return;
    // First row for this system, in page order; the rest are highlighted but not scrolled to.
    const row = [...document.querySelectorAll<HTMLElement>('[data-system-id]')].find((el) => el.dataset.systemId === found.id);
    row?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const timer = window.setTimeout(() => { setFound(null); }, 4000);
    return () => { window.clearTimeout(timer); };
  }, [found]);

  if (filteredGroups.length === 0 && eligibleEvents.length === 0) {
    return (
      <>
        <EmptyState>{hiddenRetiredCount + hiddenChangeCount === 0 ? 'No systems with a recorded lifecycle date (introduced, planned end or support end) yet.' : 'Nothing on the roadmap from today onward.'}</EmptyState>
        <HiddenNote retired={hiddenRetiredCount} changes={hiddenChangeCount} showPast={showPast} />
      </>
    );
  }

  return (
    <div className={styles.roadmap}>
      <HiddenNote retired={hiddenRetiredCount} changes={hiddenChangeCount} showPast={showPast} />
      {filteredGroups.length > 0 && (
        <>
          <LandscapeFind
            options={findOptions}
            onPick={(id) => { setFound((prev) => ({ id, n: (prev?.n ?? 0) + 1 })); }}
            label="Find on this roadmap"
            listLabel="Matches on this roadmap"
            emptyText="Nothing on this roadmap matches. A filter may be hiding it."
          />
          <RoadmapAxis range={range} granularity={granularity} />
          <div role="list" aria-label={groupsLabel}>
            {filteredGroups.map((group) => (
              <div key={group.key} className={styles.group} role="listitem">
                {group.href !== null ? (
                  <Link to={group.href}>
                    <Text as="h2" size="md" className={styles.groupHeader}>
                      {group.label}
                    </Text>
                  </Link>
                ) : (
                  <Text as="h2" size="md" className={styles.groupHeader}>
                    {group.label}
                  </Text>
                )}
                <div role="list" aria-label={`${group.label} systems`}>
                  {group.bars.map((bar) => (
                    <div key={bar.systemId} role="listitem">
                      <RoadmapRow bar={bar} events={eventsForSystem(bar.systemId, branchEvents, mode)} range={range} todayPct={todayPct} showPast={showPast} orgSlug={orgSlug} modelSlug={modelSlug} found={found?.id === bar.systemId} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <RoadmapChangesList eligibleEvents={eligibleEvents} />
    </div>
  );
}

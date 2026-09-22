/**
 * `?capabilities=`/`?owners=`/`?criticality=`/`?supportEnding=1` —
 * mirrors `src/ui/landscape/landscapeFilterParams.ts`'s exact
 * comma-separated multi-value shape (capability/owner ids pass through
 * unvalidated, open-ended per-model data; `criticality` is validated
 * against its own closed value list, a bad token silently dropped, same
 * stance as every other enum facet in this app).
 */
import type { Criticality } from '../../contracts/delta';
import { EMPTY_ROADMAP_FILTERS, type RoadmapFilters } from './roadmapFilter';
import type { RoadmapGranularity, RoadmapHorizon } from './roadmapTimelineScale';

export type { RoadmapGranularity, RoadmapHorizon } from './roadmapTimelineScale';

const CRITICALITY_VALUES: readonly Criticality[] = ['critical', 'high', 'medium', 'low'];

function parseCommaList(raw: string | null): string[] {
  if (!raw || raw.length === 0) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0))];
}

function parseEnumList<T extends string>(raw: string | null, valid: readonly T[]): T[] {
  const validSet: ReadonlySet<string> = new Set(valid);
  return parseCommaList(raw).filter((s): s is T => validSet.has(s));
}

export function parseRoadmapFilters(searchParams: URLSearchParams): RoadmapFilters {
  const capabilityIds = parseCommaList(searchParams.get('capabilities'));
  const ownerIds = parseCommaList(searchParams.get('owners'));
  const criticalities = parseEnumList(searchParams.get('criticality'), CRITICALITY_VALUES);
  const supportEndingSoon = searchParams.get('supportEnding') === '1';
  if (capabilityIds.length === 0 && ownerIds.length === 0 && criticalities.length === 0 && !supportEndingSoon) return EMPTY_ROADMAP_FILTERS;
  return { capabilityIds, ownerIds, criticalities, supportEndingSoon };
}

/** Copy-then-mutate — `prev` is never mutated in place, matching `landscapeFiltersToSearchParams`'s own convention. An empty/false facet deletes its own param rather than writing a hollow marker. */
export function roadmapFiltersToSearchParams(filters: RoadmapFilters, prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(prev);
  const setOrDelete = (key: string, values: readonly string[]): void => {
    if (values.length > 0) next.set(key, values.join(','));
    else next.delete(key);
  };
  setOrDelete('capabilities', filters.capabilityIds);
  setOrDelete('owners', filters.ownerIds);
  setOrDelete('criticality', filters.criticalities);
  if (filters.supportEndingSoon) next.set('supportEnding', '1');
  else next.delete('supportEnding');
  return next;
}

/** F6 Step 6 (ADR-023 "Views" item 3): which grouping the roadmap shows — `?groupBy=valueStream` opts into value streams, anything else is the capability default. A separate param from the `RoadmapFilters` facets, like `?roadmapMode=`, because it's a view mode, not a filter. */
export type RoadmapGroupBy = 'capability' | 'valueStream';

export function parseRoadmapGroupBy(searchParams: URLSearchParams): RoadmapGroupBy {
  return searchParams.get('groupBy') === 'valueStream' ? 'valueStream' : 'capability';
}

/** Copy-then-mutate, same convention as `roadmapFiltersToSearchParams` — the capability default deletes the param rather than writing a hollow `?groupBy=capability` marker. */
export function roadmapGroupByToSearchParams(groupBy: RoadmapGroupBy, prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(prev);
  if (groupBy === 'valueStream') next.set('groupBy', 'valueStream');
  else next.delete('groupBy');
  return next;
}

/** Which time unit the timeline axis shows — `?granularity=months` or `?granularity=years`; defaults to `'quarters'`. */
export function parseRoadmapGranularity(searchParams: URLSearchParams): RoadmapGranularity {
  const raw = searchParams.get('granularity');
  if (raw === 'months' || raw === 'years') return raw;
  return 'quarters';
}

/** Copy-then-mutate — the quarters default deletes the param rather than writing a hollow `?granularity=quarters` marker. */
export function roadmapGranularityToSearchParams(granularity: RoadmapGranularity, prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(prev);
  if (granularity === 'months' || granularity === 'years') next.set('granularity', granularity);
  else next.delete('granularity');
  return next;
}

/** Which viewing horizon the timeline shows — `?horizon=1y` or `?horizon=3y`; defaults to `'all'` (fit every date). */
export function parseRoadmapHorizon(searchParams: URLSearchParams): RoadmapHorizon {
  const raw = searchParams.get('horizon');
  if (raw === '1y' || raw === '3y') return raw;
  return 'all';
}

/** Copy-then-mutate — the `'all'` default deletes the param rather than writing a hollow `?horizon=all` marker. */
export function roadmapHorizonToSearchParams(horizon: RoadmapHorizon, prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(prev);
  if (horizon === '1y' || horizon === '3y') next.set('horizon', horizon);
  else next.delete('horizon');
  return next;
}

/** The fixed-horizon window's left edge (`?start=YYYY-MM`), or `undefined` when absent/invalid — a bad token is ignored rather than crashing the page. */
export function parseRoadmapStartMonth(searchParams: URLSearchParams): Date | undefined {
  const raw = searchParams.get('start');
  if (!raw) return undefined;
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;
  const date = new Date(year, month - 1, 1);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Formats a month-start date as `YYYY-MM` (the inverse of `parseRoadmapStartMonth`). */
export function formatRoadmapStartMonth(start: Date): string {
  return `${String(start.getFullYear())}-${String(start.getMonth() + 1).padStart(2, '0')}`;
}

/** Copy-then-mutate — writes `?start=YYYY-MM` when a window start is set, deletes it otherwise (the centered-on-now default). */
export function roadmapStartMonthToSearchParams(start: Date | undefined, prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(prev);
  if (start) next.set('start', formatRoadmapStartMonth(start));
  else next.delete('start');
  return next;
}

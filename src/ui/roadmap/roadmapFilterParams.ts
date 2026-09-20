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

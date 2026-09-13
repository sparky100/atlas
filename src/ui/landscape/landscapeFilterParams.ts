/**
 * V2 "landscape focus and filters": `?capabilities=`/`?lifecycle=`/
 * `?criticality=`/`?kind=`/`?domain=` — comma-separated multi-value URL
 * params, generalizing `ElementsPage.tsx`'s own single-value `parseFilterParam`
 * allow-list pattern. `capabilities` (plural) is deliberately a different
 * param name from the existing singular `?capability=` (`zoomParams.ts`),
 * which drives an unrelated, pre-existing "replace canvas with
 * capability-scoped list" behaviour this feature doesn't touch.
 *
 * The four enum facets are validated against their own closed value list —
 * a bad token is silently dropped, never surfaced as an error, the same
 * stance `ElementsPage.tsx`'s own allow-list takes. Capability ids pass
 * through unvalidated (open-ended, per-model data) — `landscapeFilter.ts`'s
 * own `matchesLandscapeFilters` already treats an unknown capability id as
 * "matches nothing" rather than a bug, so there's nothing to gain from
 * validating it here too.
 */
import type { Criticality, LifecycleStatus, SystemDomain, SystemKind } from '../../contracts/delta';
import { EMPTY_LANDSCAPE_FILTERS, type LandscapeFilters } from './landscapeFilter';

const LIFECYCLE_VALUES: readonly LifecycleStatus[] = ['planned', 'active', 'retiring', 'retired'];
const CRITICALITY_VALUES: readonly Criticality[] = ['critical', 'high', 'medium', 'low'];
const KIND_VALUES: readonly SystemKind[] = ['application', 'integration_platform', 'data_platform', 'infrastructure', 'platform'];
const DOMAIN_VALUES: readonly SystemDomain[] = ['it', 'ot', 'hybrid'];

function parseCommaList(raw: string | null): string[] {
  if (!raw || raw.length === 0) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0))];
}

function parseEnumList<T extends string>(raw: string | null, valid: readonly T[]): T[] {
  const validSet: ReadonlySet<string> = new Set(valid);
  return parseCommaList(raw).filter((s): s is T => validSet.has(s));
}

export function parseLandscapeFilters(searchParams: URLSearchParams): LandscapeFilters {
  const capabilityIds = parseCommaList(searchParams.get('capabilities'));
  const lifecycleStatuses = parseEnumList(searchParams.get('lifecycle'), LIFECYCLE_VALUES);
  const criticalities = parseEnumList(searchParams.get('criticality'), CRITICALITY_VALUES);
  const kinds = parseEnumList(searchParams.get('kind'), KIND_VALUES);
  const domains = parseEnumList(searchParams.get('domain'), DOMAIN_VALUES);
  if (capabilityIds.length === 0 && lifecycleStatuses.length === 0 && criticalities.length === 0 && kinds.length === 0 && domains.length === 0) return EMPTY_LANDSCAPE_FILTERS;
  return { capabilityIds, lifecycleStatuses, criticalities, kinds, domains };
}

/** Copy-then-mutate, the same shape `LandscapePage.tsx`'s existing `mode` param write already uses — `prev` is never mutated in place. An empty facet deletes its own param entirely rather than writing `key=`, so a cleared filter disappears from the URL instead of leaving an empty marker behind. */
export function landscapeFiltersToSearchParams(filters: LandscapeFilters, prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(prev);
  const setOrDelete = (key: string, values: readonly string[]): void => {
    if (values.length > 0) next.set(key, values.join(','));
    else next.delete(key);
  };
  setOrDelete('capabilities', filters.capabilityIds);
  setOrDelete('lifecycle', filters.lifecycleStatuses);
  setOrDelete('criticality', filters.criticalities);
  setOrDelete('kind', filters.kinds);
  setOrDelete('domain', filters.domains);
  return next;
}

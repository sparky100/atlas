/**
 * ADR-027 (F14 step 4): the Portfolio page <-> saved report mapping. Same
 * shape and same caveats as `elementsReport.ts` (read its module comment):
 * pure, helper fields carry the page's own ordering (unset ordinal values
 * rank lowest, unset owners sort first), names compare by lower-cased code
 * units rather than the host locale.
 */
import { aiAutonomyOf, aiAutonomyRank, aiRankOf, aiUseReportValueOf } from '../../engine/elementRead/aiAgent';
import type { AnnualRunCost, Criticality, Disposition } from '../../contracts/delta';
import { REPORT_SPEC_VERSION, type ReportFilter, type ReportRow, type ReportSort, type ReportSpec } from '../../contracts/reportSpec';
import { DEFAULT_PORTFOLIO_FILTERS, type PortfolioFilters } from '../portfolio/portfolioFilter';
import { rowKindOf, type PortfolioRowKind } from '../portfolio/portfolioRowKind';
import { PORTFOLIO_SIGNAL_KEYS } from '../portfolio/portfolioSignalLabels';
import { criticalityRank, costRank, DEFAULT_PORTFOLIO_SORT_DIRECTION, DEFAULT_PORTFOLIO_SORT_KEY, dispositionRank, fitRank, lifecycleRank, type PortfolioSortKey } from '../portfolio/portfolioSort';
import type { PortfolioRow } from '../portfolio/usePortfolio';

/** The Portfolio page's saveable state. */
export interface PortfolioReportState {
  includeContainers: boolean;
  filters: PortfolioFilters;
  sortKey: PortfolioSortKey;
  sortDirection: 'asc' | 'desc';
}

export const DEFAULT_PORTFOLIO_REPORT_STATE: PortfolioReportState = {
  includeContainers: false,
  filters: DEFAULT_PORTFOLIO_FILTERS,
  sortKey: DEFAULT_PORTFOLIO_SORT_KEY,
  sortDirection: DEFAULT_PORTFOLIO_SORT_DIRECTION,
};

export const PORTFOLIO_REPORT_FIELDS = ['name', 'kind', 'cost', 'fit', 'criticality', 'disposition', 'lifecycle', 'capabilities', 'owner', 'signals'] as const;
export const PORTFOLIO_REPORT_HELPER_FIELDS = ['id', 'elementType', 'signalKeys', 'costRank', 'fitRank', 'criticalityRank', 'dispositionRank', 'lifecycleRank', 'ownerSort', 'aiAutonomyRank', 'aiRank', 'lifecycleExposed'] as const;
/** Usable in a report but not a default column (blank for most systems): `aiAutonomy` is how freely an AI agent acts (empty for a non-agent); `aiUse` is how AI is used at all (`agent`, `built_in` or `external_service`, empty for none recorded). */
export const PORTFOLIO_REPORT_OPTIONAL_FIELDS = ['aiAutonomy', 'aiUse'] as const;

/** Signal keys wrapped in bars, so a `contains` filter on one key can never match part of another. */
function signalKeyList(row: PortfolioRow): string {
  return `|${row.signals.map((s) => s.key).sort().join('|')}|`;
}

export function portfolioReportRow(row: PortfolioRow): ReportRow {
  const ownerName = row.businessOwner?.name ?? null;
  return {
    id: row.element.element_id,
    name: row.name,
    kind: rowKindOf(row.element),
    elementType: row.element.element_type,
    cost: row.cost,
    fit: row.fit,
    criticality: row.criticality,
    disposition: row.disposition,
    lifecycle: row.lifecycleStatus,
    lifecycleExposed: row.lifecycleExposed,
    capabilities: row.capabilities.length,
    owner: ownerName,
    signals: row.signals.length,
    aiAutonomy: aiAutonomyOf(row.element),
    aiUse: aiUseReportValueOf(row.element),
    aiAutonomyRank: aiAutonomyRank(aiAutonomyOf(row.element)),
    aiRank: aiRankOf(row.element),
    signalKeys: signalKeyList(row),
    costRank: costRank(row.cost),
    fitRank: fitRank(row.fit),
    criticalityRank: criticalityRank(row.criticality),
    dispositionRank: dispositionRank(row.disposition),
    lifecycleRank: lifecycleRank(row.lifecycleStatus),
    ownerSort: ownerName ?? '',
  };
}

const SORT_FIELD: Record<PortfolioSortKey, string> = {
  name: 'name',
  kind: 'kind',
  cost: 'costRank',
  fit: 'fitRank',
  criticality: 'criticalityRank',
  disposition: 'dispositionRank',
  lifecycle: 'lifecycleRank',
  capabilities: 'capabilities',
  owner: 'ownerSort',
  signals: 'signals',
};

const FIELD_TO_SORT_KEY: Record<string, PortfolioSortKey> = Object.fromEntries(Object.entries(SORT_FIELD).map(([key, field]) => [field, key as PortfolioSortKey]));

export type PortfolioSpecResult = { ok: true; spec: ReportSpec } | { ok: false; reason: string };

export function portfolioStateToSpec(state: PortfolioReportState): PortfolioSpecResult {
  const f = state.filters;
  const filters: ReportFilter[] = [];
  if (!state.includeContainers) filters.push({ field: 'elementType', operator: 'neq', value: 'container' });
  if (f.kind !== 'all') filters.push({ field: 'kind', operator: 'eq', value: f.kind });
  if (f.signal !== 'all') filters.push({ field: 'signalKeys', operator: 'contains', value: `|${f.signal}|` });
  if (f.cost !== 'all') filters.push({ field: 'cost', operator: 'eq', value: f.cost });
  if (f.criticality !== 'all') filters.push({ field: 'criticality', operator: 'eq', value: f.criticality });
  if (f.disposition === 'not_assessed') filters.push({ field: 'disposition', operator: 'isEmpty', value: null });
  else if (f.disposition !== 'all') filters.push({ field: 'disposition', operator: 'eq', value: f.disposition });

  const primary = SORT_FIELD[state.sortKey];
  const sort: ReportSort[] = [{ field: primary, direction: state.sortDirection }];
  if (primary !== 'name') sort.push({ field: 'name', direction: state.sortDirection });

  return {
    ok: true,
    spec: { specVersion: REPORT_SPEC_VERSION, source: 'portfolio', filters, columns: [...PORTFOLIO_REPORT_FIELDS], sort, presentation: { kind: 'table' } },
  };
}

export type PortfolioStateResult = { ok: true; state: PortfolioReportState } | { ok: false; reason: string };

const NOT_SHOWABLE = 'This report uses filters or ordering the Portfolio page has no control for. Open it from the reports library instead.';

export function specToPortfolioState(spec: ReportSpec): PortfolioStateResult {
  if (spec.source !== 'portfolio') return { ok: false, reason: 'This report is not about the portfolio.' };
  if (spec.groupBy !== undefined || spec.presentation.kind !== 'table' || spec.presentation.limit !== undefined) return { ok: false, reason: NOT_SHOWABLE };

  let includeContainers = true;
  const filters: { -readonly [K in keyof PortfolioFilters]: PortfolioFilters[K] } = { ...DEFAULT_PORTFOLIO_FILTERS };
  const seen = new Set<string>();
  for (const filter of spec.filters) {
    const key = `${filter.field}:${filter.operator}`;
    if (seen.has(key)) return { ok: false, reason: NOT_SHOWABLE };
    seen.add(key);
    const value = filter.value;
    if (filter.field === 'elementType' && filter.operator === 'neq' && value === 'container') {
      includeContainers = false;
    } else if (filter.field === 'kind' && filter.operator === 'eq' && typeof value === 'string') {
      filters.kind = value as PortfolioRowKind;
    } else if (filter.field === 'signalKeys' && filter.operator === 'contains' && typeof value === 'string') {
      const signal = PORTFOLIO_SIGNAL_KEYS.find((k) => `|${k}|` === value);
      if (signal === undefined) return { ok: false, reason: NOT_SHOWABLE };
      filters.signal = signal;
    } else if (filter.field === 'cost' && filter.operator === 'eq' && typeof value === 'string') {
      filters.cost = value as AnnualRunCost;
    } else if (filter.field === 'criticality' && filter.operator === 'eq' && typeof value === 'string') {
      filters.criticality = value as Criticality;
    } else if (filter.field === 'disposition' && filter.operator === 'isEmpty') {
      filters.disposition = 'not_assessed';
    } else if (filter.field === 'disposition' && filter.operator === 'eq' && typeof value === 'string') {
      filters.disposition = value as Disposition;
    } else {
      return { ok: false, reason: NOT_SHOWABLE };
    }
  }

  let sortKey = DEFAULT_PORTFOLIO_REPORT_STATE.sortKey;
  let sortDirection = DEFAULT_PORTFOLIO_REPORT_STATE.sortDirection;
  const first = spec.sort[0];
  if (first !== undefined) {
    const known = FIELD_TO_SORT_KEY[first.field];
    const second = spec.sort[1];
    const tail = first.field === 'name' ? second === undefined : spec.sort.length === 2 && second?.field === 'name' && second.direction === first.direction;
    if (known === undefined || !tail) return { ok: false, reason: NOT_SHOWABLE };
    sortKey = known;
    sortDirection = first.direction;
  }
  return { ok: true, state: { includeContainers, filters, sortKey, sortDirection } };
}

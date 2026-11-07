/**
 * ADR-027 (F14 step 4): the Elements page <-> saved report mapping. Pure: no
 * I/O, no React, so a plain `vitest run` can import it.
 *
 * Going out: the page's own state (type filter, disposition filter, name
 * search, sort, optional custom-attribute filter) becomes a `ReportSpec`.
 * Coming back: a saved spec becomes page state, or a plain reason it cannot
 * (a spec built elsewhere, e.g. in the reports library, can use filters this
 * page has no control for).
 *
 * `elementReportRow` flattens a browse row into the flat fields the report
 * evaluator reads. A few are helper fields the page's own ordering needs, so
 * a saved report lists rows in the same order as the page it was saved from:
 * the page ranks criticality/disposition (unset first) and sorts unset
 * owners/lifecycles first, which the evaluator's "null last" rule would not.
 * Helper fields are listed in `ELEMENT_REPORT_HELPER_FIELDS`; the report
 * builder should not offer them as columns.
 *
 * Differences from the page that are deliberate and small: names compare by
 * lower-cased code units, not the host locale (rule 6: identical results on
 * every machine), so the order of names that differ only by accents or
 * punctuation can differ from the on-screen order.
 */
import type { Disposition, ElementType } from '../../contracts/delta';
import type { Json } from '../../contracts/rows';
import { REPORT_SPEC_VERSION, type ReportFilter, type ReportRow, type ReportSort, type ReportSpec, type ReportValue } from '../../contracts/reportSpec';
import type { BrowseRow } from '../../db/elementBrowse';
import { attributesRecord } from './attributesRecord';
import { CRITICALITY_ORDER } from './criticality';
import { DISPOSITION_ORDER } from './disposition';
import { moduleDisplayName } from './moduleDisplayName';
import type { ElementBrowseSortKey } from './elementBrowseSort';

export type ElementsDispositionFilter = 'all' | Disposition | 'not_assessed';

/** The Elements page's saveable state. */
export interface ElementsReportState {
  typeFilter: ElementType | 'all';
  dispositionFilter: ElementsDispositionFilter;
  query: string;
  sortKey: ElementBrowseSortKey;
  sortDirection: 'asc' | 'desc';
  /** A custom-attribute equality filter (`?customAttr=`/`?customValue=`), already parsed to the attribute's kind. */
  custom: { key: string; value: Json } | null;
}

export const DEFAULT_ELEMENTS_REPORT_STATE: ElementsReportState = {
  typeFilter: 'all',
  dispositionFilter: 'all',
  query: '',
  sortKey: 'name',
  sortDirection: 'asc',
  custom: null,
};

/** Fields every elements row carries that a person reads (and may pick as a column). */
export const ELEMENT_REPORT_FIELDS = ['name', 'type', 'owner', 'lifecycle', 'criticality', 'disposition'] as const;
/** Fields that exist only so the page's ordering and search can be reproduced; never offered as columns. */
export const ELEMENT_REPORT_HELPER_FIELDS = ['id', 'search', 'ownerSort', 'lifecycleSort', 'criticalityRank', 'dispositionRank'] as const;

const FIXED_FIELDS: ReadonlySet<string> = new Set<string>([...ELEMENT_REPORT_FIELDS, ...ELEMENT_REPORT_HELPER_FIELDS]);

function criticalityRank(value: string | null): number {
  return value !== null && value in CRITICALITY_ORDER ? CRITICALITY_ORDER[value as keyof typeof CRITICALITY_ORDER] : -1;
}

function dispositionRank(value: Disposition | null): number {
  return value === null ? -1 : DISPOSITION_ORDER.indexOf(value);
}

function isScalar(value: Json | undefined): value is ReportValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * One browse row as a report row. A custom attribute is exposed under its
 * definition key when it holds a single value (text, number, date, flag);
 * a key that collides with a fixed field is skipped, so a definition named
 * "owner" can never shadow the owner column.
 */
export function elementReportRow(row: BrowseRow): ReportRow {
  const name = moduleDisplayName(row.element, row.parent);
  const ownerName = row.owner?.name ?? null;
  const fields: Record<string, ReportValue> = {};
  for (const [key, value] of Object.entries(attributesRecord(row.element.attributes))) {
    if (!FIXED_FIELDS.has(key) && isScalar(value)) fields[key] = value;
  }
  return {
    ...fields,
    id: row.element.element_id,
    name,
    type: row.element.element_type,
    owner: ownerName,
    lifecycle: row.lifecycleStatus,
    criticality: row.criticality,
    disposition: row.disposition,
    search: `${name}\n${ownerName ?? ''}`,
    ownerSort: ownerName ?? '',
    lifecycleSort: row.lifecycleStatus ?? '',
    criticalityRank: criticalityRank(row.criticality),
    dispositionRank: dispositionRank(row.disposition),
  };
}

/** The sort keys the page offers, as the report fields that order the same way. A custom attribute sorts by its own key. */
function sortFieldOf(key: ElementBrowseSortKey): string {
  if (typeof key === 'object') return key.custom;
  switch (key) {
    case 'name':
      return 'name';
    case 'type':
      return 'type';
    case 'owner':
      return 'ownerSort';
    case 'lifecycle':
      return 'lifecycleSort';
    case 'criticality':
      return 'criticalityRank';
    case 'disposition':
      return 'dispositionRank';
  }
}

const FIELD_TO_SORT_KEY: Record<string, ElementBrowseSortKey> = {
  name: 'name',
  type: 'type',
  ownerSort: 'owner',
  lifecycleSort: 'lifecycle',
  criticalityRank: 'criticality',
  dispositionRank: 'disposition',
};

export type ElementsSpecResult = { ok: true; spec: ReportSpec } | { ok: false; reason: string };

/** Default columns for a report saved from the Elements page; the open custom attribute (if any) is appended. */
function columnsFor(state: ElementsReportState): string[] {
  const columns: string[] = [...ELEMENT_REPORT_FIELDS];
  if (state.custom !== null && !FIXED_FIELDS.has(state.custom.key)) columns.push(state.custom.key);
  else if (typeof state.sortKey === 'object' && !FIXED_FIELDS.has(state.sortKey.custom) && !columns.includes(state.sortKey.custom)) columns.push(state.sortKey.custom);
  return columns;
}

/**
 * The page state as a report. `findingFilter` is the named health-finding
 * filter in force (`?filter=`), if any: those are computed by the findings
 * code, not by field comparisons, so they cannot be saved as a report yet and
 * the person is told so rather than saving something that would show
 * different rows.
 */
export function elementsStateToSpec(state: ElementsReportState, findingFilter: string | null = null): ElementsSpecResult {
  if (findingFilter !== null && findingFilter !== '') {
    return { ok: false, reason: 'A health-finding filter cannot be saved as a report yet. Clear the finding filter, or save from the Health findings page instead.' };
  }
  if (state.custom !== null && !isScalar(state.custom.value)) {
    return { ok: false, reason: 'This attribute holds a list or structure, which a report cannot filter on yet.' };
  }
  if (state.custom !== null && FIXED_FIELDS.has(state.custom.key)) {
    return { ok: false, reason: 'This attribute has the same key as a built-in column, so a report cannot tell them apart.' };
  }
  const filters: ReportFilter[] = [];
  if (state.typeFilter !== 'all') filters.push({ field: 'type', operator: 'eq', value: state.typeFilter });
  if (state.dispositionFilter === 'not_assessed') {
    filters.push({ field: 'type', operator: 'in', value: ['system', 'container'] });
    filters.push({ field: 'disposition', operator: 'isEmpty', value: null });
  } else if (state.dispositionFilter !== 'all') {
    filters.push({ field: 'disposition', operator: 'eq', value: state.dispositionFilter });
  }
  const query = state.query.trim();
  if (query !== '') filters.push({ field: 'search', operator: 'contains', value: query });
  if (state.custom !== null && isScalar(state.custom.value)) filters.push({ field: state.custom.key, operator: 'eq', value: state.custom.value });

  const primary = sortFieldOf(state.sortKey);
  const sort: ReportSort[] = [{ field: primary, direction: state.sortDirection }];
  if (primary !== 'name') sort.push({ field: 'name', direction: state.sortDirection });

  return {
    ok: true,
    spec: { specVersion: REPORT_SPEC_VERSION, source: 'elements', filters, columns: columnsFor(state), sort, presentation: { kind: 'table' } },
  };
}

export type ElementsStateResult = { ok: true; state: ElementsReportState } | { ok: false; reason: string };

const NOT_SHOWABLE = 'This report uses filters or ordering the Elements page has no control for. Open it from the reports library instead.';

/** Saved report -> page state. Anything the page cannot show is refused whole, never half-applied. */
export function specToElementsState(spec: ReportSpec): ElementsStateResult {
  if (spec.source !== 'elements') return { ok: false, reason: 'This report is not about elements.' };
  if (spec.groupBy !== undefined || spec.presentation.kind !== 'table' || spec.presentation.limit !== undefined) return { ok: false, reason: NOT_SHOWABLE };

  const state: ElementsReportState = { ...DEFAULT_ELEMENTS_REPORT_STATE };
  let typeIn = false;
  for (const filter of spec.filters) {
    if (filter.field === 'type' && filter.operator === 'eq' && typeof filter.value === 'string' && state.typeFilter === 'all') {
      state.typeFilter = filter.value as ElementType;
    } else if (filter.field === 'type' && filter.operator === 'in' && !typeIn && Array.isArray(filter.value) && filter.value.length === 2 && filter.value[0] === 'system' && filter.value[1] === 'container') {
      typeIn = true;
    } else if (filter.field === 'disposition' && filter.operator === 'isEmpty' && state.dispositionFilter === 'all') {
      state.dispositionFilter = 'not_assessed';
    } else if (filter.field === 'disposition' && filter.operator === 'eq' && typeof filter.value === 'string' && state.dispositionFilter === 'all') {
      state.dispositionFilter = filter.value as Disposition;
    } else if (filter.field === 'search' && filter.operator === 'contains' && typeof filter.value === 'string' && state.query === '') {
      state.query = filter.value;
    } else if (filter.operator === 'eq' && !Array.isArray(filter.value) && !FIXED_FIELDS.has(filter.field) && state.custom === null) {
      state.custom = { key: filter.field, value: filter.value as ReportValue };
    } else {
      return { ok: false, reason: NOT_SHOWABLE };
    }
  }
  // The system/container pair only means "not assessed"; on its own it is a filter the page cannot show.
  if (typeIn && state.dispositionFilter !== 'not_assessed') return { ok: false, reason: NOT_SHOWABLE };
  if (state.dispositionFilter === 'not_assessed' && !typeIn) return { ok: false, reason: NOT_SHOWABLE };
  if (state.dispositionFilter === 'not_assessed' && state.typeFilter !== 'all') return { ok: false, reason: NOT_SHOWABLE };

  const first = spec.sort[0];
  if (first !== undefined) {
    const known = FIELD_TO_SORT_KEY[first.field];
    const second = spec.sort[1];
    const secondOk = first.field === 'name' ? second === undefined : second?.field === 'name' && second.direction === first.direction && spec.sort.length === 2;
    if (!secondOk) return { ok: false, reason: NOT_SHOWABLE };
    if (known !== undefined) state.sortKey = known;
    else if (!FIXED_FIELDS.has(first.field)) state.sortKey = { custom: first.field };
    else return { ok: false, reason: NOT_SHOWABLE };
    state.sortDirection = first.direction;
  }
  return { ok: true, state };
}

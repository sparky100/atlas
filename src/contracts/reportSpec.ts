/**
 * ADR-027 (F14): the saved-report definition. A report is a stored
 * *question* — a source, filters, columns, sort, an optional group-by and a
 * presentation — never data about the architecture (rule 2: no stored node
 * or edge list; rule 3: nothing here is a layout hint). Types and
 * validation only: no logic beyond checking a value is a well-formed spec,
 * no I/O (`src/engine/reportQuery.ts` evaluates one).
 *
 * The spec is plain JSON because it is stored in a `jsonb` column (ADR-027
 * §6) and copied into every saved copy; `specVersion` lets a stored spec be
 * refused plainly, never guessed at, if its shape ever changes.
 */

export const REPORT_SPEC_VERSION = 1 as const;

/** ADR-027 §3: a saved copy holds at most this many rows; a larger result is refused with a "narrow the filter" message, never truncated. */
export const REPORT_SNAPSHOT_ROW_CAP = 5000;

/** ADR-027 §1: a fixed list — a new source is a code change, not a new table. */
export const REPORT_SOURCES = ['elements', 'portfolio', 'relationships', 'findings'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

/** One cell of a report row. `null` is "no value recorded" and is distinct from `''` and `0`. */
export type ReportValue = string | number | boolean | null;

/** A report row: flat scalar fields keyed by field name (custom attributes by their definition key). Source adapters flatten into this; the evaluator reads only this. */
export type ReportRow = Readonly<Record<string, ReportValue>>;

export const REPORT_FILTER_OPERATORS = ['eq', 'neq', 'contains', 'in', 'lt', 'lte', 'gt', 'gte', 'isEmpty', 'isNotEmpty'] as const;
export type ReportFilterOperator = (typeof REPORT_FILTER_OPERATORS)[number];

export interface ReportFilter {
  field: string;
  operator: ReportFilterOperator;
  /** `in` takes a list; `isEmpty`/`isNotEmpty` take none (`null`); the rest take one scalar. */
  value: ReportValue | readonly ReportValue[];
}

export type ReportSortDirection = 'asc' | 'desc';
export interface ReportSort {
  field: string;
  direction: ReportSortDirection;
}

export type ReportPresentation =
  | { kind: 'table'; /** Top N rows; omitted = all. */ limit?: number }
  | { kind: 'count' }
  /** Requires `groupBy`: one bar per distinct value (stacked by `splitBy` when given). */
  | { kind: 'barByField' }
  /** Requires `groupBy`: one slice per distinct value, drawn as a donut. */
  | { kind: 'donut' };

export interface ReportSpec {
  specVersion: typeof REPORT_SPEC_VERSION;
  source: ReportSource;
  filters: readonly ReportFilter[];
  columns: readonly string[];
  sort: readonly ReportSort[];
  groupBy?: string;
  /** Splits each `groupBy` group by a second field (a stacked bar). Needs `groupBy`; must be a different field. */
  splitBy?: string;
  presentation: ReportPresentation;
}

export type ReportSpecParse = { ok: true; spec: ReportSpec } | { ok: false; error: string };

function isScalar(value: unknown): value is ReportValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFilter(raw: unknown, index: number): { ok: true; filter: ReportFilter } | { ok: false; error: string } {
  const at = `filters[${String(index)}]`;
  if (!isRecord(raw)) return { ok: false, error: `${at} must be an object.` };
  const { field, operator, value } = raw;
  if (!isNonEmptyString(field)) return { ok: false, error: `${at}.field must be a non-empty string.` };
  if (typeof operator !== 'string' || !(REPORT_FILTER_OPERATORS as readonly string[]).includes(operator)) {
    return { ok: false, error: `${at}.operator "${String(operator)}" is not one of ${REPORT_FILTER_OPERATORS.join(', ')}.` };
  }
  const op = operator as ReportFilterOperator;
  if (op === 'in') {
    if (!Array.isArray(value) || !value.every(isScalar)) return { ok: false, error: `${at}.value must be a list of scalar values for "in".` };
    return { ok: true, filter: { field, operator: op, value: value } };
  }
  if (op === 'isEmpty' || op === 'isNotEmpty') {
    if (value !== null && value !== undefined) return { ok: false, error: `${at}.value must be null for "${op}".` };
    return { ok: true, filter: { field, operator: op, value: null } };
  }
  if (!isScalar(value)) return { ok: false, error: `${at}.value must be a string, number, boolean or null for "${op}".` };
  return { ok: true, filter: { field, operator: op, value } };
}

/**
 * Parses an unknown value (as read back from the database) into a
 * `ReportSpec`, or says plainly why not. An unknown `specVersion` is
 * refused rather than interpreted (ADR-027 §1).
 */
export function parseReportSpec(raw: unknown): ReportSpecParse {
  if (!isRecord(raw)) return { ok: false, error: 'A report definition must be an object.' };
  if (raw.specVersion !== REPORT_SPEC_VERSION) {
    return { ok: false, error: `This report definition has version ${String(raw.specVersion)}, but only version ${String(REPORT_SPEC_VERSION)} is understood.` };
  }
  const { source, filters, columns, sort, groupBy, splitBy, presentation } = raw;
  if (typeof source !== 'string' || !(REPORT_SOURCES as readonly string[]).includes(source)) {
    return { ok: false, error: `source "${String(source)}" is not one of ${REPORT_SOURCES.join(', ')}.` };
  }
  if (!Array.isArray(filters)) return { ok: false, error: 'filters must be a list.' };
  const parsedFilters: ReportFilter[] = [];
  for (const [index, entry] of filters.entries()) {
    const result = parseFilter(entry, index);
    if (!result.ok) return result;
    parsedFilters.push(result.filter);
  }
  if (!Array.isArray(columns) || columns.length === 0 || !columns.every(isNonEmptyString)) {
    return { ok: false, error: 'columns must be a non-empty list of field names.' };
  }
  if (new Set(columns).size !== columns.length) return { ok: false, error: 'columns must not repeat a field.' };
  if (!Array.isArray(sort)) return { ok: false, error: 'sort must be a list.' };
  const parsedSort: ReportSort[] = [];
  for (const [index, entry] of sort.entries()) {
    if (!isRecord(entry) || !isNonEmptyString(entry.field) || (entry.direction !== 'asc' && entry.direction !== 'desc')) {
      return { ok: false, error: `sort[${String(index)}] must have a field and a direction of "asc" or "desc".` };
    }
    parsedSort.push({ field: entry.field, direction: entry.direction });
  }
  if (groupBy !== undefined && !isNonEmptyString(groupBy)) return { ok: false, error: 'groupBy must be a non-empty field name when given.' };
  if (splitBy !== undefined) {
    if (!isNonEmptyString(splitBy)) return { ok: false, error: 'splitBy must be a non-empty field name when given.' };
    if (groupBy === undefined) return { ok: false, error: 'splitBy needs a groupBy field.' };
    if (splitBy === groupBy) return { ok: false, error: 'splitBy must be a different field from groupBy.' };
  }
  if (!isRecord(presentation)) return { ok: false, error: 'presentation must be an object.' };
  let parsedPresentation: ReportPresentation;
  if (presentation.kind === 'table') {
    const { limit } = presentation;
    if (limit !== undefined && !(typeof limit === 'number' && Number.isInteger(limit) && limit > 0)) {
      return { ok: false, error: 'presentation.limit must be a positive whole number when given.' };
    }
    parsedPresentation = limit === undefined ? { kind: 'table' } : { kind: 'table', limit };
  } else if (presentation.kind === 'count') {
    parsedPresentation = { kind: 'count' };
  } else if (presentation.kind === 'barByField') {
    if (groupBy === undefined) return { ok: false, error: 'A bar presentation needs a groupBy field.' };
    parsedPresentation = { kind: 'barByField' };
  } else if (presentation.kind === 'donut') {
    if (groupBy === undefined) return { ok: false, error: 'A donut presentation needs a groupBy field.' };
    parsedPresentation = { kind: 'donut' };
  } else {
    return { ok: false, error: `presentation.kind "${String(presentation.kind)}" is not one of table, count, barByField, donut.` };
  }
  const spec: ReportSpec = {
    specVersion: REPORT_SPEC_VERSION,
    source: source as ReportSource,
    filters: parsedFilters,
    columns,
    sort: parsedSort,
    ...(groupBy === undefined ? {} : { groupBy }),
    ...(splitBy === undefined ? {} : { splitBy }),
    presentation: parsedPresentation,
  };
  return { ok: true, spec };
}

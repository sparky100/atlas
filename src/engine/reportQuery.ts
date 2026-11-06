/**
 * ADR-027 (F14): evaluates a saved report's definition over flat rows. Pure
 * and deterministic — the same rows and the same spec always give the same
 * result in the same order. No I/O, no clock, no `Math.random` (rule 6), and
 * nothing here writes: a report is a question, never a fact (rule 4).
 *
 * Source-agnostic on purpose. Each source (elements, portfolio,
 * relationships, findings) has an adapter, written where the page that owns
 * that data lives, which flattens its own rows into `ReportRow`s; this file
 * only filters, sorts, groups and trims them. Keeping the adapters outside
 * the engine means the evaluator never learns how a page loads its data
 * (and so never grows an `.in()` over a list that scales with the model,
 * rule 8).
 *
 * Semantics worth knowing (all pinned by `reportQuery.test.ts`):
 * - A field a row does not have reads as `null`, the same as a field
 *   recorded as empty — which is also what happens when a custom attribute
 *   has since been removed, so a report naming one still runs (ADR-027 §1).
 * - Ordering and comparison never use the host locale: strings compare by
 *   lower-cased code units, so a result is identical on every machine.
 * - `null` always sorts last, in either direction.
 */
import type { ReportFilter, ReportRow, ReportSort, ReportSpec, ReportValue } from '../contracts/reportSpec';

export interface ReportGroup {
  value: ReportValue;
  count: number;
}

export interface ReportResult {
  /** The spec's columns, in order. */
  columns: readonly string[];
  /** One array per matched row, aligned to `columns`. Filled for a `table` presentation only; empty for `count` and `barByField`. */
  rows: readonly (readonly ReportValue[])[];
  /** How many rows matched the filters, before any `limit`. */
  rowCount: number;
  /** True when a `limit` cut the matched rows short. */
  truncated: boolean;
  /** One entry per distinct `groupBy` value, largest first; empty when the spec has no `groupBy`. */
  groups: readonly ReportGroup[];
  /** Fields the spec names that this source does not have, sorted, so the UI can say "attribute removed". */
  unknownFields: readonly string[];
}

export interface RunReportOptions {
  /** The fields the source offers. Without it, a field is "unknown" when no input row carries it (and nothing is unknown if there are no rows at all). */
  knownFields?: readonly string[];
  /** Final sort key, ascending, applied after the spec's own sort so ties never depend on input order. Default `id`; ignored when no row has it. */
  tiebreakField?: string;
}

function read(row: ReportRow, field: string): ReportValue {
  const value = row[field];
  return value === undefined ? null : value;
}

function typeRank(value: Exclude<ReportValue, null>): number {
  if (typeof value === 'number') return 0;
  if (typeof value === 'string') return 1;
  return 2;
}

function compareStrings(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Total order over non-null values: numbers, then strings, then booleans. */
function compareNonNull(a: Exclude<ReportValue, null>, b: Exclude<ReportValue, null>): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === 'string' && typeof b === 'string') return compareStrings(a, b);
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  return 0;
}

/** Ascending order with `null` last. */
export function compareReportValues(a: ReportValue, b: ReportValue): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return compareNonNull(a, b);
}

function sameValue(a: ReportValue, b: ReportValue): boolean {
  return a === b;
}

function isScalarFilterValue(value: ReportFilter['value']): value is ReportValue {
  return !Array.isArray(value);
}

/** Order comparison only between values of the same type; anything else, and anything null, is not "less than" or "greater than". */
function orderedCompare(a: ReportValue, b: ReportValue): number | null {
  if (a === null || b === null) return null;
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === 'string' && typeof b === 'string') return a === b ? 0 : a < b ? -1 : 1;
  return null;
}

function matches(row: ReportRow, filter: ReportFilter): boolean {
  const value = read(row, filter.field);
  const target = filter.value;
  switch (filter.operator) {
    case 'isEmpty':
      return value === null || value === '';
    case 'isNotEmpty':
      return !(value === null || value === '');
    case 'in':
      return Array.isArray(target) && (target as readonly ReportValue[]).some((candidate) => sameValue(value, candidate));
    case 'eq':
      return isScalarFilterValue(target) && sameValue(value, target);
    case 'neq':
      return isScalarFilterValue(target) && !sameValue(value, target);
    case 'contains':
      if (!isScalarFilterValue(target) || target === null || value === null) return false;
      return String(value).toLowerCase().includes(String(target).toLowerCase());
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      if (!isScalarFilterValue(target)) return false;
      const order = orderedCompare(value, target);
      if (order === null) return false;
      if (filter.operator === 'lt') return order < 0;
      if (filter.operator === 'lte') return order <= 0;
      if (filter.operator === 'gt') return order > 0;
      return order >= 0;
    }
  }
}

function compareBySort(a: ReportRow, b: ReportRow, sort: readonly ReportSort[]): number {
  for (const key of sort) {
    const va = read(a, key.field);
    const vb = read(b, key.field);
    // Nulls last in both directions: handle them before applying direction.
    if (va === null || vb === null) {
      if (va === vb) continue;
      return va === null ? 1 : -1;
    }
    const order = compareNonNull(va, vb);
    if (order !== 0) return key.direction === 'asc' ? order : -order;
  }
  return 0;
}

function referencedFields(spec: ReportSpec): string[] {
  const names = new Set<string>(spec.columns);
  for (const filter of spec.filters) names.add(filter.field);
  for (const key of spec.sort) names.add(key.field);
  if (spec.groupBy !== undefined) names.add(spec.groupBy);
  return [...names];
}

function unknownFieldsOf(spec: ReportSpec, rows: readonly ReportRow[], knownFields: readonly string[] | undefined): string[] {
  let known: ReadonlySet<string>;
  if (knownFields !== undefined) {
    known = new Set(knownFields);
  } else {
    if (rows.length === 0) return [];
    const seen = new Set<string>();
    for (const row of rows) for (const field of Object.keys(row)) seen.add(field);
    known = seen;
  }
  return referencedFields(spec)
    .filter((field) => !known.has(field))
    .sort(compareStrings);
}

function groupRows(rows: readonly ReportRow[], field: string): ReportGroup[] {
  // A Map keyed by the value itself keeps `null`, `''`, `0` and `false` apart.
  const counts = new Map<ReportValue, number>();
  for (const row of rows) {
    const value = read(row, field);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || compareReportValues(a.value, b.value));
}

/** Runs a report. Never mutates `rows`. */
export function runReport(rows: readonly ReportRow[], spec: ReportSpec, options: RunReportOptions = {}): ReportResult {
  const matched = rows.filter((row) => spec.filters.every((filter) => matches(row, filter)));
  const tiebreak = options.tiebreakField ?? 'id';
  const useTiebreak = matched.some((row) => row[tiebreak] !== undefined);

  // Array.prototype.sort is stable, so equal rows keep their input order after the tiebreak.
  const ordered = [...matched].sort((a, b) => {
    const bySpec = compareBySort(a, b, spec.sort);
    if (bySpec !== 0) return bySpec;
    return useTiebreak ? compareReportValues(read(a, tiebreak), read(b, tiebreak)) : 0;
  });

  const presentation = spec.presentation;
  const limit = presentation.kind === 'table' ? presentation.limit : undefined;
  const shown = presentation.kind === 'table' ? (limit === undefined ? ordered : ordered.slice(0, limit)) : [];

  return {
    columns: spec.columns,
    rows: shown.map((row) => spec.columns.map((column) => read(row, column))),
    rowCount: ordered.length,
    truncated: presentation.kind === 'table' && shown.length < ordered.length,
    groups: spec.groupBy === undefined ? [] : groupRows(ordered, spec.groupBy),
    unknownFields: unknownFieldsOf(spec, rows, options.knownFields),
  };
}

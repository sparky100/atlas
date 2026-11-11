/**
 * ADR-027 (F14 follow-up): how a saved report is *shown* — as a table, a
 * single count, a bar chart or a donut, grouped by one field and optionally
 * split by a second — as opposed to *what it asks* (source, filters, columns,
 * sort), which the Elements and Portfolio pages own. Pure.
 *
 * The page mappings (`elementsReport.ts`, `portfolioReport.ts`) only know
 * flat tables, so a report's shape is edited on the report's own page, and
 * when a shaped report is opened back into its page the shape is set aside
 * (`withoutShape`) and put back on save (`applyShape`). That keeps every
 * capability of the spec reachable without teaching each page about charts.
 */
import { parseReportSpec, type ReportSource, type ReportSpec } from '../../contracts/reportSpec';
import { ELEMENT_REPORT_HELPER_FIELDS } from './elementsReport';
import { PORTFOLIO_REPORT_HELPER_FIELDS } from './portfolioReport';

export type ReportShowAs = 'table' | 'count' | 'bar' | 'donut';

export const REPORT_SHOW_AS_LABEL: Record<ReportShowAs, string> = {
  table: 'Table',
  count: 'Count only',
  bar: 'Bar chart',
  donut: 'Donut',
};

export interface ReportShape {
  showAs: ReportShowAs;
  groupBy: string | null;
  splitBy: string | null;
  /** Table only: show the first N rows; `null` shows them all. */
  limit: number | null;
}

export function shapeOfSpec(spec: ReportSpec): ReportShape {
  const p = spec.presentation;
  const showAs: ReportShowAs = p.kind === 'barByField' ? 'bar' : p.kind;
  return {
    showAs,
    groupBy: spec.groupBy ?? null,
    splitBy: spec.splitBy ?? null,
    limit: p.kind === 'table' && p.limit !== undefined ? p.limit : null,
  };
}

export type ApplyShapeResult = { ok: true; spec: ReportSpec } | { ok: false; reason: string };

/**
 * The spec with `shape` in place of its own. Refuses, in plain words, a
 * shape that cannot be drawn (a chart with no grouping, a split with no
 * grouping or on the same field, a split donut). A count ignores grouping,
 * so it is stored without one.
 */
export function applyShape(spec: ReportSpec, shape: ReportShape): ApplyShapeResult {
  const { showAs } = shape;
  const groupBy = showAs === 'count' ? null : shape.groupBy;
  const splitBy = groupBy === null ? null : shape.splitBy;
  if ((showAs === 'bar' || showAs === 'donut') && groupBy === null) return { ok: false, reason: 'Choose a field to group by for a chart.' };
  if (splitBy !== null && splitBy === groupBy) return { ok: false, reason: 'Split by a different field from the one you group by.' };
  if (showAs === 'donut' && splitBy !== null) return { ok: false, reason: 'A donut cannot be split. Use a bar chart to split, or clear "Split by".' };
  if (shape.limit !== null && !(Number.isInteger(shape.limit) && shape.limit > 0)) return { ok: false, reason: 'Rows to show must be a whole number above zero, or blank for all.' };

  const presentation: ReportSpec['presentation'] =
    showAs === 'table' ? (shape.limit === null ? { kind: 'table' } : { kind: 'table', limit: shape.limit }) : showAs === 'bar' ? { kind: 'barByField' } : { kind: showAs };
  const next: ReportSpec = {
    specVersion: spec.specVersion,
    source: spec.source,
    filters: spec.filters,
    columns: spec.columns,
    sort: spec.sort,
    ...(groupBy === null ? {} : { groupBy }),
    ...(splitBy === null ? {} : { splitBy }),
    presentation,
  };
  // The contract's own validator has the last word, so the editor can never store a spec the reader would refuse.
  const parsed = parseReportSpec(JSON.parse(JSON.stringify(next)));
  return parsed.ok ? { ok: true, spec: parsed.spec } : { ok: false, reason: parsed.error };
}

/** The question alone: a plain table with no grouping or row limit, which is what the Elements and Portfolio pages can show. */
export function withoutShape(spec: ReportSpec): ReportSpec {
  return { specVersion: spec.specVersion, source: spec.source, filters: spec.filters, columns: spec.columns, sort: spec.sort, presentation: { kind: 'table' } };
}

const HELPER_FIELDS: Record<ReportSource, ReadonlySet<string>> = {
  elements: new Set<string>(ELEMENT_REPORT_HELPER_FIELDS),
  portfolio: new Set<string>(PORTFOLIO_REPORT_HELPER_FIELDS),
  relationships: new Set(['id', 'description']),
  findings: new Set(['id', 'findingKey']),
};

/** Fields worth grouping by: the source's own fields minus internal helpers and the row's name (one group per row says nothing). Order kept. */
export function groupableFields(source: ReportSource, knownFields: readonly string[]): string[] {
  const helpers = HELPER_FIELDS[source];
  const seen = new Set<string>();
  return knownFields.filter((f) => {
    if (helpers.has(f) || f === 'name' || seen.has(f)) return false;
    seen.add(f);
    return true;
  });
}

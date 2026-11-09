/**
 * ADR-027 (F14 step 5): a report result as a plain table of text, and that
 * table as CSV — what the downloads write. Pure. Works from a `ReportResult`
 * alone, so a saved copy exports exactly the stored rows (never the live
 * model) through the same code a live report uses.
 */
import { ANNUAL_RUN_COST_LABELS, DISPOSITION_LABELS } from '../../contracts/attributeSchema';
import type { ReportValue } from '../../contracts/reportSpec';
import type { ValueScale } from '../charts/chartData';
import { PORTFOLIO_ROW_KIND_LABEL } from '../portfolio/portfolioRowKind';
import type { ReportResult } from '../../engine/reportQuery';

const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: 'Name',
  type: 'Type',
  kind: 'Kind',
  owner: 'Owner',
  lifecycle: 'Lifecycle',
  criticality: 'Criticality',
  disposition: 'Planned action',
  cost: 'Run cost',
  fit: 'Fit',
  capabilities: 'Capabilities served',
  signals: 'Signals',
};

/** A column heading: a known field's label, else the field's own key (a custom attribute reads as its definition key). */
export function reportFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** Fields whose stored values are short keys (`planned`, `50k_250k`) rather than words a reader should see. Custom attributes are shown as stored. */
const VALUE_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  cost: ANNUAL_RUN_COST_LABELS,
  disposition: DISPOSITION_LABELS,
  kind: PORTFOLIO_ROW_KIND_LABEL,
};
const SENTENCE_CASE_FIELDS: ReadonlySet<string> = new Set(['type', 'lifecycle', 'criticality', 'fit']);

/** A value as a reader should see it in a cell, a chart label or a legend: "£50k–£250k", "Retiring", "Eliminate". Empty stays empty. */
export function reportValueLabel(field: string, value: ReportValue): string {
  if (typeof value === 'string' && value !== '') {
    const mapped = VALUE_LABELS[field]?.[value];
    if (mapped !== undefined) return mapped;
    if (SENTENCE_CASE_FIELDS.has(field)) return (value.charAt(0).toUpperCase() + value.slice(1)).replace(/_/g, ' ');
  }
  return reportCellText(value);
}

/** Fields whose values are a scale, in the order a reader expects them (best or earliest first). */
const ORDERED_VALUES: Readonly<Record<string, readonly ReportValue[]>> = {
  lifecycle: ['planned', 'active', 'retiring', 'retired'],
  criticality: ['critical', 'high', 'medium', 'low'],
  cost: Object.keys(ANNUAL_RUN_COST_LABELS),
  fit: ['excellent', 'good', 'adequate', 'poor'],
  kind: ['platform', 'system', 'module'],
};

/** Labels and, for a scale, the order to chart a field's values in. */
export function reportValueScale(field: string): ValueScale {
  return { format: (v) => reportValueLabel(field, v), order: ORDERED_VALUES[field] };
}

export function reportCellText(value: ReportValue): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/**
 * Header row, then one row per result row. A `count` result is one line with
 * the number; a grouped (`barByField`) result is value/count pairs. A field
 * the model no longer has reads "attribute removed" in its heading.
 */
export function resultToTable(result: ReportResult, grouping?: { field: string }): string[][] {
  const removed = new Set(result.unknownFields);
  if (result.rows.length === 0 && result.groups.length > 0 && grouping) {
    return [[reportFieldLabel(grouping.field), 'Count'], ...result.groups.map((g) => [reportValueLabel(grouping.field, g.value), String(g.count)])];
  }
  if (result.rows.length === 0 && result.columns.length > 0 && result.groups.length === 0 && result.rowCount > 0) {
    return [['Rows'], [String(result.rowCount)]];
  }
  const header = result.columns.map((c) => (removed.has(c) ? `${reportFieldLabel(c)} (attribute removed)` : reportFieldLabel(c)));
  return [header, ...result.rows.map((row) => row.map((cell, i) => reportValueLabel(result.columns[i] ?? '', cell)))];
}

function csvCell(text: string): string {
  // A leading = + - @ would be run as a formula by a spreadsheet; keep it as text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** RFC 4180 CSV with CRLF line ends; no byte-order mark (the download adds one so Excel reads UTF-8). */
export function tableToCsv(table: readonly (readonly string[])[]): string {
  return table.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

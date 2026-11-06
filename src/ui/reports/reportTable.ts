/**
 * ADR-027 (F14 step 5): a report result as a plain table of text, and that
 * table as CSV — what the downloads write. Pure. Works from a `ReportResult`
 * alone, so a saved copy exports exactly the stored rows (never the live
 * model) through the same code a live report uses.
 */
import type { ReportValue } from '../../contracts/reportSpec';
import type { ReportResult } from '../../engine/reportQuery';

const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: 'Name',
  type: 'Type',
  kind: 'Kind',
  owner: 'Owner',
  lifecycle: 'Lifecycle',
  criticality: 'Criticality',
  disposition: 'Disposition',
  cost: 'Run cost',
  fit: 'Fit',
  capabilities: 'Capabilities served',
  signals: 'Signals',
};

/** A column heading: a known field's label, else the field's own key (a custom attribute reads as its definition key). */
export function reportFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
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
    return [[reportFieldLabel(grouping.field), 'Count'], ...result.groups.map((g) => [reportCellText(g.value), String(g.count)])];
  }
  if (result.rows.length === 0 && result.columns.length > 0 && result.groups.length === 0 && result.rowCount > 0) {
    return [['Rows'], [String(result.rowCount)]];
  }
  const header = result.columns.map((c) => (removed.has(c) ? `${reportFieldLabel(c)} (attribute removed)` : reportFieldLabel(c)));
  return [header, ...result.rows.map((row) => row.map(reportCellText))];
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

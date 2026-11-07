/**
 * Runs a report spec over the snapshot's elements, the way the Elements page
 * and a saved report do (same row builder, same evaluator), and shapes the
 * result for a tool: rows as small objects, capped, with the true total.
 */
import type { ReportRow, ReportSpec } from '../contracts/reportSpec';
import { runReport, type ReportResult } from '../engine/reportQuery';
import { elementReportRow, ELEMENT_REPORT_HELPER_FIELDS } from '../engine/elementRead/elementsReport';
import { clip, MAX_TOOL_ROWS } from './limits';
import { indexSnapshot } from './toolKit';
import type { ModelSnapshot } from './types';

const HELPER = new Set<string>(ELEMENT_REPORT_HELPER_FIELDS.filter((f) => f !== 'id'));

export function isHelperField(field: string): boolean {
  return HELPER.has(field);
}

export function elementRows(snapshot: ModelSnapshot): { rows: ReportRow[]; knownFields: string[] } {
  const rows = indexSnapshot(snapshot).browse.map(elementReportRow);
  const known = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) known.add(key);
  return { rows, knownFields: [...known].sort() };
}

export function runElementReport(snapshot: ModelSnapshot, spec: ReportSpec): ReportResult {
  const { rows, knownFields } = elementRows(snapshot);
  return runReport(rows, spec, { knownFields });
}

/** A result's rows as objects keyed by column, with text clipped. */
export function rowObjects(result: ReportResult): Record<string, string | number | boolean | null>[] {
  return result.rows.slice(0, MAX_TOOL_ROWS).map((row) => Object.fromEntries(result.columns.map((column, i) => [column, typeof row[i] === 'string' ? clip(row[i], 200) : (row[i] ?? null)])));
}

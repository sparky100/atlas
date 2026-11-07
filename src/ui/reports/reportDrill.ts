/**
 * ADR-027 (F14 follow-up): click-through from a chart to the rows behind it.
 * Clicking a bar, a donut slice or a stacked segment opens the report with
 * the clicked value(s) in the address (`?f=lifecycle&v="active"`), and the
 * report page narrows to those rows. Nothing is saved: the drill lives only
 * in the URL, so the stored report is never changed by looking at it. Pure.
 */
import type { ReportFilter, ReportSpec, ReportValue } from '../../contracts/reportSpec';
import { reportCellText, reportFieldLabel } from './reportTable';

export interface ReportDrill {
  field: string;
  value: ReportValue;
}

function isScalar(value: unknown): value is ReportValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/** `?f=…&v=…` pairs, in order. A value is JSON so `"3"`, `3`, `true` and `null` stay distinct. */
export function drillSearch(drills: readonly ReportDrill[]): string {
  const params = new URLSearchParams();
  for (const d of drills) {
    params.append('f', d.field);
    params.append('v', JSON.stringify(d.value));
  }
  return params.toString();
}

/** Reads the drill back; anything malformed is ignored rather than guessed at. */
export function parseDrill(params: URLSearchParams): ReportDrill[] {
  const fields = params.getAll('f');
  const values = params.getAll('v');
  if (fields.length !== values.length) return [];
  const out: ReportDrill[] = [];
  for (const [i, field] of fields.entries()) {
    if (field === '') return [];
    let value: unknown;
    try {
      value = JSON.parse(values[i] ?? '');
    } catch {
      return [];
    }
    if (!isScalar(value)) return [];
    out.push({ field, value });
  }
  return out;
}

/**
 * The report narrowed to the drilled rows and shown as a table of them: the
 * report's own filters still apply, plus one per drilled value ("Not set"
 * matches an empty value).
 */
export function drilledSpec(spec: ReportSpec, drills: readonly ReportDrill[]): ReportSpec {
  const extra: ReportFilter[] = drills.map((d) => (d.value === null || d.value === '' ? { field: d.field, operator: 'isEmpty', value: null } : { field: d.field, operator: 'eq', value: d.value }));
  return { specVersion: spec.specVersion, source: spec.source, filters: [...spec.filters, ...extra], columns: spec.columns, sort: spec.sort, presentation: { kind: 'table' } };
}

/** "Lifecycle is active and Criticality is not set" */
export function drillLabel(drills: readonly ReportDrill[]): string {
  return drills.map((d) => `${reportFieldLabel(d.field)} is ${d.value === null || d.value === '' ? 'not set' : reportCellText(d.value)}`).join(' and ');
}

/**
 * ADR-027 (F14 step 5, charts in step 6a): a report result on screen — a
 * headline figure, a chart where the report groups (ranked bars, stacked bars
 * or a donut), and the table when the report lists rows. Reads only a
 * `ReportResult`, so a saved copy renders through the same component from its
 * stored rows.
 */
import type { ReportSpec } from '../../contracts/reportSpec';
import type { ReportResult } from '../../engine/reportQuery';
import { BarChart } from '../charts/BarChart';
import { BigNumber } from '../charts/BigNumber';
import { DonutChart } from '../charts/DonutChart';
import { StackedBarChart } from '../charts/StackedBarChart';
import { Text } from '../components/Text/Text';
import { reportCellText, reportFieldLabel } from './reportTable';
import styles from './ReportResultView.module.css';

export function ReportChart({ result, spec }: { result: ReportResult; spec: ReportSpec }) {
  if (spec.groupBy === undefined || result.groups.length === 0) return null;
  const by = reportFieldLabel(spec.groupBy).toLowerCase();
  const title = spec.splitBy === undefined ? `Rows by ${by}` : `Rows by ${by}, split by ${reportFieldLabel(spec.splitBy).toLowerCase()}`;
  if (spec.presentation.kind === 'donut') return <DonutChart groups={result.groups} title={title} unit="rows" />;
  return spec.splitBy === undefined ? <BarChart groups={result.groups} title={title} /> : <StackedBarChart groups={result.groups} title={title} />;
}

/** The rows of a result as a table, with the "attribute removed" and "showing N of M" notes. */
export function ResultTable({ result }: { result: ReportResult }) {
  const removed = new Set(result.unknownFields);
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c} scope="col">
                {reportFieldLabel(c)}
                {removed.has(c) ? ' (attribute removed)' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{reportCellText(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length === 0 && (
        <Text as="p" tone="muted">
          No rows match.
        </Text>
      )}
      {result.truncated && (
        <Text as="p" size="sm" tone="muted">
          Showing {result.rows.length} of {result.rowCount} rows.
        </Text>
      )}
    </div>
  );
}

export function ReportResultView({ result, spec }: { result: ReportResult; spec: ReportSpec }) {
  const kind = spec.presentation.kind;
  const summary = <BigNumber label={result.rowCount === 1 ? 'Row matches' : 'Rows match'} value={result.rowCount} />;

  if (kind === 'count') return summary;
  if (kind === 'barByField' || kind === 'donut') {
    return (
      <div className={styles.stack}>
        {summary}
        <ReportChart result={result} spec={spec} />
      </div>
    );
  }
  return (
    <div className={styles.stack}>
      {summary}
      <ReportChart result={result} spec={spec} />
      <ResultTable result={result} />
    </div>
  );
}

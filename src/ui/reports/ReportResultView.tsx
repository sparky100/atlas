/**
 * ADR-027 (F14 step 5, charts in step 6a): a report result on screen — a
 * headline figure, a chart where the report groups (ranked bars, stacked bars
 * or a donut), and the table when the report lists rows. Reads only a
 * `ReportResult`, so a saved copy renders through the same component from its
 * stored rows.
 */
import type { ReportSpec, ReportValue } from '../../contracts/reportSpec';
import type { ReportResult } from '../../engine/reportQuery';
import { BarChart } from '../charts/BarChart';
import { BigNumber } from '../charts/BigNumber';
import { DonutChart } from '../charts/DonutChart';
import { StackedBarChart } from '../charts/StackedBarChart';
import { Text } from '../components/Text/Text';
import type { ReportDrill } from './reportDrill';
import { reportCellText, reportFieldLabel } from './reportTable';
import styles from './ReportResultView.module.css';

/** Called when a chart mark is clicked, with the value(s) it stands for; the page narrows to those rows. */
export type OnDrill = (drills: ReportDrill[]) => void;

export function ReportChart({ result, spec, onDrill }: { result: ReportResult; spec: ReportSpec; onDrill?: OnDrill | undefined }) {
  const { groupBy, splitBy } = spec;
  if (groupBy === undefined || result.groups.length === 0) return null;
  const by = reportFieldLabel(groupBy).toLowerCase();
  const title = splitBy === undefined ? `Rows by ${by}` : `Rows by ${by}, split by ${reportFieldLabel(splitBy).toLowerCase()}`;
  const byGroup = onDrill === undefined ? undefined : (value: ReportValue) => {
    onDrill([{ field: groupBy, value }]);
  };
  if (spec.presentation.kind === 'donut') return <DonutChart groups={result.groups} title={title} unit="rows" onSelect={byGroup} />;
  if (splitBy === undefined) return <BarChart groups={result.groups} title={title} onSelect={byGroup} />;
  return (
    <StackedBarChart
      groups={result.groups}
      title={title}
      onSelect={
        onDrill === undefined
          ? undefined
          : (group, split) => {
              onDrill(split === undefined ? [{ field: groupBy, value: group }] : [{ field: groupBy, value: group }, { field: splitBy, value: split }]);
            }
      }
    />
  );
}

/** The rows of a result as a table, with the "attribute removed" and "showing N of M" notes. */
export function ResultTable({ result, compact = false }: { result: ReportResult; compact?: boolean }) {
  const removed = new Set(result.unknownFields);
  return (
    <div className={styles.scroll}>
      <table className={compact ? [styles.table, styles.compact].join(' ') : styles.table}>
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

export function ReportResultView({ result, spec, onDrill }: { result: ReportResult; spec: ReportSpec; onDrill?: OnDrill | undefined }) {
  const kind = spec.presentation.kind;
  const summary = <BigNumber label={result.rowCount === 1 ? 'Row matches' : 'Rows match'} value={result.rowCount} />;

  if (kind === 'count') return summary;
  if (kind === 'barByField' || kind === 'donut') {
    return (
      <div className={styles.stack}>
        {summary}
        <ReportChart result={result} spec={spec} onDrill={onDrill} />
      </div>
    );
  }
  return (
    <div className={styles.stack}>
      {summary}
      <ReportChart result={result} spec={spec} onDrill={onDrill} />
      <ResultTable result={result} />
    </div>
  );
}

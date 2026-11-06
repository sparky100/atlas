/**
 * ADR-027 (F14 step 5): a report result on screen — a table, a count, or a
 * grouped list with plain proportional bars (proper charts arrive with the
 * dashboards, step 6). Reads only a `ReportResult`, so a saved copy renders
 * through the same component from its stored rows.
 */
import type { ReportSpec } from '../../contracts/reportSpec';
import type { ReportResult } from '../../engine/reportQuery';
import { Text } from '../components/Text/Text';
import { reportCellText, reportFieldLabel } from './reportTable';
import styles from './ReportResultView.module.css';

export function ReportResultView({ result, spec }: { result: ReportResult; spec: ReportSpec }) {
  const removed = new Set(result.unknownFields);
  if (spec.presentation.kind === 'count') {
    return (
      <Text as="p" size="3xl">
        {result.rowCount}
      </Text>
    );
  }
  if (spec.presentation.kind === 'barByField') {
    const max = Math.max(1, ...result.groups.map((g) => g.count));
    return (
      <ul className={styles.bars}>
        {result.groups.map((g) => (
          <li key={String(g.value)} className={styles.bar}>
            <span className={styles.barLabel}>{g.value === null || g.value === '' ? 'Not set' : reportCellText(g.value)}</span>
            <span className={styles.barTrack}>
              <span className={styles.barFill} style={{ width: `${String((g.count / max) * 100)}%` }} />
            </span>
            <span className={styles.barCount}>{g.count}</span>
          </li>
        ))}
      </ul>
    );
  }
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

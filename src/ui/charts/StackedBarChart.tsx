/**
 * ADR-027 (F14 step 6a): one bar per group, split into segments by a second
 * field, with a shared legend that lists each split value and its total.
 * Segments are separated by a 2px surface gap; the legend carries the numbers
 * so colour is not the only signal.
 */
import type { ReportGroup } from '../../engine/reportQuery';
import { categoryColour, chartStacked } from './chartData';
import { ChartLegend, ChartTable } from './chartParts';
import styles from './charts.module.css';

export function StackedBarChart({ groups, title }: { groups: readonly ReportGroup[]; title: string }) {
  const chart = chartStacked(groups);
  if (chart.bars.length === 0) return <p className={styles.empty}>Nothing to chart.</p>;
  const legendTotals = chart.legend.map((c) => ({ ...c, count: chart.bars.reduce((sum, b) => sum + (b.segments.find((s) => s.category.key === c.key)?.count ?? 0), 0) }));
  return (
    <figure className={styles.figure} aria-label={title}>
      <figcaption className={styles.caption}>{title}</figcaption>
      <ChartLegend items={legendTotals} />
      <ul className={styles.rows}>
        {chart.bars.map((bar) => (
          <li key={bar.key} className={styles.row}>
            <span className={styles.label} title={bar.label}>
              {bar.label}
            </span>
            <span className={styles.track} role="img" aria-label={`${bar.label}: ${bar.segments.map((s) => `${s.category.label} ${String(s.count)}`).join(', ')}`}>
              {bar.segments.map((s) => (
                <span key={s.category.key} className={styles.segment} title={`${s.category.label}: ${String(s.count)}`} style={{ width: `${String(s.width * 100)}%`, background: categoryColour(s.category) }} />
              ))}
            </span>
            <span className={styles.value}>{bar.total}</span>
          </li>
        ))}
      </ul>
      <ChartTable caption={title} rows={chart.bars.map((b) => ({ label: b.label, count: b.total }))} />
    </figure>
  );
}

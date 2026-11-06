/**
 * ADR-027 (F14 step 6a): ranked horizontal bars, largest first. Every bar
 * carries its label and its value in text (colour is never the only signal);
 * when `onSelect` is given each row is a button that opens the rows behind
 * it. A data table is included for screen readers.
 */
import type { ReportValue } from '../../contracts/reportSpec';
import type { ReportGroup } from '../../engine/reportQuery';
import { categoryColour, chartBars } from './chartData';
import { ChartTable } from './chartParts';
import styles from './charts.module.css';

export interface BarChartProps {
  groups: readonly ReportGroup[];
  /** What is being counted, for the caption and the screen-reader table, e.g. "Systems by lifecycle". */
  title: string;
  onSelect?: ((value: ReportValue) => void) | undefined;
}

export function BarChart({ groups, title, onSelect }: BarChartProps) {
  const bars = chartBars(groups);
  if (bars.length === 0) return <p className={styles.empty}>Nothing to chart.</p>;
  return (
    <figure className={styles.figure} aria-label={title}>
      <figcaption className={styles.caption}>{title}</figcaption>
      <ul className={styles.rows}>
        {bars.map((bar) => {
          const content = (
            <>
              <span className={styles.label} title={bar.label}>
                {bar.label}
              </span>
              <span className={styles.track} aria-hidden="true">
                <span className={styles.fill} style={{ width: `${String(bar.fraction * 100)}%`, background: categoryColour(bar.category) }} />
              </span>
              <span className={styles.value}>
                {bar.count}
                <span className={styles.valueMuted}>{String(bar.percent)}%</span>
              </span>
            </>
          );
          const selectable = onSelect !== undefined && bar.category.kind === 'slot';
          return (
            <li key={bar.key}>
              {selectable ? (
                <button
                  type="button"
                  className={styles.row}
                  aria-label={`${bar.label}: ${String(bar.count)}. Show these rows.`}
                  onClick={() => {
                    onSelect(bar.category.value);
                  }}
                >
                  {content}
                </button>
              ) : (
                <div className={styles.row}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      <ChartTable caption={title} rows={bars} />
    </figure>
  );
}

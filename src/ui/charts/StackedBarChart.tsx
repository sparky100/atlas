/**
 * ADR-027 (F14 step 6a): one bar per group, split into segments by a second
 * field, with a shared legend that lists each split value and its total.
 * Segments are separated by a 2px surface gap; the legend carries the numbers
 * so colour is not the only signal. Hovering a legend entry highlights that
 * split across every bar. With `onSelect`, clicking a segment opens the rows
 * for that group and split value; clicking a bar's label opens the group.
 */
import { useState } from 'react';
import type { ReportValue } from '../../contracts/reportSpec';
import type { ReportGroup } from '../../engine/reportQuery';
import { categoryColour, chartStacked, isDrillable } from './chartData';
import { ChartTable } from './chartParts';
import styles from './charts.module.css';

export interface StackedBarChartProps {
  groups: readonly ReportGroup[];
  title: string;
  /** `split` is undefined when the whole bar (its label) was chosen. */
  onSelect?: ((group: ReportValue, split?: ReportValue) => void) | undefined;
}

export function StackedBarChart({ groups, title, onSelect }: StackedBarChartProps) {
  const chart = chartStacked(groups);
  const [active, setActive] = useState<string | null>(null);
  if (chart.bars.length === 0) return <p className={styles.empty}>Nothing to chart.</p>;
  const legendTotals = chart.legend.map((c) => ({ ...c, count: chart.bars.reduce((sum, b) => sum + (b.segments.find((s) => s.category.key === c.key)?.count ?? 0), 0) }));
  return (
    <figure className={styles.figure} aria-label={title}>
      <figcaption className={styles.caption}>{title}</figcaption>
      <ul className={styles.legend}>
        {legendTotals.map((c) => (
          <li
            key={c.key}
            className={[styles.legendItem, active !== null && active !== c.key ? styles.dimmed : ''].join(' ')}
            onMouseEnter={() => {
              setActive(c.key);
            }}
            onMouseLeave={() => {
              setActive(null);
            }}
          >
            <span className={styles.swatch} style={{ background: categoryColour(c) }} aria-hidden="true" />
            <span>{c.label}</span>
            <span className={styles.valueMuted}>{c.count}</span>
          </li>
        ))}
      </ul>
      <ul className={styles.rows}>
        {chart.bars.map((bar) => {
          const barClickable = onSelect !== undefined && isDrillable(bar.category);
          return (
            <li key={bar.key} className={styles.row}>
              {barClickable ? (
                <button
                  type="button"
                  className={[styles.label, styles.labelButton].join(' ')}
                  title={`Show the ${String(bar.total)} rows for ${bar.label}`}
                  onClick={() => {
                    onSelect(bar.category.value);
                  }}
                >
                  {bar.label}
                </button>
              ) : (
                <span className={styles.label} title={bar.label}>
                  {bar.label}
                </span>
              )}
              <span className={styles.track} role="img" aria-label={`${bar.label}: ${bar.segments.map((s) => `${s.category.label} ${String(s.count)}`).join(', ')}`}>
                {bar.segments.map((s) => {
                  const clickable = barClickable && isDrillable(s.category);
                  const className = [styles.segment, clickable ? styles.clickable : '', active !== null && active !== s.category.key ? styles.dimmed : ''].join(' ');
                  const style = { width: `${String(s.width * 100)}%`, background: categoryColour(s.category) };
                  const tip = `${bar.label} · ${s.category.label}: ${String(s.count)}`;
                  return clickable ? (
                    <button
                      key={s.category.key}
                      type="button"
                      className={className}
                      style={style}
                      title={tip}
                      aria-label={`${tip}. Show these rows.`}
                      onMouseEnter={() => {
                        setActive(s.category.key);
                      }}
                      onMouseLeave={() => {
                        setActive(null);
                      }}
                      onClick={() => {
                        onSelect(bar.category.value, s.category.value);
                      }}
                    />
                  ) : (
                    <span key={s.category.key} className={className} title={tip} style={style} />
                  );
                })}
              </span>
              <span className={styles.value}>{bar.total}</span>
            </li>
          );
        })}
      </ul>
      <ChartTable caption={title} rows={chart.bars.map((b) => ({ label: b.label, count: b.total }))} />
    </figure>
  );
}

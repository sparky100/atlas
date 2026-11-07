/**
 * ADR-027 (F14 step 6a): a donut with the total in the centre and a legend
 * listing every slice with its count and share. Slices have a surface gap
 * between them; the legend, not hue, tells them apart. Hovering or focusing
 * a slice or its legend entry highlights it and shows its figure in the
 * centre; with `onSelect`, clicking opens the rows behind it.
 */
import { useState } from 'react';
import type { ReportValue } from '../../contracts/reportSpec';
import type { ReportGroup } from '../../engine/reportQuery';
import { categoryColour, chartDonut, isDrillable } from './chartData';
import { ChartTable } from './chartParts';
import styles from './charts.module.css';

export interface DonutChartProps {
  groups: readonly ReportGroup[];
  title: string;
  unit?: string;
  onSelect?: ((value: ReportValue) => void) | undefined;
}

export function DonutChart({ groups, title, unit = 'total', onSelect }: DonutChartProps) {
  const slices = chartDonut(groups);
  const [active, setActive] = useState<string | null>(null);
  if (slices.length === 0) return <p className={styles.empty}>Nothing to chart.</p>;
  const total = slices.reduce((sum, s) => sum + s.category.count, 0);
  const focused = slices.find((s) => s.category.key === active) ?? null;
  const select = (value: ReportValue) => {
    onSelect?.(value);
  };
  return (
    <figure className={styles.figure} aria-label={title}>
      <figcaption className={styles.caption}>{title}</figcaption>
      <div className={styles.donutWrap}>
        <svg className={styles.donut} viewBox="-52 -52 104 104" role="img" aria-label={`${title}: ${String(total)} ${unit}`}>
          {slices.map((s) => {
            const clickable = onSelect !== undefined && isDrillable(s.category);
            return (
              <path
                key={s.category.key}
                className={[styles.donutSlice, clickable ? styles.clickable : '', active !== null && active !== s.category.key ? styles.dimmed : '', active === s.category.key ? styles.raised : ''].join(' ')}
                d={s.path}
                fill={categoryColour(s.category)}
                onMouseEnter={() => {
                  setActive(s.category.key);
                }}
                onMouseLeave={() => {
                  setActive(null);
                }}
                onClick={
                  clickable
                    ? () => {
                        select(s.category.value);
                      }
                    : undefined
                }
              >
                <title>{`${s.category.label}: ${String(s.category.count)} (${String(s.percent)}%)`}</title>
              </path>
            );
          })}
          <text className={styles.donutFigure} x="0" y="-5">
            {focused === null ? total : focused.category.count}
          </text>
          <text className={styles.donutUnit} x="0" y="10">
            {focused === null ? unit : `${focused.category.label} · ${String(focused.percent)}%`}
          </text>
        </svg>
        <ul className={styles.legendList}>
          {slices.map((s) => {
            const clickable = onSelect !== undefined && isDrillable(s.category);
            const inner = (
              <>
                <span className={styles.swatch} style={{ background: categoryColour(s.category) }} aria-hidden="true" />
                <span className={styles.legendLabel}>{s.category.label}</span>
                <span className={styles.legendValue}>{s.category.count}</span>
                <span className={styles.valueMuted}>{String(s.percent)}%</span>
              </>
            );
            const handlers = {
              onMouseEnter: () => {
                setActive(s.category.key);
              },
              onMouseLeave: () => {
                setActive(null);
              },
              onFocus: () => {
                setActive(s.category.key);
              },
              onBlur: () => {
                setActive(null);
              },
            };
            return (
              <li key={s.category.key} className={active !== null && active !== s.category.key ? styles.dimmed : undefined}>
                {clickable ? (
                  <button
                    type="button"
                    className={styles.legendRow}
                    aria-label={`${s.category.label}: ${String(s.category.count)}, ${String(s.percent)}%. Show these rows.`}
                    onClick={() => {
                      select(s.category.value);
                    }}
                    {...handlers}
                  >
                    {inner}
                  </button>
                ) : (
                  <div className={styles.legendRow} {...handlers}>
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <ChartTable caption={title} rows={slices.map((s) => ({ label: s.category.label, count: s.category.count }))} />
    </figure>
  );
}

/**
 * ADR-027 (F14 step 6a): a donut with the total in the centre and a legend
 * listing every slice with its count and share. Slices have a surface gap
 * between them; the legend, not hue, tells them apart.
 */
import type { ReportGroup } from '../../engine/reportQuery';
import { categoryColour, chartDonut } from './chartData';
import { ChartLegend, ChartTable } from './chartParts';
import styles from './charts.module.css';

export function DonutChart({ groups, title, unit = 'total' }: { groups: readonly ReportGroup[]; title: string; unit?: string }) {
  const slices = chartDonut(groups);
  if (slices.length === 0) return <p className={styles.empty}>Nothing to chart.</p>;
  const total = slices.reduce((sum, s) => sum + s.category.count, 0);
  return (
    <figure className={styles.figure} aria-label={title}>
      <figcaption className={styles.caption}>{title}</figcaption>
      <div className={styles.donutWrap}>
        <svg className={styles.donut} viewBox="-50 -50 100 100" role="img" aria-label={`${title}: ${String(total)} ${unit}`}>
          {slices.map((s) => (
            <path key={s.category.key} className={styles.donutSlice} d={s.path} fill={categoryColour(s.category)}>
              <title>{`${s.category.label}: ${String(s.category.count)} (${String(s.percent)}%)`}</title>
            </path>
          ))}
          <text className={styles.donutFigure} x="0" y="-5">
            {total}
          </text>
          <text className={styles.donutUnit} x="0" y="9">
            {unit}
          </text>
        </svg>
        <ChartLegend items={slices.map((s) => ({ ...s.category, note: `${String(s.category.count)} · ${String(s.percent)}%` }))} />
      </div>
      <ChartTable caption={title} rows={slices.map((s) => ({ label: s.category.label, count: s.category.count }))} />
    </figure>
  );
}

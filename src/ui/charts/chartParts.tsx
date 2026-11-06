/** Shared pieces of the chart components: the data table every chart carries for screen readers, and the legend. */
import { categoryColour, type ChartCategory } from './chartData';
import styles from './charts.module.css';

export function ChartTable({ caption, rows }: { caption: string; rows: readonly { label: string; count: number }[] }) {
  return (
    <table className={styles.srOnly}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Count</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            <td>{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ChartLegend({ items }: { items: readonly (ChartCategory & { note?: string })[] }) {
  return (
    <ul className={styles.legend}>
      {items.map((c) => (
        <li key={c.key} className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: categoryColour(c) }} aria-hidden="true" />
          <span>{c.label}</span>
          <span className={styles.valueMuted}>{c.note ?? String(c.count)}</span>
        </li>
      ))}
    </ul>
  );
}

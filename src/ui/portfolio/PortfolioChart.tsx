import { useMemo } from 'react';
import type { AnnualRunCost, Disposition } from '../../contracts/delta';
import { dispositionLabel, dispositionTone } from '../elements/disposition';
import { Text } from '../components/Text/Text';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { buildCostFitGrid, type ChartFit, CHART_COST_COLUMNS, CHART_FIT_ROWS } from './portfolioChartModel';
import type { PortfolioRow } from './usePortfolio';
import styles from './PortfolioChart.module.css';

export interface PortfolioChartProps {
  rows: readonly PortfolioRow[];
  /** Open the table narrowed to one box. */
  onPickCell: (cost: AnnualRunCost, fit: ChartFit) => void;
  /** Show the table (so the "not plotted" applications can be read). */
  onShowTable: () => void;
}

const MAX_DOTS = 12;
const DOT_KEY: { disposition: Disposition | null; label: string }[] = [
  { disposition: 'invest', label: dispositionLabel('invest') },
  { disposition: 'tolerate', label: `${dispositionLabel('tolerate')}, ${dispositionLabel('migrate')} or ${dispositionLabel('eliminate')}` },
  { disposition: null, label: 'No planned action' },
];

function dotClass(disposition: Disposition | null): string {
  const tone = dispositionTone(disposition);
  return (tone === 'ok' ? styles.dotOk : tone === 'info' ? styles.dotInfo : styles.dotNone) ?? '';
}

/**
 * The Portfolio's chart view: cost bands across, fit down, one box per
 * combination. Position carries cost and fit; the only colour on a dot is
 * its planned action, in the same tones as the table's chips. Boxes are
 * buttons that open the table narrowed to that box.
 */
export function PortfolioChart({ rows, onPickCell, onShowTable }: PortfolioChartProps) {
  const grid = useMemo(() => buildCostFitGrid(rows), [rows]);
  if (rows.length === 0) return <EmptyState>No systems or platforms match this filter.</EmptyState>;

  return (
    <section aria-label="Cost against fit">
      <Text as="p" size="sm" tone="muted" className={styles.hint}>
        Cost against fit. Pick a box to see just those applications. "Fit not rated" means no fit has been recorded on any of the application's capability links; it is not a poor or good rating.
      </Text>
      <div className={styles.grid}>
        <div />
        {CHART_COST_COLUMNS.map((col) => (
          <div key={col.key} className={styles.colHead}>
            {col.label}
          </div>
        ))}
        {CHART_FIT_ROWS.map((fit, r) => {
          const cellRow = grid.cells[r] ?? [];
          return (
            <div key={fit.key} className={styles.fitRow}>
              <div className={styles.rowHead}>{fit.label}</div>
              {cellRow.map((cell) => {
                const colLabel = CHART_COST_COLUMNS.find((c) => c.key === cell.cost)?.label ?? '';
                const count = cell.rows.length;
                const text = `${String(count)} ${count === 1 ? 'application' : 'applications'}, ${colLabel}, ${fit.label.toLowerCase()}${cell.flagged ? ', costly and poor fit' : ''}`;
                return (
                  <button
                    key={cell.cost}
                    type="button"
                    className={[styles.cell, cell.flagged ? styles.flagged : ''].filter(Boolean).join(' ')}
                    disabled={count === 0}
                    aria-label={text}
                    onClick={() => {
                      onPickCell(cell.cost, cell.fit);
                    }}
                  >
                    <span className={styles.count}>{count}</span>
                    <span className={styles.dots} aria-hidden="true">
                      {cell.rows.slice(0, MAX_DOTS).map((row) => (
                        <span key={row.element.element_id} className={[styles.dot, dotClass(row.disposition)].join(' ')} />
                      ))}
                      {count > MAX_DOTS && <span className={styles.more}>+{count - MAX_DOTS}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <ul className={styles.key} aria-label="Key">
        {grid.cells.flat().some((cell) => cell.flagged) && (
          <li>
            <span className={styles.swatch} aria-hidden="true" /> Shaded: costly and poor fit
          </li>
        )}
        {DOT_KEY.map((k) => (
          <li key={k.label}>
            <span className={[styles.dot, dotClass(k.disposition)].join(' ')} aria-hidden="true" /> {k.label}
          </li>
        ))}
      </ul>
      {grid.notPlotted.length > 0 && (
        <Text as="p" size="sm" tone="muted" className={styles.notPlotted}>
          Not shown: {grid.notPlotted.length} {grid.notPlotted.length === 1 ? 'application has' : 'applications have'} no run cost to plot (none entered, or cost included elsewhere).{' '}
          <button type="button" className={styles.linkButton} onClick={onShowTable}>
            See them in the table
          </button>
        </Text>
      )}
    </section>
  );
}

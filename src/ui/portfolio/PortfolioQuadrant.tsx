import { useMemo } from 'react';
import { annualRunCostLabel, annualRunCostRank } from '../elements/annualRunCost';
import { dispositionLabel, dispositionTone } from '../elements/disposition';
import { Text } from '../components/Text/Text';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { buildQuadrant, FIT_ROWS, HEALTH_COLUMNS, NOT_PLACED_LABEL, QUADRANT_LABEL, WORTH_A_LOOK_LIMIT, type GridCell, type NotPlacedReason, type QuadrantItem, type WorthALookRow } from './portfolioQuadrantModel';
import styles from './PortfolioQuadrant.module.css';

export interface PortfolioQuadrantProps {
  items: readonly QuadrantItem[];
  /** Where a name goes when clicked: the application's own page. */
  hrefFor: (id: string) => string;
  /** Portfolio only: show the table, so the applications that are not placed, or not listed, can be read. */
  onShowTable?: (() => void) | undefined;
  /** Compact: a dashboard tile, with a shorter hint and a shorter list. */
  compact?: boolean;
}

const FIT_LABEL = { excellent: 'Excellent', good: 'Good', adequate: 'Adequate', poor: 'Poor' } as const;
const COMPACT_LIST_LIMIT = 3;
/** Darkest shading is the most expensive band; shading is a percentage of the text colour, so it follows the theme. */
const MAX_COST_RANK = 5;

function heatOf(cell: GridCell): number {
  if (cell.highestCost === null) return 0;
  return Math.round(6 + (34 * annualRunCostRank(cell.highestCost)) / MAX_COST_RANK);
}

function cellSummary(cell: GridCell): string {
  const n = cell.items.length;
  const parts = [`${String(n)} ${n === 1 ? 'application' : 'applications'}`];
  if (cell.highestCost !== null) parts.push(`highest run cost ${annualRunCostLabel(cell.highestCost)}`);
  if (cell.noPlannedAction > 0) parts.push(`${String(cell.noPlannedAction)} with no planned action`);
  return `${FIT_LABEL[cell.fit]} fit, ${cell.health === 'at_risk' ? 'at risk' : 'healthy'}: ${parts.join(', ')}`;
}

function notPlacedSentence(counts: [NotPlacedReason, number][]): string {
  return counts.map(([reason, n]) => `${String(n)} ${NOT_PLACED_LABEL[reason]}`).join(', ');
}

function whyOf(row: WorthALookRow): string {
  return [row.atRisk ? 'At risk' : null, row.poorFit ? 'Poor fit' : null].filter((x) => x !== null).join(' · ');
}

function toneClass(item: QuadrantItem): string {
  const tone = dispositionTone(item.disposition);
  return (tone === 'ok' ? styles.dotOk : tone === 'info' ? styles.dotInfo : styles.dotNone) ?? '';
}

/**
 * Business fit against technical health, as an eight-cell grid (four fit
 * ratings by at risk / healthy) with a "Worth a look" list beside it. Each
 * cell shows how many applications are in it, the highest run-cost band in
 * it (shading follows that band; run-cost bands are never added up) and how
 * many have no planned action recorded. Invest, Migrate, Tolerate and
 * Eliminate are corner labels: suggestions, never a recorded planned action.
 * See `portfolioQuadrantModel.ts` for how fit and health are worked out.
 */
export function PortfolioQuadrant({ items, hrefFor, onShowTable, compact = false }: PortfolioQuadrantProps) {
  const result = useMemo(() => buildQuadrant(items), [items]);
  if (items.length === 0) return <EmptyState>No systems or platforms match this filter.</EmptyState>;
  const notPlacedCounts = (Object.keys(result.notPlaced) as NotPlacedReason[]).map((reason): [NotPlacedReason, number] => [reason, result.notPlaced[reason].length]).filter(([, n]) => n > 0);
  const limit = compact ? COMPACT_LIST_LIMIT : WORTH_A_LOOK_LIMIT;
  const shown = result.worthALook.slice(0, limit);
  const cornerName = (cell: GridCell): string | null => (cell.fit === 'excellent' || cell.fit === 'adequate' ? QUADRANT_LABEL[cell.quadrant].name : null);

  return (
    <section aria-label="Fit against technical health">
      {!compact && (
        <Text as="p" size="sm" tone="muted" className={styles.hint}>
          How many applications sit at each fit rating and health, and what they cost to run. Darker means a higher run-cost band. The box names are suggestions, not decisions.
        </Text>
      )}
      <div className={styles.layout}>
        <div>
          <div className={styles.grid} role="table" aria-label="Applications by fit and technical health">
            <div className={styles.corner} aria-hidden="true" />
            {HEALTH_COLUMNS.map((h) => (
              <div key={h} className={styles.colHead} role="columnheader">
                {h === 'at_risk' ? 'At risk' : 'Healthy'}
              </div>
            ))}
            {FIT_ROWS.map((fit) => (
              <div key={fit} className={styles.row} role="row">
                <div className={styles.rowHead} role="rowheader">
                  {FIT_LABEL[fit]}
                </div>
                {result.grid
                  .filter((c) => c.fit === fit)
                  .map((cell) => {
                    const n = cell.items.length;
                    const corner = cornerName(cell);
                    return (
                      <div key={cell.health} className={[styles.cell, n === 0 ? styles.cellEmpty : '', cell.health === 'at_risk' ? styles.cellRule : '', fit === 'good' ? styles.cellMid : ''].join(' ')} style={{ '--heat': heatOf(cell) } as React.CSSProperties} role="cell" aria-label={cellSummary(cell)}>
                        {corner !== null && <span className={styles.corner2}>{corner}</span>}
                        <div className={styles.count}>
                          {n} <span className={styles.unit}>{n === 1 ? 'application' : 'applications'}</span>
                        </div>
                        <div className={styles.sub}>
                          {n === 0 ? 'None' : [cell.highestCost !== null ? `Highest run cost ${annualRunCostLabel(cell.highestCost)}` : 'No run cost entered', cell.noPlannedAction > 0 ? `${String(cell.noPlannedAction)} with no planned action` : null].filter((x) => x !== null).join(' · ')}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
          <div className={styles.xAxis} aria-hidden="true">
            <span>◀ Technical health at risk</span>
            <span>Healthy ▶</span>
          </div>
          <ul className={styles.key} aria-label="Key">
            <li>
              Run cost, highest band in the cell: <span className={[styles.swatch, styles.heatLow].join(' ')} aria-hidden="true" /> lower <span className={[styles.swatch, styles.heatMid].join(' ')} aria-hidden="true" /> middle <span className={[styles.swatch, styles.heatHigh].join(' ')} aria-hidden="true" /> higher
            </li>
          </ul>
        </div>
        <div>
          <Text as="h3" size="md" className={styles.listTitle}>
            Worth a look
          </Text>
          {!compact && (
            <Text as="p" size="sm" tone="muted" className={styles.hint}>
              Applications that are at risk or rated a poor fit, biggest run cost first.
            </Text>
          )}
          {shown.length === 0 ? (
            <Text as="p" size="sm" tone="muted">
              None are at risk or rated a poor fit.
            </Text>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.list}>
                <thead>
                  <tr>
                    <th scope="col">Application</th>
                    <th scope="col">Why</th>
                    <th scope="col">Run cost</th>
                    <th scope="col">Planned action</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.item.id}>
                      <td>
                        <a href={hrefFor(row.item.id)} className={styles.link}>
                          {row.item.name}
                        </a>
                      </td>
                      <td className={styles.why}>{whyOf(row)}</td>
                      <td className={styles.nowrap}>{row.item.cost === null ? 'Not entered' : annualRunCostLabel(row.item.cost)}</td>
                      <td>
                        {row.item.disposition === null ? (
                          <strong>None recorded</strong>
                        ) : (
                          <span className={styles.nowrap}>
                            <span className={[styles.keyDot, toneClass(row.item)].join(' ')} aria-hidden="true" /> {dispositionLabel(row.item.disposition)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.worthALook.length > shown.length && (
            <Text as="p" size="sm" tone="muted" className={styles.more}>
              Showing {shown.length} of {result.worthALook.length}. {onShowTable && !compact && (
                <button type="button" className={styles.linkButton} onClick={onShowTable}>
                  See all in the table
                </button>
              )}
            </Text>
          )}
        </div>
      </div>
      {result.notPlacedCount > 0 && (
        <Text as="p" size="sm" tone="muted" className={styles.notPlaced}>
          Not placed: {result.notPlacedCount} {result.notPlacedCount === 1 ? 'application' : 'applications'} ({notPlacedSentence(notPlacedCounts)}).{' '}
          {result.notPlaced.fit.length > 0 && 'Rate fit on a capability link to place them. '}
          {onShowTable && (
            <button type="button" className={styles.linkButton} onClick={onShowTable}>
              See them in the table
            </button>
          )}
        </Text>
      )}
    </section>
  );
}

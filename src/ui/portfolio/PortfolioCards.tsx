import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { annualRunCostLabel } from '../elements/annualRunCost';
import { fitForPurposeToneFor } from '../elements/fitForPurposeTone';
import { PortfolioRowDetail } from './PortfolioRowDetail';
import { PortfolioSignalChip } from './PortfolioSignalChip';
import { rowKindLabel } from './portfolioRowKind';
import type { PortfolioRow } from './usePortfolio';
import styles from './PortfolioCards.module.css';

export interface PortfolioCardsProps {
  rows: readonly PortfolioRow[];
  expandedRowId: UUID | null;
  onToggleExpand: (elementId: UUID) => void;
  elementHref: (elementId: UUID) => string;
}

/**
 * The Portfolio's mobile (≤768px, per the app's one breakpoint convention)
 * list — one card per row, cost/fit/signals visible without expanding
 * (task item 8's own "compact card rows with cost, fit and signals
 * visible without expanding"). Tapping a card toggles its own inline
 * detail below it, the same selected-id + inline-conditional-detail shape
 * `ValueStreamsMobileList.tsx` already establishes, rather than a second
 * panel there's no room for at this width.
 */
export function PortfolioCards({ rows, expandedRowId, onToggleExpand, elementHref }: PortfolioCardsProps) {
  if (rows.length === 0) return <EmptyState>No systems or platforms match this filter.</EmptyState>;

  return (
    <ul className={styles.list}>
      {rows.map((row) => {
        const expanded = expandedRowId === row.element.element_id;
        return (
          <li key={row.element.element_id} className={styles.card}>
            <button
              type="button"
              className={styles.cardButton}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.name}`}
              onClick={() => { onToggleExpand(row.element.element_id); }}
            >
              <div className={styles.cardHead}>
                <Text as="span" className={styles.cardName}>
                  {row.name}
                </Text>
                <Text as="span" size="sm" tone="muted">
                  {rowKindLabel(row)}
                </Text>
              </div>
              <div className={styles.cardMeta}>
                {row.cost ? <Text as="span" size="sm">{annualRunCostLabel(row.cost)}</Text> : <Text as="span" size="sm" tone="faint">Not entered</Text>}
                {row.fit ? <Chip tone={fitForPurposeToneFor(row.fit)}>{row.fit}</Chip> : <Text as="span" size="sm" tone="faint">Unrated fit</Text>}
              </div>
              {row.signals.length > 0 && (
                <div className={styles.cardSignals}>
                  {row.signals.map((signal) => (
                    <PortfolioSignalChip key={signal.key} signal={signal} />
                  ))}
                </div>
              )}
            </button>
            <Link to={elementHref(row.element.element_id)} className={styles.openLink}>
              Open
            </Link>
            {expanded && <PortfolioRowDetail row={row} elementHref={elementHref} />}
          </li>
        );
      })}
    </ul>
  );
}

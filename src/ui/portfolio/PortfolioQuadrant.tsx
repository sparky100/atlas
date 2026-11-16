import { useMemo } from 'react';
import { annualRunCostLabel } from '../elements/annualRunCost';
import { dispositionLabel, dispositionTone } from '../elements/disposition';
import { Text } from '../components/Text/Text';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { buildQuadrant, dotSizeOf, NOT_PLACED_LABEL, QUADRANT_LABEL, QUADRANT_ORDER, type NotPlacedReason, type QuadrantItem } from './portfolioQuadrant';
import styles from './PortfolioQuadrant.module.css';

export interface PortfolioQuadrantProps {
  items: readonly QuadrantItem[];
  /** Where a dot goes when clicked: the application's own page. */
  hrefFor: (id: string) => string;
  /** Portfolio only: show the table, so the applications that are not placed can be read. */
  onShowTable?: (() => void) | undefined;
  /** Compact: a dashboard tile, with a shorter hint and no instructions. */
  compact?: boolean;
}

const SIZE_KEY = [
  { label: 'Under £50k', px: 10 },
  { label: '£250k–£1m', px: 18 },
  { label: 'Over £5m', px: 30 },
];

function dotColourClass(item: QuadrantItem): string {
  const tone = dispositionTone(item.disposition);
  return (tone === 'ok' ? styles.dotOk : tone === 'info' ? styles.dotInfo : styles.dotNone) ?? '';
}

function notPlacedSentence(counts: [NotPlacedReason, number][]): string {
  return counts.map(([reason, n]) => `${String(n)} ${NOT_PLACED_LABEL[reason]}`).join(', ');
}

/**
 * Business fit up, technical health across, boxes named Invest, Migrate,
 * Tolerate and Eliminate (see `portfolioQuadrant.ts` for exactly how each is
 * worked out). One dot per application: its size is run cost, its colour is
 * the planned action someone has recorded, and clicking it opens the
 * application. A box is a suggestion; the recorded planned action is shown,
 * never overwritten.
 */
export function PortfolioQuadrant({ items, hrefFor, onShowTable, compact = false }: PortfolioQuadrantProps) {
  const result = useMemo(() => buildQuadrant(items), [items]);
  if (items.length === 0) return <EmptyState>No systems or platforms match this filter.</EmptyState>;
  const notPlacedCounts = (Object.keys(result.notPlaced) as NotPlacedReason[]).map((reason): [NotPlacedReason, number] => [reason, result.notPlaced[reason].length]).filter(([, n]) => n > 0);

  return (
    <section aria-label="Fit against technical health">
      {!compact && (
        <Text as="p" size="sm" tone="muted" className={styles.hint}>
          Fit against technical health. Dot size is run cost; dot colour is the planned action recorded. The box is a suggestion, not a decision. Pick a dot to open the application.
        </Text>
      )}
      <div className={styles.frame}>
        <div className={styles.yAxis} aria-hidden="true">
          Business fit
        </div>
        <div className={styles.boxes}>
          {QUADRANT_ORDER.map((key) => {
            const list = result.boxes[key];
            return (
              <div key={key} className={styles.box} role="group" aria-label={`${QUADRANT_LABEL[key].name}: ${String(list.length)}`}>
                <div className={styles.boxHead}>
                  <span className={styles.boxName}>{QUADRANT_LABEL[key].name}</span>
                  <span className={styles.boxCount}>{list.length}</span>
                </div>
                <div className={styles.caption}>{QUADRANT_LABEL[key].caption}</div>
                <div className={styles.dots}>
                  {list.map((item) => {
                    const px = dotSizeOf(item.cost);
                    const label = `${item.name}, ${item.cost === null ? 'no run cost entered' : annualRunCostLabel(item.cost)}, planned action: ${dispositionLabel(item.disposition)}`;
                    return <a key={item.id} href={hrefFor(item.id)} className={[styles.dot, dotColourClass(item)].join(' ')} style={{ width: px, height: px }} title={label} aria-label={label} />;
                  })}
                  {list.length === 0 && <span className={styles.empty}>None</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.xAxis} aria-hidden="true">
          <span>At risk</span>
          <span>Technical health</span>
          <span>Healthy</span>
        </div>
      </div>
      <ul className={styles.key} aria-label="Key">
        <li>
          <span className={[styles.keyDot, styles.dotOk].join(' ')} aria-hidden="true" /> {dispositionLabel('invest')}
        </li>
        <li>
          <span className={[styles.keyDot, styles.dotInfo].join(' ')} aria-hidden="true" /> {dispositionLabel('tolerate')}, {dispositionLabel('migrate')} or {dispositionLabel('eliminate')}
        </li>
        <li>
          <span className={[styles.keyDot, styles.dotNone].join(' ')} aria-hidden="true" /> No planned action
        </li>
        {SIZE_KEY.map((s) => (
          <li key={s.label}>
            <span className={[styles.keyDot, styles.dotSize].join(' ')} style={{ width: s.px, height: s.px }} aria-hidden="true" /> {s.label}
          </li>
        ))}
      </ul>
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

import { LinkButton } from '../components/Button/LinkButton';
import { Text } from '../components/Text/Text';
import { GAP_KINDS, gapDoneSummary, gapItems, gapSummary, type GapKind } from './gaps';
import type { PortfolioRow } from '../portfolio/usePortfolio';
import styles from './GapsView.module.css';

const GAP_DESCRIPTIONS: Record<GapKind, string> = {
  fit: 'How well each system serves each capability it supports — what Portfolio and the capability map rate fit from.',
  owner: 'Who is accountable for each system.',
  'run-cost': 'What each system or module costs to run — Portfolio’s cost signals need it.',
  criticality: 'How much each system matters if it fails.',
  disposition: 'Tolerate, Invest, Migrate or Eliminate.',
};

/** F12 step 2: one row per gap with its count, and a way into its walk. A gap with nothing missing still shows, as done. */
export function GapsOverview({ rows, walkHref, canFill }: { rows: readonly PortfolioRow[]; walkHref: (kind: GapKind) => string; canFill: boolean }) {
  return (
    <ul className={styles.list}>
      {GAP_KINDS.map((kind) => {
        const items = gapItems(kind, rows);
        return (
          <li key={kind} className={styles.row}>
            <div>
              <Text as="h2" size="lg">
                {items.length === 0 ? gapDoneSummary(kind) : gapSummary(kind, items)}
              </Text>
              <Text as="p" tone="muted" size="sm">
                {GAP_DESCRIPTIONS[kind]}
              </Text>
            </div>
            {items.length > 0 && canFill && (
              <LinkButton to={walkHref(kind)} aria-label={`Fill: ${gapSummary(kind, items)}`}>
                Fill in →
              </LinkButton>
            )}
          </li>
        );
      })}
    </ul>
  );
}

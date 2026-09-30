import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Chip } from '../components/Chip/Chip';
import { Text } from '../components/Text/Text';
import { annualRunCostLabel } from '../elements/annualRunCost';
import { fitForPurposeToneFor } from '../elements/fitForPurposeTone';
import type { PortfolioRow } from './usePortfolio';
import styles from './PortfolioRowDetail.module.css';

export interface PortfolioRowDetailProps {
  row: PortfolioRow;
  elementHref: (elementId: UUID) => string;
}

/**
 * The row-expand's own "why this cost" content (task item 7): every
 * capability this row supports, with the fit rated on *this* row's own
 * edge and every other top-level system also supporting that capability
 * (named, with its own highest cost band — the overlap signal's evidence,
 * spelled out), plus the row's own business owner. Shared verbatim between
 * `PortfolioTable.tsx`'s expand row and `PortfolioCards.tsx`'s inline
 * detail — one rendering, not two.
 */
export function PortfolioRowDetail({ row, elementHref }: PortfolioRowDetailProps) {
  return (
    <div className={styles.detail}>
      {row.missingInputs.length > 0 && (
        <Text as="p" size="sm" tone="muted">
          Missing: {row.missingInputs.join(', ')}.
        </Text>
      )}
      {row.capabilities.length === 0 ? (
        <Text as="p" size="sm" tone="muted">
          Supports no capability.
        </Text>
      ) : (
        <ul className={styles.capabilities}>
          {row.capabilities.map((link) => (
            <li key={link.capabilityId} className={styles.capability}>
              <div className={styles.capabilityHead}>
                <Link to={elementHref(link.capabilityId)}>
                  <Text as="span" size="sm">
                    {link.capabilityName}
                  </Text>
                </Link>
                {link.fit ? <Chip tone={fitForPurposeToneFor(link.fit)}>{link.fit}</Chip> : <Text as="span" size="sm" tone="faint">unrated fit</Text>}
              </div>
              {link.otherSupporters.length > 0 && (
                <Text as="p" size="xs" tone="muted">
                  Also supported by: {link.otherSupporters.map((s) => `${s.name} (${s.cost ? annualRunCostLabel(s.cost) : 'not entered'})`).join(', ')}.
                </Text>
              )}
            </li>
          ))}
        </ul>
      )}
      <Text as="p" size="sm">
        {row.businessOwner ? (
          <>
            Owned by{' '}
            <Link to={elementHref(row.businessOwner.element_id)}>{row.businessOwner.name}</Link>.
          </>
        ) : (
          'No business owner.'
        )}
      </Text>
    </div>
  );
}

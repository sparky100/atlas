import type { FactsRow } from '../../../contracts/rows';
import type { SourceRow } from '../../../db/types';
import { formatAttributeValue } from '../../elements/formatAttributeValue';
import { FactBadge } from '../FactBadge/FactBadge';
import { Text } from '../Text/Text';
import styles from './AttributeRow.module.css';

export interface AttributeRowProps {
  label: string;
  required: boolean;
  fact: FactsRow | undefined;
  source: SourceRow | undefined;
}

/**
 * One row of §4.3's two-column attribute list. A missing required
 * attribute reads "— required, not recorded" in the warning colour — a
 * gap made visible, never hidden (§4.3) — and carries no badge, since
 * there is no fact to show provenance for.
 */
export function AttributeRow({ label, required, fact, source }: AttributeRowProps) {
  return (
    <div className={styles.row}>
      <Text tone="muted" as="span">
        {label}
      </Text>
      {fact ? (
        <span className={styles.value}>
          <Text as="span">{formatAttributeValue(fact.value)}</Text>
          <FactBadge fact={fact} source={source} />
        </span>
      ) : required ? (
        <Text as="span" className={styles.missingRequired}>
          — required, not recorded
        </Text>
      ) : (
        <Text as="span" tone="faint">
          —
        </Text>
      )}
    </div>
  );
}

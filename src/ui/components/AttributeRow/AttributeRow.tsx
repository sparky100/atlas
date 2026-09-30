import type { AttributeFieldSchema } from '../../../contracts/attributeSchema';
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
  /** `kind: 'enum'` fields whose stored value doesn't read well raw (Run cost's bands): maps through `field.optionLabels`, and `field.emptyLabel` overrides the bare "—" shown when unset and optional. Optional — every existing caller that doesn't pass one keeps today's exact behaviour. */
  field?: AttributeFieldSchema;
}

/**
 * A stored value, formatted for this row. `field.optionLabels` first (an
 * enum with a human label distinct from its key); then, for a field that
 * declares `emptyLabel`, a `null` value reads as that label rather than
 * `formatAttributeValue`'s own bare empty string — clearing an optional
 * field via Edit writes a real fact asserting `null` (SPEC's delta model:
 * clearing is itself a recorded fact, never a retraction), so `fact` is
 * still truthy here and this is the one place that "cleared" and "never
 * set" have to read the same way. Every field that doesn't declare
 * `emptyLabel` keeps today's exact behaviour (a bare empty string) —
 * this is opt-in, not a change to how a cleared field displays generally.
 */
function displayValue(value: FactsRow['value'], field: AttributeFieldSchema | undefined): string {
  if (value === null && field?.emptyLabel !== undefined) return field.emptyLabel;
  if (field?.kind === 'enum' && typeof value === 'string') {
    const label = field.optionLabels?.[value];
    if (label !== undefined) return label;
  }
  return formatAttributeValue(value);
}

/**
 * One row of §4.3's two-column attribute list. A missing required
 * attribute reads "— required, not recorded" in the warning colour — a
 * gap made visible, never hidden (§4.3) — and carries no badge, since
 * there is no fact to show provenance for.
 */
export function AttributeRow({ label, required, fact, source, field }: AttributeRowProps) {
  return (
    <div className={styles.row}>
      <Text tone="muted" as="span">
        {label}
      </Text>
      {fact ? (
        <span className={styles.value}>
          <Text as="span">{displayValue(fact.value, field)}</Text>
          <FactBadge fact={fact} source={source} />
        </span>
      ) : required ? (
        <Text as="span" className={styles.missingRequired}>
          — required, not recorded
        </Text>
      ) : (
        <Text as="span" tone="faint">
          {field?.emptyLabel ?? '—'}
        </Text>
      )}
    </div>
  );
}

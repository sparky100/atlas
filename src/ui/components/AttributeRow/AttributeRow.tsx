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
  /**
   * The field's own schema entry, when the caller has one (every core and
   * custom field on the element page's Attributes section does; alias rows
   * don't) — carries `optionLabels` (render an enum's display label rather
   * than its stored key) and `emptyLabel` (what an unset optional value
   * reads as instead of the bare "—"). Absent keeps today's raw-value
   * rendering exactly, so alias rows and any caller without a schema are
   * untouched.
   */
  field?: AttributeFieldSchema | undefined;
}

/**
 * One row of §4.3's two-column attribute list. A missing required
 * attribute reads "— required, not recorded" in the warning colour — a
 * gap made visible, never hidden (§4.3) — and carries no badge, since
 * there is no fact to show provenance for. A missing *optional*
 * attribute reads the field's own `emptyLabel` when it declares one
 * ("Not entered" on Run cost, where unset must be visibly distinct from
 * the recorded `none_included` band), otherwise §4.3's bare "—".
 */
export function AttributeRow({ label, required, fact, source, field }: AttributeRowProps) {
  return (
    <div className={styles.row}>
      <Text tone="muted" as="span">
        {label}
      </Text>
      {fact ? (
        <span className={styles.value}>
          <Text as="span">{displayValue(fact, field)}</Text>
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

/** A fact's stored value as text. A cleared fact (the fold keeps the `null`-valued fact so the badge can record *who cleared it*) reads the field's own `emptyLabel` when it declares one — "Not entered" on Run cost, where cleared must read as unset rather than as a blank value — else `formatAttributeValue`'s own plain rendering every other field keeps; a recorded enum value reads its `optionLabels` entry (labels, not keys: ADR-022). */
function displayValue(fact: FactsRow, field: AttributeFieldSchema | undefined): string {
  const raw = formatAttributeValue(fact.value);
  if (fact.value === null) {
    return field?.emptyLabel ?? raw;
  }
  if (field?.kind === 'enum' && typeof fact.value === 'string') {
    return field.optionLabels?.[fact.value] ?? raw;
  }
  return raw;
}

import type { FactsRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { AliasRow, AliasType } from '../../db/types';

/**
 * Human labels for each `aliases.alias_type` (SPEC §3.6, ADR-008) — used
 * wherever an alias renders as an attribute-shaped row (Sprint U4-1 D1:
 * "alias moves into attributes", replacing the header's own generic
 * `aka "..."` treatment with one row per alias, labelled by its real
 * type rather than a single undifferentiated bucket).
 */
export const ALIAS_TYPE_LABELS: Record<AliasType, string> = {
  name: 'Alternate name',
  code: 'Code',
  external_ref: 'External reference',
  source_system_key: 'Source system key',
  template_code: 'Template code',
  merged_id: 'Merged element ID',
};

/**
 * An alias, reshaped as the `FactsRow` `AttributeRow`/`FactBadge` already
 * know how to render — aliases aren't `facts` rows themselves (no
 * `delta_id`; SPEC §3.6's `aliases` table stands apart from the
 * delta/fact stream), so `FactBadge`'s "supersession chain" hover will
 * just come back empty, which is honest (an alias has no chain), not a
 * bug to route around with a second, near-identical badge. Moved here
 * from `ElementHeader.tsx` (Sprint U4-1 D1) so `ElementPage.tsx`'s
 * Attributes section — the alias's new home — can build the same shape.
 */
export function aliasAsFact(alias: AliasRow, elementId: UUID): FactsRow {
  return {
    subject_type: 'element',
    subject_id: elementId,
    attribute: `alias:${alias.alias_type}`,
    value: alias.alias_value,
    delta_id: alias.id,
    source_id: alias.source_id,
    source_ref: null,
    effective_date: null,
    confidence: alias.confidence,
    asserted_by: alias.created_by,
    asserted_at: alias.created_at,
  };
}

/**
 * ADR-025 (F12 step 3): "Still accurate". Confirming an element re-asserts
 * every one of its current facts, unchanged, as a new `element.update` (or
 * `element.update_custom`) delta under an `attestation` source — so each
 * fact's date (what staleness reads, `isStale`) becomes the confirmation's,
 * and its provenance says it was confirmed rather than re-entered. The old
 * facts stay in history, superseded, never edited (rules 4–5).
 *
 * Pure: the caller supplies the facts, the source and the id generator.
 * Values are not re-validated — each is already the element's own current
 * value, and a non-editable one (say, a value stream's `inactive`) must be
 * confirmable too.
 */
import { attributeFieldSchema } from '../contracts/attributeSchema';
import { EXISTS_ATTRIBUTE, type Delta, type UUID } from '../contracts/delta';
import type { ElementsHeadRow, FactsRow } from '../contracts/rows';

/** Promoted columns re-asserted through `element.update` like any core attribute. */
const PROMOTED_KEYS = new Set(['name', 'parentId']);

export interface BuildAttestationDeltasInput {
  element: ElementsHeadRow;
  /** The element's current facts, by attribute (`loadFactsForSubjectAtBranch`). */
  facts: ReadonlyMap<string, FactsRow>;
  sourceId: UUID;
  newId: () => UUID;
}

export function buildAttestationDeltas({ element, facts, sourceId, newId }: BuildAttestationDeltasInput): Delta[] {
  const keys = [...facts.keys()].filter((key) => key !== EXISTS_ATTRIBUTE).sort();
  return keys.flatMap((key) => {
    const fact = facts.get(key);
    if (!fact) return [];
    const core = PROMOTED_KEYS.has(key) || attributeFieldSchema(element.element_type, key) !== undefined;
    return [
      {
        kind: core ? 'element.update' : 'element.update_custom',
        id: newId(),
        elementId: element.element_id,
        elementType: element.element_type,
        attribute: key,
        value: fact.value,
        previousDeltaId: fact.delta_id,
        sourceId,
        confidence: 1,
      } as Delta,
    ];
  });
}

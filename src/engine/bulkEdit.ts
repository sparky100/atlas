/**
 * F12 step 1: the Elements grid's bulk edit — many attribute cells, across
 * many elements, saved as one commit of `element.update` (or
 * `element.update_custom`) deltas. Pure: the caller supplies the current
 * facts, the source and the id generator (rule 6 — nothing here picks an
 * id or reads a clock).
 *
 * Same rules as the element page's own edit form (`useElementEditor.ts`):
 * a cell whose draft equals the current fact is not a change and makes no
 * delta; each value is validated against whichever schema owns the key
 * (the element type's core schema, or the org's custom definition); each
 * delta supersedes the attribute's current fact, or the element's
 * existence delta when the attribute has never been set.
 */
import { validateAttributeValue, validateCustomAttributeValue, type AttributeFieldSchema } from '../contracts/attributeSchema';
import type { Delta, UUID } from '../contracts/delta';
import { validateRelationshipAttributeValue } from '../contracts/relationshipAttributeSchema';
import type { ElementsHeadRow, FactsRow, Json, RelationshipsHeadRow } from '../contracts/rows';

/** What a grid cell holds while being edited — the same shape the element page's form uses (`DraftValue`). */
export type BulkEditDraft = string | boolean;

export interface BulkEditCell {
  elementId: UUID;
  key: string;
  draft: BulkEditDraft;
}

/** `${elementId}:${key}` — one cell's identity, for drafts and errors. */
export function bulkEditCellKey(elementId: UUID, key: string): string {
  return `${elementId}:${key}`;
}

/** Whether `draft` says the same as the current fact — an empty draft equals an unset fact. */
export function draftEqualsFactValue(draft: BulkEditDraft, current: Json | undefined): boolean {
  const value = current ?? null;
  if (typeof draft === 'boolean') return draft === value;
  const normalised = draft === '' ? null : draft;
  return normalised === value || (normalised !== null && typeof value === 'number' && String(value) === normalised);
}

/** The draft a cell starts from: the element's own current value, `''` when unset. */
export function initialBulkEditDraft(current: Json | undefined): BulkEditDraft {
  if (current === null || current === undefined) return '';
  if (typeof current === 'boolean') return current;
  if (typeof current === 'number') return String(current);
  if (typeof current === 'string') return current;
  return '';
}

export interface BuildBulkEditDeltasInput {
  cells: readonly BulkEditCell[];
  elementsById: ReadonlyMap<UUID, ElementsHeadRow>;
  /** Current facts per element, keyed by attribute — only the edited attributes need be present. */
  factsByElement: ReadonlyMap<UUID, ReadonlyMap<string, FactsRow>>;
  /** The org's custom definitions this edit may touch, by key, with the element types each applies to. */
  customFields: ReadonlyMap<string, { field: AttributeFieldSchema; appliesTo: readonly string[] }>;
  sourceId: UUID;
  newId: () => UUID;
}

export type BuildBulkEditDeltasResult = { ok: true; deltas: Delta[] } | { ok: false; errors: Map<string, string> };

export function buildBulkEditDeltas(input: BuildBulkEditDeltasInput): BuildBulkEditDeltasResult {
  const { cells, elementsById, factsByElement, customFields, sourceId, newId } = input;
  const errors = new Map<string, string>();
  const validated: { element: ElementsHeadRow; key: string; value: Json; custom: boolean; previousDeltaId: UUID }[] = [];

  for (const cell of cells) {
    const cellKey = bulkEditCellKey(cell.elementId, cell.key);
    const element = elementsById.get(cell.elementId);
    if (!element) {
      errors.set(cellKey, 'This element is no longer in the model.');
      continue;
    }
    const fact = factsByElement.get(cell.elementId)?.get(cell.key);
    if (draftEqualsFactValue(cell.draft, fact?.value)) continue;

    const custom = customFields.get(cell.key);
    let result;
    if (custom) {
      result = custom.appliesTo.includes(element.element_type)
        ? validateCustomAttributeValue(custom.field, cell.draft)
        : { ok: false as const, error: `${custom.field.label} doesn't apply to a ${element.element_type}` };
    } else {
      result = validateAttributeValue(element.element_type, cell.key, cell.draft);
    }
    if (!result.ok) {
      errors.set(cellKey, result.error);
      continue;
    }
    validated.push({ element, key: cell.key, value: result.value, custom: custom !== undefined, previousDeltaId: fact?.delta_id ?? element.exists_delta_id });
  }

  if (errors.size > 0) return { ok: false, errors };

  // Built from runtime data, checked by the validators above — the same
  // dynamic boundary `useElementEditor.ts` casts at.
  const deltas: Delta[] = validated.map(
    ({ element, key, value, custom, previousDeltaId }) =>
      ({
        kind: custom ? 'element.update_custom' : 'element.update',
        id: newId(),
        elementId: element.element_id,
        elementType: element.element_type,
        attribute: key,
        value,
        previousDeltaId,
        sourceId,
        confidence: 1,
      }) as Delta,
  );
  return { ok: true, deltas };
}

export interface BuildRelationshipAttributeDeltaInput {
  relationship: RelationshipsHeadRow;
  key: string;
  draft: BulkEditDraft;
  /** The relationship's current fact for `key`, if it has one. */
  current: FactsRow | undefined;
  sourceId: UUID;
  newId: () => UUID;
}

/**
 * F12 step 2: one relationship attribute — a `supports` edge's fit rated
 * from the gaps queue — as a `relationship.update` delta, validated against
 * the relationship type's own schema. `null` deltas means the draft equals
 * the current value (nothing to write).
 */
export function buildRelationshipAttributeDelta(input: BuildRelationshipAttributeDeltaInput): { ok: true; delta: Delta | null } | { ok: false; error: string } {
  const { relationship, key, draft, current, sourceId, newId } = input;
  if (draftEqualsFactValue(draft, current?.value)) return { ok: true, delta: null };
  const result = validateRelationshipAttributeValue(relationship.relationship_type, key, draft);
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    delta: {
      kind: 'relationship.update',
      id: newId(),
      relationshipId: relationship.relationship_id,
      relationshipType: relationship.relationship_type,
      attribute: key,
      value: result.value,
      previousDeltaId: current?.delta_id ?? relationship.exists_delta_id,
      sourceId,
      confidence: 1,
    } as Delta,
  };
}

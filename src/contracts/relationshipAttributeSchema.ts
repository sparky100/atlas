/**
 * Relationship attribute order, labels, and value validation — the
 * relationship-row analogue of `attributeSchema.ts`'s element-side schema,
 * reusing that file's own `AttributeFieldSchema`/`AttributeKind` types
 * (and, downstream, `AttributeRow`/`AttributeEditRow`/`AttributeValueInput`
 * unchanged) so a relationship's own expanded attributes render and edit
 * exactly like an element's do — "the same controls as element
 * attributes," the sprint's own wording, is true by construction here
 * rather than a second, parallel set of components to keep in sync.
 *
 * `via` (`UsesAttributes`/`FlowsToAttributes`) is deliberately not part of
 * this schema: it's an element reference, and neither this schema nor
 * `AttributeRow`'s generic `formatValue` has ever had a kind for
 * one — elements don't either (`parentId` is handled specially, outside
 * `ATTRIBUTE_SCHEMA_BY_TYPE`, for the same reason). `RelationshipsSection.tsx`
 * renders `via` as its own resolved-name row instead, alongside this
 * schema-driven table, using the same `endpoints` map it already has.
 */
import type { RelationshipType } from './delta';
import { validateByKind, type AttributeFieldMeta, type AttributeFieldSchema, type AttributeValidationResult } from './attributeSchema';

function schemaOf<T extends string>(order: readonly T[], meta: Record<T, AttributeFieldMeta>): AttributeFieldSchema[] {
  return order.map((key) => ({ key, ...meta[key] }));
}

const SUPPORTS_ROLE_OPTIONS = ['primary', 'secondary'] as const;
const OWNS_ROLE_OPTIONS = ['business', 'technical', 'service'] as const;
const DATA_CLASSIFICATION_OPTIONS = ['public', 'official', 'official_sensitive', 'special_category'] as const;

const SUPPORTS_META = {
  role: { label: 'Role', required: true, kind: 'enum', options: SUPPORTS_ROLE_OPTIONS },
  description: { label: 'Description', required: false, kind: 'text', multiline: true },
} satisfies Record<'role' | 'description', AttributeFieldMeta>;
const SUPPORTS_ORDER = ['role', 'description'] as const;

const USES_META = {
  // Sprint U4-1 B5 / SPEC §3's own decision: `description` on `uses` holds
  // the connection's verb phrase and is required at creation — the label
  // reads that way here too, not the generic "Description" `supports`
  // uses for the same underlying field.
  description: { label: 'Verb phrase', required: true, kind: 'text', multiline: true },
} satisfies Record<'description', AttributeFieldMeta>;
const USES_ORDER = ['description'] as const;

const OWNS_META = {
  role: { label: 'Role', required: true, kind: 'enum', options: OWNS_ROLE_OPTIONS },
} satisfies Record<'role', AttributeFieldMeta>;
const OWNS_ORDER = ['role'] as const;

const FLOWS_TO_META = {
  description: { label: 'Verb phrase', required: true, kind: 'text', multiline: true },
  dataClassification: { label: 'Data classification', required: false, kind: 'enum', options: DATA_CLASSIFICATION_OPTIONS },
  protocol: { label: 'Protocol', required: false, kind: 'text' },
} satisfies Record<'description' | 'dataClassification' | 'protocol', AttributeFieldMeta>;
const FLOWS_TO_ORDER = ['description', 'dataClassification', 'protocol'] as const;

export const RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE: Record<RelationshipType, readonly AttributeFieldSchema[]> = {
  supports: schemaOf(SUPPORTS_ORDER, SUPPORTS_META),
  uses: schemaOf(USES_ORDER, USES_META),
  owns: schemaOf(OWNS_ORDER, OWNS_META),
  flows_to: schemaOf(FLOWS_TO_ORDER, FLOWS_TO_META),
};

export function relationshipAttributeFieldSchema(relationshipType: RelationshipType, key: string): AttributeFieldSchema | undefined {
  return RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE[relationshipType].find((field) => field.key === key);
}

/**
 * The commit-boundary check for a relationship attribute edit — the exact
 * counterpart to `attributeSchema.ts`'s `validateAttributeValue`, same
 * empty/optional/required handling, same normalised `Json` return.
 * `useRelationshipEditor.ts` is its only caller, run before a single delta
 * is built.
 */
export function validateRelationshipAttributeValue(relationshipType: RelationshipType, key: string, raw: unknown): AttributeValidationResult {
  const field = relationshipAttributeFieldSchema(relationshipType, key);
  if (!field) return { ok: false, error: `${relationshipType} has no attribute "${key}"` };
  if (field.editable === false) return { ok: false, error: `${field.label} is not directly editable` };
  return validateByKind(field, raw);
}

/** F1's relationship-side twin of `attributeSchema.ts`'s own `validateCustomAttributeValue` — same reasoning, same shared `validateByKind`. */
export function validateCustomRelationshipAttributeValue(field: AttributeFieldSchema, raw: unknown): AttributeValidationResult {
  return validateByKind(field, raw);
}

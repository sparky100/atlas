/**
 * Attribute order, labels, and value validation for the element page's
 * Attributes section (UI-principles.md §4.3: "one row per attribute in
 * type_schemas order") and, since Sprint U1 step 5, its edit form (§4.2's
 * `Edit`).
 *
 * `type_schemas` itself is deferred to Sprint K1 (ADR-015): as SPEC
 * specifies it, it needs a full TypeScript-type-to-JSON-Schema generator
 * (RT-5), real schema-validation infrastructure this sprint never needed.
 * This is the narrower thing actually needed instead — order, a display
 * label, a value kind, and a validator per attribute — kept honest the
 * same way the delta union's own exhaustiveness is (see
 * delta.property.test.ts): each `Record<keyof XAttributes, ...>` below
 * forces an entry for every field, so adding a field to an Attributes
 * interface in delta.ts without adding it here fails to compile, rather
 * than silently rendering (or letting someone edit) it nowhere.
 *
 * `validateAttributeValue` is the commit-boundary check the user's own
 * step 3a instructions named ("validate attribute values at the commit
 * boundary in the TS contracts with tests") — src/ui/elements/
 * useElementEditor.ts is its only caller, run before a single delta is
 * built, so an invalid edit never reaches `commitToBranch` at all.
 */
import type {
  ActorAttributes,
  CapabilityAttributes,
  ComponentAttributes,
  ContainerAttributes,
  ElementType,
  SystemAttributes,
} from './delta';
import type { Json } from './rows';

export type AttributeKind = 'text' | 'boolean' | 'date' | 'enum';

export interface AttributeFieldMeta {
  label: string;
  required: boolean;
  kind: AttributeKind;
  /** `kind: 'enum'` only — the exact allowed values. */
  options?: readonly string[];
  /** False only for a field no one sets by hand (Capability.templateRef, seed-derived) — excluded from the edit form entirely. Defaults to true. */
  editable?: boolean;
}

export interface AttributeFieldSchema extends AttributeFieldMeta {
  key: string;
}

function schemaOf<T extends string>(order: readonly T[], meta: Record<T, AttributeFieldMeta>): AttributeFieldSchema[] {
  return order.map((key) => ({ key, ...meta[key] }));
}

const CAPABILITY_META: Record<keyof CapabilityAttributes, AttributeFieldMeta> = {
  code: { label: 'Code', required: false, kind: 'text' },
  description: { label: 'Description', required: false, kind: 'text' },
  templateRef: { label: 'Template reference', required: false, kind: 'text', editable: false },
};
const CAPABILITY_ORDER: (keyof CapabilityAttributes)[] = ['code', 'description', 'templateRef'];

const LIFECYCLE_STATUS_OPTIONS = ['planned', 'active', 'retiring', 'retired'] as const;

const SYSTEM_META: Record<keyof SystemAttributes, AttributeFieldMeta> = {
  lifecycleStatus: { label: 'Lifecycle', required: true, kind: 'enum', options: LIFECYCLE_STATUS_OPTIONS },
  vendor: { label: 'Vendor', required: false, kind: 'text' },
  description: { label: 'Description', required: false, kind: 'text' },
  isExternal: { label: 'External', required: true, kind: 'boolean' },
  externalOrganisation: { label: 'External organisation', required: false, kind: 'text' },
  introduced: { label: 'Introduced', required: false, kind: 'date' },
  plannedEnd: { label: 'Planned end', required: false, kind: 'date' },
};
const SYSTEM_ORDER: (keyof SystemAttributes)[] = ['lifecycleStatus', 'vendor', 'description', 'isExternal', 'externalOrganisation', 'introduced', 'plannedEnd'];

const CONTAINER_META: Record<keyof ContainerAttributes, AttributeFieldMeta> = {
  technology: { label: 'Technology', required: false, kind: 'text' },
  description: { label: 'Description', required: false, kind: 'text' },
  isExternal: { label: 'External', required: true, kind: 'boolean' },
  introduced: { label: 'Introduced', required: false, kind: 'date' },
  plannedEnd: { label: 'Planned end', required: false, kind: 'date' },
};
const CONTAINER_ORDER: (keyof ContainerAttributes)[] = ['technology', 'description', 'isExternal', 'introduced', 'plannedEnd'];

const COMPONENT_META: Record<keyof ComponentAttributes, AttributeFieldMeta> = {
  technology: { label: 'Technology', required: false, kind: 'text' },
  description: { label: 'Description', required: false, kind: 'text' },
};
const COMPONENT_ORDER: (keyof ComponentAttributes)[] = ['technology', 'description'];

const ACTOR_SUBTYPE_OPTIONS = ['person', 'team'] as const;

const ACTOR_META: Record<keyof ActorAttributes, AttributeFieldMeta> = {
  subtype: { label: 'Type', required: true, kind: 'enum', options: ACTOR_SUBTYPE_OPTIONS },
  email: { label: 'Email', required: false, kind: 'text' },
  orgUnit: { label: 'Org unit', required: false, kind: 'text' },
  isExternal: { label: 'External', required: true, kind: 'boolean' },
  externalOrganisation: { label: 'External organisation', required: false, kind: 'text' },
};
const ACTOR_ORDER: (keyof ActorAttributes)[] = ['subtype', 'email', 'orgUnit', 'isExternal', 'externalOrganisation'];

export const ATTRIBUTE_SCHEMA_BY_TYPE: Record<ElementType, readonly AttributeFieldSchema[]> = {
  capability: schemaOf(CAPABILITY_ORDER, CAPABILITY_META),
  system: schemaOf(SYSTEM_ORDER, SYSTEM_META),
  container: schemaOf(CONTAINER_ORDER, CONTAINER_META),
  component: schemaOf(COMPONENT_ORDER, COMPONENT_META),
  actor: schemaOf(ACTOR_ORDER, ACTOR_META),
};

export function attributeFieldSchema(elementType: ElementType, key: string): AttributeFieldSchema | undefined {
  return ATTRIBUTE_SCHEMA_BY_TYPE[elementType].find((field) => field.key === key);
}

/**
 * The attributes a search-first "Add" (Blocking: element creation) supplies
 * for a brand-new element, which only ever collects a name — every
 * `required: true` field needs *some* value or the create is malformed
 * (C3), so this fills each with its schema's own first sensible default
 * (an enum's first option, `false` for a boolean) rather than leaving quick-
 * create blocked on a form nobody asked for. Editable immediately after
 * creation via the element page's own `Edit`, same as any other attribute.
 * Driven by `ATTRIBUTE_SCHEMA_BY_TYPE` itself, not a second hard-coded list
 * per type — a future required field defaults sensibly (enum/boolean) or,
 * for a kind this function has no safe default for (text/date), is simply
 * left unset, which C3 will then reject at commit time rather than this
 * function inventing a wrong value.
 */
export function defaultCreateAttributes(elementType: ElementType): Record<string, Json> {
  const attributes: Record<string, Json> = {};
  for (const field of ATTRIBUTE_SCHEMA_BY_TYPE[elementType]) {
    if (!field.required) continue;
    if (field.kind === 'boolean') attributes[field.key] = false;
    else if (field.kind === 'enum' && field.options) {
      const firstOption = field.options[0];
      if (firstOption !== undefined) attributes[field.key] = firstOption;
    }
  }
  return attributes;
}

/** ISO 8601 `YYYY-MM-DD`, and a real calendar date (rejects `2026-02-30`) — `Date.parse` alone accepts overflow by rolling it into March. */
function isValidIsoDate(raw: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [never, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export type AttributeValidationResult = { ok: true; value: Json } | { ok: false; error: string };

/**
 * The commit-boundary check: is `raw` (whatever the edit form collected —
 * a string, a boolean from a checkbox, or empty-string/undefined for "not
 * filled in") a legal value for `elementType`'s `key` attribute? Returns
 * the normalised `Json` value to actually put in the delta on success —
 * empty/undefined on an optional field normalises to `null` ("clear this
 * fact"), never an empty string sitting in the model.
 */
export function validateAttributeValue(elementType: ElementType, key: string, raw: unknown): AttributeValidationResult {
  const field = attributeFieldSchema(elementType, key);
  if (!field) return { ok: false, error: `${elementType} has no attribute "${key}"` };
  if (field.editable === false) return { ok: false, error: `${field.label} is not directly editable` };

  const isEmpty = raw === undefined || raw === null || raw === '';
  if (isEmpty) {
    if (field.required) return { ok: false, error: `${field.label} is required` };
    return { ok: true, value: null };
  }

  switch (field.kind) {
    case 'boolean': {
      if (typeof raw !== 'boolean') return { ok: false, error: `${field.label} must be true or false` };
      return { ok: true, value: raw };
    }
    case 'text': {
      if (typeof raw !== 'string') return { ok: false, error: `${field.label} must be text` };
      const trimmed = raw.trim();
      if (trimmed === '') return field.required ? { ok: false, error: `${field.label} is required` } : { ok: true, value: null };
      return { ok: true, value: trimmed };
    }
    case 'date': {
      if (typeof raw !== 'string' || !isValidIsoDate(raw)) return { ok: false, error: `${field.label} must be a valid date (YYYY-MM-DD)` };
      return { ok: true, value: raw };
    }
    case 'enum': {
      if (typeof raw !== 'string' || !field.options?.includes(raw)) {
        return { ok: false, error: `${field.label} must be one of: ${field.options?.join(', ') ?? ''}` };
      }
      return { ok: true, value: raw };
    }
  }
}

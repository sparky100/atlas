/**
 * Attribute order and labels for the element page's Attributes section
 * (UI-principles.md §4.3: "one row per attribute in type_schemas order").
 *
 * `type_schemas` itself is deferred to Sprint K1 (ADR-015): as SPEC
 * specifies it, it needs a full TypeScript-type-to-JSON-Schema generator
 * (RT-5), real schema-validation infrastructure the element page never
 * needed. This is the narrower thing the page actually needs — order and
 * a display label per attribute — kept honest the same way the delta
 * union's own exhaustiveness is (see delta.property.test.ts): each
 * `Record<keyof XAttributes, ...>` below forces an entry for every field,
 * so adding a field to an Attributes interface in delta.ts without adding
 * it here fails to compile, rather than silently rendering it nowhere.
 */
import type {
  ActorAttributes,
  CapabilityAttributes,
  ComponentAttributes,
  ContainerAttributes,
  ElementType,
  SystemAttributes,
} from './delta';

export interface AttributeFieldMeta {
  label: string;
  required: boolean;
}

export interface AttributeFieldSchema {
  key: string;
  label: string;
  required: boolean;
}

function schemaOf<T extends string>(order: readonly T[], meta: Record<T, AttributeFieldMeta>): AttributeFieldSchema[] {
  return order.map((key) => ({ key, ...meta[key] }));
}

const CAPABILITY_META: Record<keyof CapabilityAttributes, AttributeFieldMeta> = {
  level: { label: 'Level', required: true },
  code: { label: 'Code', required: false },
  description: { label: 'Description', required: false },
  templateRef: { label: 'Template reference', required: false },
};
const CAPABILITY_ORDER: (keyof CapabilityAttributes)[] = ['level', 'code', 'description', 'templateRef'];

const SYSTEM_META: Record<keyof SystemAttributes, AttributeFieldMeta> = {
  lifecycleStatus: { label: 'Lifecycle', required: true },
  vendor: { label: 'Vendor', required: false },
  description: { label: 'Description', required: false },
  isExternal: { label: 'External', required: true },
  externalOrganisation: { label: 'External organisation', required: false },
  introduced: { label: 'Introduced', required: false },
  plannedEnd: { label: 'Planned end', required: false },
};
const SYSTEM_ORDER: (keyof SystemAttributes)[] = ['lifecycleStatus', 'vendor', 'description', 'isExternal', 'externalOrganisation', 'introduced', 'plannedEnd'];

const CONTAINER_META: Record<keyof ContainerAttributes, AttributeFieldMeta> = {
  technology: { label: 'Technology', required: false },
  description: { label: 'Description', required: false },
  isExternal: { label: 'External', required: true },
  introduced: { label: 'Introduced', required: false },
  plannedEnd: { label: 'Planned end', required: false },
};
const CONTAINER_ORDER: (keyof ContainerAttributes)[] = ['technology', 'description', 'isExternal', 'introduced', 'plannedEnd'];

const COMPONENT_META: Record<keyof ComponentAttributes, AttributeFieldMeta> = {
  technology: { label: 'Technology', required: false },
  description: { label: 'Description', required: false },
};
const COMPONENT_ORDER: (keyof ComponentAttributes)[] = ['technology', 'description'];

const ACTOR_META: Record<keyof ActorAttributes, AttributeFieldMeta> = {
  subtype: { label: 'Type', required: true },
  email: { label: 'Email', required: false },
  orgUnit: { label: 'Org unit', required: false },
  isExternal: { label: 'External', required: true },
  externalOrganisation: { label: 'External organisation', required: false },
};
const ACTOR_ORDER: (keyof ActorAttributes)[] = ['subtype', 'email', 'orgUnit', 'isExternal', 'externalOrganisation'];

export const ATTRIBUTE_SCHEMA_BY_TYPE: Record<ElementType, readonly AttributeFieldSchema[]> = {
  capability: schemaOf(CAPABILITY_ORDER, CAPABILITY_META),
  system: schemaOf(SYSTEM_ORDER, SYSTEM_META),
  container: schemaOf(CONTAINER_ORDER, CONTAINER_META),
  component: schemaOf(COMPONENT_ORDER, COMPONENT_META),
  actor: schemaOf(ACTOR_ORDER, ACTOR_META),
};

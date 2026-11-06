/**
 * Prompt 7k item 4's `SystemKind` — the one `kindOf`/`isIntegrationPlatform`
 * pair every consumer (the landscape's platform band, the `via` picker in
 * `RelationshipAdd.tsx`, the platform element page's "Flows via this
 * platform" section, the unused-platform health finding) reads through,
 * mirroring `systemDomain.ts`'s own shape for the sibling attribute this
 * sprint added just before it.
 */
import type { SystemKind, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { INTERFACE_TYPE_LABELS } from '../../contracts/attributeSchema';
import { attributesRecord } from './attributesRecord';

export const SYSTEM_KIND_LABEL: Record<SystemKind, string> = {
  application: 'Application',
  integration_platform: 'Integration platform',
  data_platform: 'Data platform',
  infrastructure: 'Infrastructure',
  platform: 'Platform',
};

/** A system's own `kind`, defaulting to `'application'` when absent or not a recognised value — never written back, just how every reader treats the gap (`SystemKind`'s own doc comment, `delta.ts`). */
export function kindOf(system: ElementsHeadRow): SystemKind {
  const value = attributesRecord(system.attributes).kind;
  return value === 'integration_platform' || value === 'data_platform' || value === 'infrastructure' || value === 'platform' ? value : 'application';
}

/** Whether `system` is a live candidate for `via` — the same check C18 (`src/engine/deltas.ts`'s `checkVia`) enforces at commit time, mirrored here for UI-side filtering (the `via` picker only searches these) before a commit is ever attempted. */
export function isIntegrationPlatform(system: ElementsHeadRow): boolean {
  return kindOf(system) === 'integration_platform';
}

/** ADR-026: whether `element` is an *interface* — a container whose parent is an integration platform. Mirrors C18's other accepted `via` shape (`src/engine/deltas.ts`). */
export function isIntegrationInterface(element: ElementsHeadRow, parent: ElementsHeadRow | null | undefined): boolean {
  return element.element_type === 'container' && parent?.element_type === 'system' && isIntegrationPlatform(parent);
}

/**
 * ADR-026: the ids a flow's `via` may name for this element to count as "flows via" it — a platform and every interface on it (its container children), or one interface alone. Empty for anything else.
 */
export function flowViaIdsFor(element: ElementsHeadRow, parent: ElementsHeadRow | null | undefined, children: readonly ElementsHeadRow[]): UUID[] {
  if (element.element_type === 'system' && isIntegrationPlatform(element)) return [element.element_id, ...children.filter((c) => c.element_type === 'container').map((c) => c.element_id)];
  if (isIntegrationInterface(element, parent)) return [element.element_id];
  return [];
}

/** Whether `system` is a "platforms and modules" platform — its own `Container` children are its modules, each of which may `supports` a capability directly (`relationshipTypeRules.ts`'s `(supports, container, capability)` row). */
export function isPlatform(system: ElementsHeadRow): boolean {
  return kindOf(system) === 'platform';
}

/** Every kind other than the default — the landscape's platform band groups a system here the moment it's marked as anything but an ordinary application. */
export function isNonApplicationKind(system: ElementsHeadRow): boolean {
  return kindOf(system) !== 'application';
}

/** ADR-026: an interface's own type as a display label ("API", "File"…), or `null` when none is recorded (or the stored value isn't a known type). */
export function interfaceTypeLabelOf(element: ElementsHeadRow): string | null {
  const value = attributesRecord(element.attributes).interfaceType;
  return typeof value === 'string' && value in INTERFACE_TYPE_LABELS ? INTERFACE_TYPE_LABELS[value as keyof typeof INTERFACE_TYPE_LABELS] : null;
}

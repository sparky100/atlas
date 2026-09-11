/**
 * Prompt 7k item 4's `SystemKind` — the one `kindOf`/`isIntegrationPlatform`
 * pair every consumer (the landscape's platform band, the `via` picker in
 * `RelationshipAdd.tsx`, the platform element page's "Flows via this
 * platform" section, the unused-platform health finding) reads through,
 * mirroring `systemDomain.ts`'s own shape for the sibling attribute this
 * sprint added just before it.
 */
import type { ElementsHeadRow } from '../../contracts/rows';
import type { SystemKind } from '../../contracts/delta';
import { attributesRecord } from './attributesRecord';

export const SYSTEM_KIND_LABEL: Record<SystemKind, string> = {
  application: 'Application',
  integration_platform: 'Integration platform',
  data_platform: 'Data platform',
  infrastructure: 'Infrastructure',
};

/** A system's own `kind`, defaulting to `'application'` when absent or not a recognised value — never written back, just how every reader treats the gap (`SystemKind`'s own doc comment, `delta.ts`). */
export function kindOf(system: ElementsHeadRow): SystemKind {
  const value = attributesRecord(system.attributes).kind;
  return value === 'integration_platform' || value === 'data_platform' || value === 'infrastructure' ? value : 'application';
}

/** Whether `system` is a live candidate for `via` — the same check C18 (`src/engine/deltas.ts`'s `checkVia`) enforces at commit time, mirrored here for UI-side filtering (the `via` picker only searches these) before a commit is ever attempted. */
export function isIntegrationPlatform(system: ElementsHeadRow): boolean {
  return kindOf(system) === 'integration_platform';
}

/** Every kind other than the default — the landscape's platform band groups a system here the moment it's marked as anything but an ordinary application. */
export function isNonApplicationKind(system: ElementsHeadRow): boolean {
  return kindOf(system) !== 'application';
}

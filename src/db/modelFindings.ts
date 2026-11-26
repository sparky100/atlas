import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';

import {
  computeStaleAttributesFinding,
  findCapabilitiesWithNoSupporters,
  findCapabilitiesWithoutOwner,
  findAiAgentsActingAloneWithoutTechnicalOwner,
  findCriticalExposedSystems,
  findCriticalSystemsPastOrNearSupportEnd,
  findCriticalSystemsWithoutBusinessOwner,
  findOutgoingWithoutRetiringChange,
  findPlatformSupportsThatShouldMoveToModule,
  findSystemsSupportingEssentialFunctionWithoutTechnicalOwner,
  findSystemsWithoutCapability,
  findSystemsWithoutTechnicalOwner,
  findUnusedIntegrationInterfaces,
  findUnusedIntegrationPlatforms,
} from './healthFindings';
import { computeCapabilityMapTree } from '../engine/elementRead/capabilityTree';
import { replacedElementIds } from '../engine/elementRead/fitAndExposure';

export interface FindingInputs {
  snapshot: { elements: readonly ElementsHeadRow[]; relationships: readonly RelationshipsHeadRow[] };
  facts: Parameters<typeof computeStaleAttributesFinding>[0];
  retiredByOpenChanges?: ReadonlySet<string>;
  now: Date;
  /** The organisation's stale threshold (`organisations.stale_after_months`); omitted = the default. */
  staleAfterMonths?: number;
}

/** Every finding's flagged elements, keyed as `FINDING_FILTER_OPTIONS` keys them. Pure. */
export function computeFindings({ snapshot, facts, retiredByOpenChanges, now, staleAfterMonths }: FindingInputs): Map<string, readonly ElementsHeadRow[]> {
  const elements = snapshot.elements;
  // system-only: systems and modules are kept as two lists here, and joined as `systemsAndModules` below.
  const systems = elements.filter((e) => e.element_type === 'system');
  const containers = elements.filter((e) => e.element_type === 'container');
  const capabilities = elements.filter((e) => e.element_type === 'capability');
  const systemsAndModules = [...systems, ...containers];
  const supports = snapshot.relationships.filter((r) => r.relationship_type === 'supports');
  const owns = snapshot.relationships.filter((r) => r.relationship_type === 'owns');
  const replaces = snapshot.relationships.filter((r) => r.relationship_type === 'replaces');
  const usesAndFlows = snapshot.relationships.filter((r) => r.relationship_type === 'uses' || r.relationship_type === 'flows_to');
  const level1 = computeCapabilityMapTree(capabilities).l1.map((column) => column.capability);
  const out = new Map<string, readonly ElementsHeadRow[]>();
  out.set('unlinked-systems', findSystemsWithoutCapability(systems, supports, containers, usesAndFlows));
  out.set('platform-supports-move-to-module', findPlatformSupportsThatShouldMoveToModule(systems, supports, containers));
  out.set('unowned-capabilities', findCapabilitiesWithoutOwner(capabilities, supports, owns));
  out.set('stale-attributes', computeStaleAttributesFinding(facts, elements, now, staleAfterMonths).staleElements);
  out.set('no-technical-owner', findSystemsWithoutTechnicalOwner(systemsAndModules, owns));
  out.set('ai-agent-no-technical-owner', findAiAgentsActingAloneWithoutTechnicalOwner(systems, owns));
  out.set('critical-no-business-owner', findCriticalSystemsWithoutBusinessOwner(systemsAndModules, owns));
  out.set('critical-exposed', findCriticalExposedSystems(systemsAndModules, now, replacedElementIds(replaces)));
  out.set('unused-integration-platform', findUnusedIntegrationPlatforms(systems, usesAndFlows, containers));
  out.set('unused-integration-interface', findUnusedIntegrationInterfaces(systems, containers, usesAndFlows));
  out.set('essential-no-technical-owner', findSystemsSupportingEssentialFunctionWithoutTechnicalOwner(systemsAndModules, capabilities, supports, owns));
  out.set('critical-support-end', findCriticalSystemsPastOrNearSupportEnd(systemsAndModules, now));
  out.set('capability-no-supporters', findCapabilitiesWithNoSupporters(level1, capabilities, supports, owns));
  if (retiredByOpenChanges !== undefined) {
    out.set('outgoing-no-retiring-change', findOutgoingWithoutRetiringChange(systemsAndModules, retiredByOpenChanges, new Map(elements.map((element) => [element.element_id, element]))));
  }
  return out;
}

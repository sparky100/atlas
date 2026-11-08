/**
 * `list_health_findings`: the same named checks the Elements page's Finding
 * filter and the architect door's Health findings panel use
 * (`src/db/healthFindings.ts`), run over the snapshot. With no `finding` it
 * returns every check's count; with one it returns the elements that check
 * flagged, so "which critical systems have no business owner" is answered by
 * the product's own definition, not a new one.
 */
import { z } from 'zod';
import type { ElementsHeadRow } from '../contracts/rows';
import { FINDING_FILTER_OPTIONS } from '../db/elementBrowse';
import {
  computeStaleAttributesFinding,
  findCapabilitiesWithNoSupporters,
  findCapabilitiesWithoutOwner,
  findCriticalExposedSystems,
  findReplacementsWithoutDeparturePlan,
  findCriticalSystemsPastOrNearSupportEnd,
  findCriticalSystemsWithoutBusinessOwner,
  findOutgoingWithoutRetiringChange,
  findPlatformSupportsThatShouldMoveToModule,
  findSystemsSupportingEssentialFunctionWithoutTechnicalOwner,
  findSystemsWithoutCapability,
  findSystemsWithoutTechnicalOwner,
  findUnusedIntegrationInterfaces,
  findUnusedIntegrationPlatforms,
} from '../db/healthFindings';
import { computeCapabilityMapTree } from '../engine/elementRead/capabilityTree';
import { replacedElementIds } from '../engine/elementRead/fitAndExposure';
import { DEFAULT_TOOL_ROWS, MAX_TOOL_ROWS } from './limits';
import { defineTool, elementRef, indexSnapshot, okResult } from './toolKit';
import type { ModelSnapshot } from './types';

const FINDINGS = FINDING_FILTER_OPTIONS.filter((o) => o.value !== '');
const KEYS = FINDINGS.map((o) => o.value) as [string, ...string[]];

export interface FindingInputs {
  snapshot: ModelSnapshot;
  facts: Parameters<typeof computeStaleAttributesFinding>[0];
  retiredByOpenChanges: ReadonlySet<string>;
  now: Date;
}

/** Every finding's flagged elements, keyed as `FINDING_FILTER_OPTIONS` keys them. Pure. */
export function computeFindings({ snapshot, facts, retiredByOpenChanges, now }: FindingInputs): Map<string, readonly ElementsHeadRow[]> {
  const elements = snapshot.elements;
  const systems = elements.filter((e) => e.element_type === 'system');
  const containers = elements.filter((e) => e.element_type === 'container');
  const capabilities = elements.filter((e) => e.element_type === 'capability');
  const systemsAndModules = [...systems, ...containers];
  const supports = snapshot.relationships.filter((r) => r.relationship_type === 'supports');
  const owns = snapshot.relationships.filter((r) => r.relationship_type === 'owns');
  const replaces = snapshot.relationships.filter((r) => r.relationship_type === 'replaces');
  const usesAndFlows = snapshot.relationships.filter((r) => r.relationship_type === 'uses' || r.relationship_type === 'flows_to');
  const byId = new Map(elements.map((e) => [e.element_id, e]));
  const level1 = computeCapabilityMapTree(capabilities).l1.map((column) => column.capability);
  const out = new Map<string, readonly ElementsHeadRow[]>();
  out.set('unlinked-systems', findSystemsWithoutCapability(systems, supports, containers));
  out.set('platform-supports-move-to-module', findPlatformSupportsThatShouldMoveToModule(systems, supports, containers));
  out.set('unowned-capabilities', findCapabilitiesWithoutOwner(capabilities, supports, owns));
  out.set('stale-attributes', computeStaleAttributesFinding(facts, systems, now).staleSystems);
  out.set('no-technical-owner', findSystemsWithoutTechnicalOwner(systemsAndModules, owns));
  out.set('critical-no-business-owner', findCriticalSystemsWithoutBusinessOwner(systemsAndModules, owns));
  out.set('critical-exposed', findCriticalExposedSystems(systems, now, replacedElementIds(replaces)));
  out.set('replacement-no-departure-plan', findReplacementsWithoutDeparturePlan(systemsAndModules, replaces));
  out.set('unused-integration-platform', findUnusedIntegrationPlatforms(systems, usesAndFlows, containers));
  out.set('unused-integration-interface', findUnusedIntegrationInterfaces(systems, containers, usesAndFlows));
  out.set('essential-no-technical-owner', findSystemsSupportingEssentialFunctionWithoutTechnicalOwner(systemsAndModules, capabilities, supports, owns));
  out.set('critical-support-end', findCriticalSystemsPastOrNearSupportEnd(systems, now));
  out.set('capability-no-supporters', findCapabilitiesWithNoSupporters(level1, capabilities, supports, owns));
  out.set('outgoing-no-retiring-change', findOutgoingWithoutRetiringChange(systemsAndModules, retiredByOpenChanges, byId));
  return out;
}

const schema = z.strictObject({
  finding: z.enum(KEYS).optional().describe('One finding key from the list this tool returns when called with no finding.'),
  limit: z.number().int().min(1).max(MAX_TOOL_ROWS).default(DEFAULT_TOOL_ROWS),
});

export const listHealthFindings = defineTool({
  name: 'list_health_findings',
  description: `The model's data-quality checks (the same ones as the Health findings panel). With no "finding", returns every check with its label and count. With a "finding" key (one of: ${KEYS.join(', ')}), returns the elements that check flagged.`,
  schema,
  run: async (ctx, input) => {
    const snapshot = await ctx.snapshot();
    const findings = computeFindings({ snapshot, facts: await ctx.allFacts(), retiredByOpenChanges: await ctx.retiredByOpenChanges(), now: ctx.now() });
    if (input.finding === undefined) {
      return okResult(ctx, { findings: FINDINGS.map((o) => ({ finding: o.value, label: o.label, count: findings.get(o.value)?.length ?? 0 })) });
    }
    const index = indexSnapshot(snapshot);
    const flagged = findings.get(input.finding) ?? [];
    const shown = flagged.slice(0, input.limit);
    const label = FINDINGS.find((o) => o.value === input.finding)?.label ?? input.finding;
    return okResult(ctx, { finding: input.finding, label, elements: shown.map((e) => elementRef(index, e)) }, flagged.length, flagged.length > shown.length);
  },
});

/**
 * The standing test fixture for the Context diagram: a real-density
 * scenario, not a synthetic two-neighbour one — SAP PM (Asset Maintenance),
 * one of SAP's own modules, with four internal neighbours carrying one to
 * two flows each, and one external organisation auditing it directly (so
 * the boundary, the external band and a real multi-edge fan are all
 * exercised together).
 *
 * V3 ("container context pages, platform context simplified to structure
 * only") moved the Context diagram's own crowding case from the platform
 * level down to a single container's own page — a platform with modules
 * never draws a diagram at all any more (`PlatformStructureView.tsx`
 * instead), and a module (a container in its own right) is exactly the
 * kind of hub this file's own density case now belongs to. `SAP_MODULES`
 * is kept alongside it — the same 8-module set, reused by the platform's
 * own structure-page fixture — so both surfaces describe the same SAP
 * without drifting apart.
 *
 * Two consumers share this one description so they can never drift:
 *
 *  - `contextDiagramLayout.test.ts` feeds `scenarioLayoutInputs()` (stable
 *    string ids, no database) into `computeContextDiagramLayout` and
 *    `placeEdgeLabels`, and asserts the geometry — fan spread, distinct
 *    lanes, no edge through a tile, no label collision at 1280.
 *  - `e2e/fixtures/sapContextFixture.ts` seeds `SAP_MODULES` and
 *    `PM_CONTEXT_SCENARIO` into a real model (fresh UUIDs) for
 *    `e2e/context-diagram.engine.spec.ts`.
 *
 * Any future change to the Context diagram's layout, routing or labels is
 * checked against this density first. Add neighbours or flows here rather
 * than inventing a smaller case in a test.
 */
import type { UUID } from '../../../contracts/delta';
import type { ContextEdgeInput } from '../contextDiagramLayout';

export interface ScenarioModule {
  code: string;
  name: string;
  capability: string;
}

/** SAP's own 8 modules — the platform-structure page's own fixture (structure only, no neighbours, no diagram). */
export const SAP_MODULES: readonly ScenarioModule[] = [
  { code: 'FI', name: 'FI', capability: 'Finance' },
  { code: 'CO', name: 'CO', capability: 'Management Accounting' },
  { code: 'MM', name: 'MM', capability: 'Procurement' },
  { code: 'SD', name: 'SD', capability: 'Customer Billing' },
  { code: 'PM', name: 'PM', capability: 'Asset Maintenance' },
  { code: 'PS', name: 'PS', capability: 'Capital Projects' },
  { code: 'HR', name: 'HR', capability: 'People' },
  { code: 'BW', name: 'BW', capability: 'Reporting & Analytics' },
];

export const SAP_HUB_NAME = 'SAP';
export const SAP_HUB_DESCRIPTION = 'Core ERP platform for finance, procurement, asset maintenance and people.';

export interface ScenarioFlow {
  relationshipType: 'uses' | 'flows_to';
  /** `in`: neighbour → hub side (arrow at the hub); `out`: hub side → neighbour. */
  direction: 'in' | 'out';
  verb: string;
}

export interface ScenarioNeighbour {
  key: string;
  name: string;
  elementType: 'system' | 'actor';
  isExternal: boolean;
  externalOrganisation?: string;
  flows: ScenarioFlow[];
}

export interface ContainerContextScenario {
  /** Which of `SAP_MODULES` this scenario's own hub is — PM (Asset Maintenance), the module with the most real connections in the source data. */
  hubModuleCode: string;
  neighbours: ScenarioNeighbour[];
}

/** SAP PM's own real neighbours — the Context diagram's density case, moved down to a single module's own page (V3). Every flow here named PM directly in the pre-V3 combined diagram this fixture originally modelled; nothing invented. */
export const PM_CONTEXT_SCENARIO: ContainerContextScenario = {
  hubModuleCode: 'PM',
  neighbours: [
    {
      key: 'gdt',
      name: 'Graphical Design Tool',
      elementType: 'system',
      isExternal: false,
      flows: [{ relationshipType: 'flows_to', direction: 'in', verb: 'publishes as-built drawings to' }],
    },
    {
      key: 'escoms',
      name: 'ESCOMS',
      elementType: 'system',
      isExternal: false,
      flows: [
        { relationshipType: 'flows_to', direction: 'out', verb: 'issues planned outage work orders to' },
        { relationshipType: 'flows_to', direction: 'in', verb: 'reports fault and switching events to' },
      ],
    },
    {
      key: 'poweron',
      name: 'PowerON',
      elementType: 'system',
      isExternal: false,
      flows: [
        { relationshipType: 'flows_to', direction: 'out', verb: 'sends maintenance outage requests to' },
        { relationshipType: 'flows_to', direction: 'in', verb: 'returns switching schedules and completion to' },
      ],
    },
    {
      key: 'field-service',
      name: 'Field Service',
      elementType: 'system',
      isExternal: false,
      flows: [
        { relationshipType: 'flows_to', direction: 'out', verb: 'dispatches work orders to' },
        { relationshipType: 'flows_to', direction: 'in', verb: 'returns job completion and timesheets to' },
      ],
    },
    {
      key: 'ofgem',
      name: 'Ofgem',
      elementType: 'actor',
      isExternal: true,
      externalOrganisation: 'Ofgem',
      flows: [{ relationshipType: 'uses', direction: 'in', verb: 'audits maintenance compliance for' }],
    },
  ],
};

/** The same arrow-decorated label `contextGrouping.ts`'s `edgeLabel` builds for a real edge, from the scenario's own direction/verb. */
export function scenarioEdgeLabel(flow: ScenarioFlow): string {
  const arrow = flow.relationshipType === 'flows_to' ? '⇢' : flow.direction === 'out' ? '→' : '←';
  return flow.direction === 'out' ? `${flow.verb} ${arrow}` : `${arrow} ${flow.verb}`;
}

export interface ScenarioLayoutInputs {
  hubId: UUID;
  internal: UUID[];
  external: UUID[];
  edges: ContextEdgeInput[];
}

/** The scenario as `computeContextDiagramLayout` inputs, with stable, readable ids (`pm`, `gdt`, `escoms`…) — no database, no randomness. */
export function scenarioLayoutInputs(scenario: ContainerContextScenario = PM_CONTEXT_SCENARIO): ScenarioLayoutInputs {
  const hubId = scenario.hubModuleCode.toLowerCase();
  const internal: UUID[] = [];
  const external: UUID[] = [];
  const edges: ContextEdgeInput[] = [];
  for (const neighbour of scenario.neighbours) {
    (neighbour.isExternal ? external : internal).push(neighbour.key);
    neighbour.flows.forEach((flow, i) => {
      edges.push({ id: `${neighbour.key}-${String(i)}`, neighbourId: neighbour.key, arrowAtHub: flow.direction === 'in', label: scenarioEdgeLabel(flow) });
    });
  }
  return { hubId, internal, external, edges };
}

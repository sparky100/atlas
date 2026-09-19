/**
 * The standing test fixture for the Context diagram: a real-density
 * scenario, not a synthetic two-neighbour one — SAP PM (Asset Maintenance),
 * one of SAP's own modules, with its real 8 neighbours and 12 relationships
 * (Context layout v2's own test fixture, matched to the real page this
 * layout was designed against): 3 source-direction neighbours, 4
 * target-direction, and exactly one two-way pair (Field Service, dispatch
 * out / completion in) — so the ring layout's source/target columns, the
 * bidirectional-merge case, and (Informatica, an external SaaS vendor) the
 * boundary are all exercised together in one fixture.
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
import type { ContextEdgeInput, ContextNeighbourInput } from '../contextDiagramLayout';

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

/**
 * SAP PM's own real 8 neighbours, 12 relationships — the Context diagram's
 * density case, moved down to a single module's own page (V3), then
 * expanded to the real page's own full neighbour set for Context layout
 * v2 (the 5-neighbour set this replaced only ever modelled a subset).
 * Exactly one two-way pair (`field-service`) by design — v2's own
 * bidirectional-merge case — every other neighbour is single-direction,
 * some with more than one flow the same way.
 */
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
      key: 'crm',
      name: 'CRM',
      elementType: 'system',
      isExternal: false,
      flows: [
        { relationshipType: 'uses', direction: 'in', verb: 'raises customer fault reports to' },
        { relationshipType: 'uses', direction: 'in', verb: 'requests asset location lookups from' },
      ],
    },
    {
      key: 'narms',
      name: 'NARMS',
      elementType: 'system',
      isExternal: false,
      flows: [{ relationshipType: 'flows_to', direction: 'in', verb: 'reports network asset risk scores to' }],
    },
    {
      key: 'enterprise',
      name: 'Enterprise',
      elementType: 'system',
      isExternal: false,
      flows: [
        { relationshipType: 'uses', direction: 'out', verb: 'posts maintenance cost actuals to' },
        { relationshipType: 'uses', direction: 'out', verb: 'synchronises asset hierarchy to' },
      ],
    },
    {
      key: 'poweron',
      name: 'PowerON',
      elementType: 'system',
      isExternal: false,
      flows: [
        { relationshipType: 'flows_to', direction: 'out', verb: 'sends planned maintenance outage requests to' },
        { relationshipType: 'flows_to', direction: 'out', verb: 'sends emergency switching escalations to' },
      ],
    },
    {
      key: 'rhythm',
      name: 'RHYTHM',
      elementType: 'system',
      isExternal: false,
      flows: [{ relationshipType: 'flows_to', direction: 'out', verb: 'sends planned maintenance schedules to' }],
    },
    {
      key: 'informatica',
      name: 'Informatica',
      elementType: 'system',
      isExternal: true,
      externalOrganisation: 'Informatica',
      flows: [{ relationshipType: 'flows_to', direction: 'out', verb: 'streams asset and work order data to' }],
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
  ],
};

/** The same arrow-decorated label `contextGrouping.ts`'s `edgeLabel` builds for a real edge, from the scenario's own direction/verb. */
export function scenarioEdgeLabel(flow: ScenarioFlow): string {
  const arrow = flow.relationshipType === 'flows_to' ? '⇢' : flow.direction === 'out' ? '→' : '←';
  return flow.direction === 'out' ? `${flow.verb} ${arrow}` : `${arrow} ${flow.verb}`;
}

export interface ScenarioLayoutInputs {
  hubId: UUID;
  neighbours: ContextNeighbourInput[];
  edges: ContextEdgeInput[];
}

/** The scenario as `computeContextDiagramLayout` inputs, with stable, readable ids (`pm`, `gdt`, `crm`…) — no database, no randomness. */
export function scenarioLayoutInputs(scenario: ContainerContextScenario = PM_CONTEXT_SCENARIO): ScenarioLayoutInputs {
  const hubId = scenario.hubModuleCode.toLowerCase();
  const neighbours: ContextNeighbourInput[] = [];
  const edges: ContextEdgeInput[] = [];
  for (const neighbour of scenario.neighbours) {
    neighbours.push({ id: neighbour.key, isExternal: neighbour.isExternal, isActor: neighbour.elementType === 'actor' });
    neighbour.flows.forEach((flow, i) => {
      edges.push({ id: `${neighbour.key}-${String(i)}`, neighbourId: neighbour.key, arrowAtHub: flow.direction === 'in', label: scenarioEdgeLabel(flow) });
    });
  }
  return { hubId, neighbours, edges };
}

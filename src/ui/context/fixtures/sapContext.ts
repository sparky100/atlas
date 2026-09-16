/**
 * The standing test fixture for the Context diagram: a real-density
 * scenario, not a synthetic two-neighbour one. SAP as a platform with eight
 * modules, five internal neighbours each carrying two to four flows (to
 * different modules, in both directions), and one external organisation
 * using the platform directly (so the boundary, the external band and the
 * "which module?" marker are all exercised too).
 *
 * Two consumers share this one description so they can never drift:
 *
 *  - `contextDiagramLayout.test.ts` feeds `sapContextLayoutInputs()` (stable
 *    string ids, no database) into `computeContextDiagramLayout` and
 *    `placeEdgeLabels`, and asserts the geometry — fan spread, distinct
 *    lanes, no edge through a tile, no label collision at 1280.
 *  - `e2e/fixtures/sapContextFixture.ts` seeds `SAP_CONTEXT_SCENARIO` into a
 *    real model (fresh UUIDs) for `e2e/context-diagram.engine.spec.ts`.
 *
 * Any future change to the Context diagram's layout, routing or labels is
 * checked against this density first. Add neighbours or flows here rather
 * than inventing a smaller case in a test.
 */
import type { UUID } from '../../../contracts/delta';
import type { ContextEdgeInput, DiagramUnitInput } from '../contextDiagramLayout';

export interface ScenarioModule {
  code: string;
  name: string;
  capability: string;
}

export interface ScenarioFlow {
  relationshipType: 'uses' | 'flows_to';
  /** `in`: neighbour → hub side (arrow at the hub); `out`: hub side → neighbour. */
  direction: 'in' | 'out';
  /** The hub module this flow attaches to, by `ScenarioModule.code`; `null` attaches to the platform itself (the "which module?" marker case). */
  module: string | null;
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

export interface ContextScenario {
  hubName: string;
  hubDescription: string;
  modules: ScenarioModule[];
  neighbours: ScenarioNeighbour[];
}

export const SAP_CONTEXT_SCENARIO: ContextScenario = {
  hubName: 'SAP',
  hubDescription: 'Core ERP platform for finance, procurement, asset maintenance and people.',
  modules: [
    { code: 'FI', name: 'FI', capability: 'Finance' },
    { code: 'CO', name: 'CO', capability: 'Management Accounting' },
    { code: 'MM', name: 'MM', capability: 'Procurement' },
    { code: 'SD', name: 'SD', capability: 'Customer Billing' },
    { code: 'PM', name: 'PM', capability: 'Asset Maintenance' },
    { code: 'PS', name: 'PS', capability: 'Capital Projects' },
    { code: 'HR', name: 'HR', capability: 'People' },
    { code: 'BW', name: 'BW', capability: 'Reporting & Analytics' },
  ],
  neighbours: [
    {
      key: 'gdt',
      name: 'Graphical Design Tool',
      elementType: 'system',
      isExternal: false,
      flows: [
        { relationshipType: 'flows_to', direction: 'in', module: 'PS', verb: 'submits approved design packs to' },
        { relationshipType: 'flows_to', direction: 'in', module: 'PM', verb: 'publishes as-built drawings to' },
      ],
    },
    {
      key: 'crm',
      name: 'CRM',
      elementType: 'system',
      isExternal: false,
      flows: [
        { relationshipType: 'flows_to', direction: 'in', module: 'SD', verb: 'raises connection quotations in' },
        { relationshipType: 'uses', direction: 'in', module: 'FI', verb: 'checks customer credit status in' },
        { relationshipType: 'flows_to', direction: 'out', module: 'SD', verb: 'returns invoice and payment status to' },
      ],
    },
    {
      key: 'escoms',
      name: 'ESCOMS',
      elementType: 'system',
      isExternal: false,
      flows: [
        { relationshipType: 'flows_to', direction: 'in', module: 'MM', verb: 'requests spares and materials from' },
        { relationshipType: 'flows_to', direction: 'out', module: 'PM', verb: 'issues planned outage work orders to' },
        { relationshipType: 'flows_to', direction: 'in', module: 'PM', verb: 'reports fault and switching events to' },
      ],
    },
    {
      key: 'poweron',
      name: 'PowerON',
      elementType: 'system',
      isExternal: false,
      flows: [
        { relationshipType: 'flows_to', direction: 'out', module: 'PM', verb: 'sends maintenance outage requests to' },
        { relationshipType: 'flows_to', direction: 'in', module: 'PM', verb: 'returns switching schedules and completion to' },
        { relationshipType: 'flows_to', direction: 'in', module: 'BW', verb: 'feeds network event history to' },
      ],
    },
    {
      key: 'field-service',
      name: 'Field Service',
      elementType: 'system',
      isExternal: false,
      flows: [
        { relationshipType: 'flows_to', direction: 'out', module: 'PM', verb: 'dispatches work orders to' },
        { relationshipType: 'flows_to', direction: 'in', module: 'PM', verb: 'returns job completion and timesheets to' },
        { relationshipType: 'flows_to', direction: 'in', module: 'HR', verb: 'submits crew timesheets to' },
        { relationshipType: 'uses', direction: 'in', module: 'MM', verb: 'draws stock from' },
      ],
    },
    {
      key: 'ofgem',
      name: 'Ofgem',
      elementType: 'actor',
      isExternal: true,
      externalOrganisation: 'Ofgem',
      flows: [{ relationshipType: 'uses', direction: 'in', module: null, verb: 'submits RIIO returns to' }],
    },
  ],
};

/** The same arrow-decorated label `contextGrouping.ts`'s `edgeLabel` builds for a real edge, from the scenario's own direction/verb. */
export function scenarioEdgeLabel(flow: ScenarioFlow): string {
  const arrow = flow.relationshipType === 'flows_to' ? '⇢' : flow.direction === 'out' ? '→' : '←';
  return flow.direction === 'out' ? `${flow.verb} ${arrow}` : `${arrow} ${flow.verb}`;
}

export interface ScenarioLayoutInputs {
  hub: DiagramUnitInput;
  internal: DiagramUnitInput[];
  external: DiagramUnitInput[];
  edges: ContextEdgeInput[];
  /** Module code → the stable module id used in `hub.modules`. */
  moduleIdByCode: Map<string, UUID>;
}

/** The scenario as `computeContextDiagramLayout` inputs, with stable, readable ids (`sap`, `fi`, `crm`, `crm-1`…) — no database, no randomness. */
export function scenarioLayoutInputs(scenario: ContextScenario = SAP_CONTEXT_SCENARIO): ScenarioLayoutInputs {
  const hubId = 'sap';
  const moduleIdByCode = new Map(scenario.modules.map((m) => [m.code, m.code.toLowerCase()]));
  const hub: DiagramUnitInput = { elementId: hubId, modules: scenario.modules.map((m) => ({ elementId: moduleIdByCode.get(m.code) ?? m.code, capabilityName: m.capability })) };
  const internal: DiagramUnitInput[] = [];
  const external: DiagramUnitInput[] = [];
  const edges: ContextEdgeInput[] = [];
  for (const neighbour of scenario.neighbours) {
    const attachedModuleIds = [...new Set(neighbour.flows.map((f) => (f.module ? (moduleIdByCode.get(f.module) ?? f.module) : null)).filter((id): id is string => id !== null))];
    const unit: DiagramUnitInput = { elementId: neighbour.key, modules: [], attachedModuleIds };
    (neighbour.isExternal ? external : internal).push(unit);
    neighbour.flows.forEach((flow, i) => {
      edges.push({
        id: `${neighbour.key}-${String(i)}`,
        neighbourId: neighbour.key,
        hubEndpointId: flow.module ? (moduleIdByCode.get(flow.module) ?? flow.module) : hubId,
        arrowAtHub: flow.direction === 'in',
        label: scenarioEdgeLabel(flow),
      });
    });
  }
  return { hub, internal, external, edges, moduleIdByCode };
}

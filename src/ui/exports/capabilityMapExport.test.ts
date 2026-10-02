import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, Json, RelationshipsHeadRow } from '../../contracts/rows';
import { capabilityMapExportPlan, capabilityMapViewLabel } from './capabilityMapExport';
import { TONE_COLOURS, type ExportShape } from './viewExport';

const STAMP = { modelName: 'Acme', refLabel: 'Main', date: '2026-10-02' };

function capability(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}
function system(id: string, attributes: Record<string, Json>): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name: id, parent_id: null, attributes, exists_delta_id: `d-${id}` };
}
function supports(systemId: string, capabilityId: string): RelationshipsHeadRow {
  return { relationship_id: `r-${systemId}-${capabilityId}`, relationship_type: 'supports', from_element_id: systemId, to_element_id: capabilityId, attributes: {}, exists_delta_id: `d-r-${systemId}` };
}
function texts(shapes: readonly ExportShape[]): string[] {
  return shapes.flatMap((s) => (s.kind === 'text' ? [s.text] : []));
}

describe('capabilityMapExportPlan (F13 step 1)', () => {
  const tree = {
    l1: [{ capability: capability('l1', 'Customer'), l2: [{ capability: capability('l2', 'Billing'), l3: [capability('l3', 'Invoicing')] }] }],
    orphans: [],
  };
  const systemsById = new Map([['sys', system('sys', { criticality: 'critical' })]]);

  it('labels the view by its colour-by', () => {
    expect(capabilityMapViewLabel('metric:criticality')).toBe('Capability map, coloured by Criticality');
    expect(capabilityMapViewLabel('none')).toBe('Capability map');
  });

  it('stamps the picture and draws every L1, L2 and L3 by name', () => {
    const plan = capabilityMapExportPlan({ tree, mode: 'none', supportsEdges: [], systemsById, stamp: STAMP });
    expect(texts(plan.shapes)).toEqual(expect.arrayContaining(['Capability map — Acme', 'Main · exported 2026-10-02 from Atlas', 'Customer', 'Billing', 'Invoicing']));
    expect(plan.width).toBe(720);
    expect(plan.height).toBeGreaterThan(0);
  });

  it('colours a tile the same way the map does', () => {
    const plan = capabilityMapExportPlan({ tree, mode: 'metric:criticality', supportsEdges: [supports('sys', 'l2')], systemsById, stamp: STAMP });
    const card = plan.shapes.find((s) => s.kind === 'rect' && s.fill === TONE_COLOURS.danger.fill);
    expect(card).toBeDefined();
    expect(texts(plan.shapes)).toContain('critical');
  });

  it('wraps more than five domains onto a second row rather than widening forever', () => {
    const many = { l1: Array.from({ length: 7 }, (_, i) => ({ capability: capability(`l1-${String(i)}`, `Domain ${String(i)}`), l2: [] })), orphans: [] };
    const plan = capabilityMapExportPlan({ tree: many, mode: 'none', supportsEdges: [], systemsById, stamp: STAMP });
    const five = capabilityMapExportPlan({ tree: { l1: many.l1.slice(0, 5), orphans: [] }, mode: 'none', supportsEdges: [], systemsById, stamp: STAMP });
    expect(plan.width).toBe(five.width);
    expect(plan.height).toBeGreaterThan(five.height);
  });

  it('says so when there are no capabilities', () => {
    const plan = capabilityMapExportPlan({ tree: { l1: [], orphans: [] }, mode: 'none', supportsEdges: [], systemsById, stamp: STAMP });
    expect(texts(plan.shapes)).toContain('No capabilities yet.');
  });
});

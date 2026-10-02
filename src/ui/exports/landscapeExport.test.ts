import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, Json } from '../../contracts/rows';
import type { LandscapeLayout } from '../landscape/layout';
import { landscapeExportPlan, landscapeViewLabel } from './landscapeExport';
import { TONE_COLOURS, type ExportShape } from './viewExport';

const STAMP = { modelName: 'Acme', refLabel: 'Version v1', date: '2026-10-02' };

function element(id: string, type: string, name: string, attributes: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: type, name, parent_id: null, attributes, exists_delta_id: `d-${id}` } as ElementsHeadRow;
}
function texts(shapes: readonly ExportShape[]): string[] {
  return shapes.flatMap((s) => (s.kind === 'text' ? [s.text] : []));
}

const layout: LandscapeLayout = {
  nodes: [{ elementId: 'sys', x: 20, y: 120 }],
  actorNodes: [{ elementId: 'act', x: 20, y: 10 }],
  lanes: [
    { key: 'cap', label: 'Customer', region: 'capability', y: 100, height: 80, collapsed: false },
    { key: 'ext', label: 'External', region: 'external', y: 180, height: 60, collapsed: true },
  ],
  referenceMarkers: [],
  boundary: { top: 100, bottom: 180 },
  width: 600,
  height: 240,
};

describe('landscapeExportPlan (F13 step 1)', () => {
  const systemsById = new Map([['sys', element('sys', 'system', 'Housing CRM', { criticality: 'critical' })]]);
  const actorsById = new Map([['act', element('act', 'actor', 'Tenant')]]);

  it('labels the view by its colour-by', () => {
    expect(landscapeViewLabel('metric:criticality')).toBe('Landscape, coloured by Criticality');
    expect(landscapeViewLabel('none')).toBe('Landscape');
  });

  it('stamps the picture and draws lanes, actors and systems at their laid-out positions', () => {
    const plan = landscapeExportPlan({ layout, systemsById, actorsById, colourBy: 'none', stamp: STAMP });
    expect(texts(plan.shapes)).toEqual(expect.arrayContaining(['Landscape — Acme', 'Version v1 · exported 2026-10-02 from Atlas', 'Customer', 'External (collapsed)', 'Tenant', 'Housing CRM']));
    expect(plan.width).toBe(720);
    expect(landscapeExportPlan({ layout: { ...layout, width: 1200 }, systemsById, actorsById, colourBy: 'none', stamp: STAMP }).width).toBe(1200 + 48);
  });

  it('colours each system by the landscape colour-by and labels the value', () => {
    const plan = landscapeExportPlan({ layout, systemsById, actorsById, colourBy: 'metric:criticality', stamp: STAMP });
    expect(plan.shapes.some((s) => s.kind === 'rect' && s.fill === TONE_COLOURS.danger.fill)).toBe(true);
    expect(texts(plan.shapes)).toContain('critical');
  });

  it('says plainly that connections are not drawn', () => {
    const plan = landscapeExportPlan({ layout, systemsById, actorsById, colourBy: 'none', stamp: STAMP });
    expect(texts(plan.shapes).some((t) => t.includes('Connections between systems are not shown'))).toBe(true);
  });
});

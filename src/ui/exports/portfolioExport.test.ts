import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { PortfolioRow } from '../portfolio/usePortfolio';
import { portfolioExportPlan, portfolioExportTable } from './portfolioExport';
import { TONE_COLOURS, type ExportShape } from './viewExport';

const STAMP = { modelName: 'Acme', refLabel: 'Main', date: '2026-10-02' };

function texts(shapes: readonly ExportShape[]): string[] {
  return shapes.flatMap((s) => (s.kind === 'text' ? [s.text] : []));
}

function row(overrides: Partial<PortfolioRow> = {}): PortfolioRow {
  const element: ElementsHeadRow = { element_id: 'sys', element_type: 'system', name: 'Housing CRM', parent_id: null, attributes: {}, exists_delta_id: 'd-sys' };
  return {
    element,
    name: 'Housing CRM',
    topLevelSystemId: 'sys',
    cost: null,
    fit: null,
    criticality: null,
    disposition: null,
    lifecycleStatus: null,
    lifecycleExposed: null,
    capabilities: [],
    businessOwner: null,
    ownsEdges: [],
    signals: [],
    missingInputs: [],
    ...overrides,
  };
}

describe('portfolioExportPlan (F13 step 1)', () => {
  it('stamps the picture with the row count and draws the column headings', () => {
    const plan = portfolioExportPlan([row()], STAMP);
    expect(texts(plan.shapes)).toEqual(expect.arrayContaining(['Portfolio (1 row) — Acme', 'Name', 'Run cost', 'Disposition', 'Signals', 'Housing CRM']));
  });

  it('shows unrecorded values the way the table does', () => {
    const plan = portfolioExportPlan([row()], STAMP);
    expect(texts(plan.shapes)).toEqual(expect.arrayContaining(['Not entered', 'Unrated', 'Not assessed']));
  });

  it('draws a toned pill for a recorded value', () => {
    const plan = portfolioExportPlan([row({ criticality: 'critical' })], STAMP);
    expect(plan.shapes.some((s) => s.kind === 'rect' && s.fill === TONE_COLOURS.danger.fill)).toBe(true);
    expect(texts(plan.shapes)).toContain('critical');
  });

  it('grows one line per row and says so when nothing matches', () => {
    const one = portfolioExportPlan([row()], STAMP);
    const three = portfolioExportPlan([row(), row(), row()], STAMP);
    expect(three.height - one.height).toBe(2 * 26);
    expect(texts(portfolioExportPlan([], STAMP).shapes)).toEqual(expect.arrayContaining(['Portfolio (0 rows) — Acme', 'No systems match.']));
  });
});

describe('portfolioExportTable (the Excel export)', () => {
  it('writes the same column headings as the picture, then one untruncated row per portfolio row', () => {
    const long = 'A system with a very long name that the picture would cut short at thirty-two characters';
    const table = portfolioExportTable([row({ name: long })]);
    expect(table[0]).toEqual(['Name', 'Kind', 'Run cost', 'Fit', 'Criticality', 'Disposition', 'Lifecycle', 'Capabilities', 'Business owner', 'Signals']);
    expect(table[1]?.[0]).toBe(long);
    expect(table).toHaveLength(2);
  });

  it('reads unrecorded values the way the table does, and is just the header row when nothing matches', () => {
    const [, first] = portfolioExportTable([row()]);
    expect(first).toEqual(expect.arrayContaining(['Not entered', 'Unrated', 'Not assessed']));
    expect(portfolioExportTable([])).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { ANNUAL_RUN_COST_LABELS, DISPOSITION_LABELS } from '../../contracts/attributeSchema';
import { parseReportSpec } from '../../contracts/reportSpec';
import { runReport } from '../../engine/reportQuery';
import { fakeElement, fakeRow } from '../portfolio/portfolioTestFixtures';
import { tileKindsFor } from './dashboardTiles';
import { PORTFOLIO_REPORT_FIELDS, PORTFOLIO_REPORT_HELPER_FIELDS, PORTFOLIO_REPORT_OPTIONAL_FIELDS, portfolioReportRow } from './portfolioReport';
import { STANDARD_DASHBOARDS } from './standardDashboards';

const FIELDS = new Set<string>([...PORTFOLIO_REPORT_FIELDS, ...PORTFOLIO_REPORT_OPTIONAL_FIELDS, ...PORTFOLIO_REPORT_HELPER_FIELDS]);
const tiles = STANDARD_DASHBOARDS.flatMap((d) => d.tiles.map((t) => ({ dashboard: d.name, ...t })));

describe('standard dashboards', () => {
  it('every report is a valid spec that survives the database round trip', () => {
    for (const t of tiles) expect(parseReportSpec(JSON.parse(JSON.stringify(t.spec))), t.name).toEqual({ ok: true, spec: t.spec });
  });

  it('names only fields the portfolio source has, so nothing reads "attribute removed"', () => {
    for (const t of tiles) {
      const named = [...t.spec.columns, ...t.spec.filters.map((f) => f.field), ...t.spec.sort.map((s) => s.field), t.spec.groupBy, t.spec.splitBy].filter((f): f is string => f !== undefined);
      for (const f of named) expect(FIELDS.has(f), `${t.name}: ${f}`).toBe(true);
    }
  });

  it('filters on real stored values', () => {
    const costs = new Set(Object.keys(ANNUAL_RUN_COST_LABELS));
    const dispositions = new Set(Object.keys(DISPOSITION_LABELS));
    for (const t of tiles) {
      for (const f of t.spec.filters) {
        const values = Array.isArray(f.value) ? f.value : [f.value];
        if (f.field === 'cost') for (const v of values) expect(costs.has(String(v)), `${t.name}: ${String(v)}`).toBe(true);
        if (f.field === 'disposition' && f.operator !== 'isEmpty') for (const v of values) expect(dispositions.has(String(v)), `${t.name}: ${String(v)}`).toBe(true);
      }
    }
  });

  it('every tile kind can show its report, and table tiles stay within 1 to 50 rows', () => {
    for (const t of tiles) {
      expect(tileKindsFor(t.spec), t.name).toContain(t.kind);
      if (t.rowLimit !== undefined) expect(t.rowLimit >= 1 && t.rowLimit <= 50).toBe(true);
    }
  });

  it('names are unique within a dashboard, and dashboards are unique', () => {
    expect(new Set(STANDARD_DASHBOARDS.map((d) => d.name)).size).toBe(STANDARD_DASHBOARDS.length);
    for (const d of STANDARD_DASHBOARDS) expect(new Set(d.tiles.map((t) => t.name)).size).toBe(d.tiles.length);
  });

  it('runs over portfolio rows: applications exclude modules, and the TIME filters pick the right rows', () => {
    const rows = [
      fakeRow({ element: fakeElement('a'), name: 'A', cost: 'over_5m', fit: 'poor', disposition: 'eliminate', signals: [{ key: 'costly_poor_fit' } as never] }),
      fakeRow({ element: fakeElement('b'), name: 'B', cost: 'under_50k', fit: 'good', disposition: 'invest' }),
      fakeRow({ element: fakeElement('m', 'container'), name: 'A · module', cost: 'over_5m', disposition: 'migrate' }),
    ].map(portfolioReportRow);
    const count = (name: string) => {
      const t = tiles.find((x) => x.name === name);
      if (t === undefined) throw new Error(name);
      return runReport(rows, t.spec).rowCount;
    };
    expect(count('Applications')).toBe(2);
    expect(count('To eliminate or migrate')).toBe(1);
    expect(count('Costly, poor fit')).toBe(1);
    expect(count('Run cost over £1m')).toBe(1);
  });

  it('the AI in use dashboard counts agents and other AI use, and lists the freest agents first', () => {
    const rows = [
      fakeRow({ element: fakeElement('plain'), name: 'Plain system' }),
      fakeRow({ element: fakeElement('a', 'system', { aiAutonomy: 'suggests' }), name: 'Drafting agent' }),
      fakeRow({ element: fakeElement('b', 'system', { aiAutonomy: 'acts_alone' }), name: 'Meter bot' }),
      fakeRow({ element: fakeElement('c', 'system', { aiAutonomy: 'acts_alone' }), name: 'Claims bot', businessOwner: fakeElement('o', 'system') }),
      fakeRow({ element: fakeElement('d', 'system', { aiUse: 'built_in' }), name: 'CRM with copilot' }),
      fakeRow({ element: fakeElement('e', 'system', { aiUse: 'external_service' }), name: 'Billing engine' }),
    ].map(portfolioReportRow);
    const tile = (name: string) => {
      const t = tiles.find((x) => x.name === name);
      if (t === undefined) throw new Error(name);
      return runReport(rows, t.spec);
    };
    expect(tile('Systems using AI').rowCount).toBe(5);
    expect(tile('AI agents').rowCount).toBe(3);
    expect(tile('AI agents that act alone').rowCount).toBe(2);
    expect(tile('Using AI with no business owner').rowCount).toBe(4);
    expect(tile('AI inventory').rows.map((r) => r[0])).toEqual(['Claims bot', 'Meter bot', 'Drafting agent', 'Billing engine', 'CRM with copilot']);
  });
});

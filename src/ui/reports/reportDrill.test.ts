import { describe, expect, it } from 'vitest';
import { REPORT_SPEC_VERSION, type ReportSpec } from '../../contracts/reportSpec';
import { runReport } from '../../engine/reportQuery';
import { drilledSpec, drillLabel, drillSearch, parseDrill } from './reportDrill';

const spec: ReportSpec = {
  specVersion: REPORT_SPEC_VERSION,
  source: 'elements',
  filters: [{ field: 'type', operator: 'eq', value: 'system' }],
  columns: ['name', 'lifecycle'],
  sort: [{ field: 'name', direction: 'asc' }],
  groupBy: 'lifecycle',
  splitBy: 'criticality',
  presentation: { kind: 'barByField' },
};

describe('report drill', () => {
  it('round-trips through the address, keeping value types distinct', () => {
    const drills = [
      { field: 'lifecycle', value: 'active' },
      { field: 'capabilities', value: 3 },
      { field: 'flag', value: true },
      { field: 'owner', value: null },
    ];
    expect(parseDrill(new URLSearchParams(drillSearch(drills)))).toEqual(drills);
    expect(parseDrill(new URLSearchParams(drillSearch([{ field: 'x', value: '3' }])))).toEqual([{ field: 'x', value: '3' }]);
  });

  it('ignores a malformed address rather than guessing', () => {
    expect(parseDrill(new URLSearchParams('f=a'))).toEqual([]);
    expect(parseDrill(new URLSearchParams('f=a&v=notjson'))).toEqual([]);
    expect(parseDrill(new URLSearchParams('f=a&v=%5B1%5D'))).toEqual([]);
    expect(parseDrill(new URLSearchParams(''))).toEqual([]);
  });

  it('narrows the report to the clicked rows, keeping its own filters, as a table', () => {
    const rows = [
      { id: '1', name: 'A', type: 'system', lifecycle: 'active', criticality: 'high' },
      { id: '2', name: 'B', type: 'system', lifecycle: 'active', criticality: null },
      { id: '3', name: 'C', type: 'system', lifecycle: 'retired', criticality: 'high' },
      { id: '4', name: 'D', type: 'capability', lifecycle: 'active', criticality: 'high' },
    ];
    const one = runReport(rows, drilledSpec(spec, [{ field: 'lifecycle', value: 'active' }]));
    expect(one.rows.map((r) => r[0])).toEqual(['A', 'B']);
    const notSet = runReport(rows, drilledSpec(spec, [{ field: 'lifecycle', value: 'active' }, { field: 'criticality', value: null }]));
    expect(notSet.rows.map((r) => r[0])).toEqual(['B']);
    expect(drilledSpec(spec, []).groupBy).toBeUndefined();
  });

  it('describes the drill in plain words', () => {
    expect(drillLabel([{ field: 'lifecycle', value: 'active' }, { field: 'criticality', value: null }])).toBe('Lifecycle is active and Criticality is not set');
  });
});

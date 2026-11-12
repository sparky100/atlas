import { describe, expect, it } from 'vitest';
import { parseReportSpec } from '../../contracts/reportSpec';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { computeFindings } from '../../db/modelFindings';
import { runReportWithRows } from '../../engine/reportQuery';
import { findingReportRows, relationshipReportRows, STARTER_REPORTS } from './relationshipAndFindingReports';
import { reportCellHref } from './reportRowLinks';

const system: ElementsHeadRow = { element_id: 'system', element_type: 'system', name: 'Ledger', parent_id: null, attributes: { criticality: 'critical' }, exists_delta_id: 'system-fact' };
const capability: ElementsHeadRow = { element_id: 'capability', element_type: 'capability', name: 'Finance', parent_id: null, attributes: {}, exists_delta_id: 'capability-fact' };
const edge: RelationshipsHeadRow = {
  relationship_id: 'support', relationship_type: 'supports', from_element_id: system.element_id, to_element_id: capability.element_id, attributes: {}, exists_delta_id: 'support-fact',
};
const base = '/o/test/m/model';

describe('relationship and finding reports', () => {
  it('uses valid specs and preserves the exact relationship target through filtering and projection', () => {
    for (const { spec } of STARTER_REPORTS) expect(parseReportSpec(spec).ok).toBe(true);
    const spec = STARTER_REPORTS.find((report) => report.name === 'Capability support')?.spec;
    if (!spec) throw new Error('Capability support report missing');
    const rows = relationshipReportRows([system, capability], [edge, { ...edge, relationship_id: 'other', relationship_type: 'uses' }]);
    const { result, displayedRows } = runReportWithRows(rows, spec);
    expect(result.rows).toEqual([['Ledger', 'supports', 'Finance', null]]);
    expect(reportCellHref(displayedRows[0], 'type', base)).toBe(`${base}/e/system?ref=main#relationship-support`);
    expect(reportCellHref(displayedRows[0], 'to', base)).toBe(`${base}/e/capability?ref=main`);
    expect(JSON.stringify(result)).not.toContain('#relationship');
  });

  it('uses the existing health rule and shows one row per finding and record', () => {
    const elements = [system, capability];
    const findings = computeFindings({ snapshot: { elements, relationships: [edge] }, facts: [], now: new Date('2026-11-11') });
    expect(findings.has('outgoing-no-retiring-change')).toBe(false);
    const flagged = findings.get('critical-no-business-owner') ?? [];
    findings.set('critical-no-business-owner', [...flagged, ...flagged]);
    const rows = findingReportRows(elements, findings);
    const spec = STARTER_REPORTS.find((report) => report.name === 'Critical systems with no business owner')?.spec;
    if (!spec) throw new Error('Missing owner report missing');
    const { result, displayedRows } = runReportWithRows(rows, spec);
    expect(result.rows).toEqual([['Critical systems with no business owner', 'Ledger', 'system', 'critical']]);
    expect(reportCellHref(displayedRows[0], 'name', base)).toBe(`${base}/e/system?ref=main`);
  });
});

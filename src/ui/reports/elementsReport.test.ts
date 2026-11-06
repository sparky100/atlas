import { describe, expect, it } from 'vitest';
import { runReport } from '../../engine/reportQuery';
import type { BrowseRow } from '../../db/elementBrowse';
import type { ElementsHeadRow } from '../../contracts/rows';
import { DEFAULT_ELEMENTS_REPORT_STATE, elementReportRow, elementsStateToSpec, specToElementsState, type ElementsReportState } from './elementsReport';

function el(id: string, name: string, type: ElementsHeadRow['element_type'] = 'system', attributes: ElementsHeadRow['attributes'] = {}): ElementsHeadRow {
  return { element_id: id, element_type: type, name, parent_id: null, attributes, exists_delta_id: `d-${id}` };
}
function row(id: string, name: string, over: Partial<BrowseRow> = {}, type: ElementsHeadRow['element_type'] = 'system', attrs: ElementsHeadRow['attributes'] = {}): BrowseRow {
  return { element: el(id, name, type, attrs), owner: null, lifecycleStatus: null, criticality: null, disposition: null, parent: null, ...over };
}

const rows: BrowseRow[] = [
  row('1', 'Billing', { owner: el('o1', 'Ann', 'actor'), criticality: 'high', lifecycleStatus: 'active', disposition: 'invest' }, 'system', { costCentre: 'A1' }),
  row('2', 'CRM', { criticality: 'low', lifecycleStatus: 'retiring', disposition: 'migrate' }, 'system', { costCentre: 'B2' }),
  row('3', 'Payments', { owner: el('o2', 'Bob', 'actor'), criticality: 'critical' }, 'container'),
  row('4', 'Ledger', {}, 'capability'),
];
const reportRows = rows.map(elementReportRow);

function run(state: ElementsReportState): string[] {
  const made = elementsStateToSpec(state);
  if (!made.ok) throw new Error(made.reason);
  return runReport(reportRows, made.spec, { tiebreakField: 'id' }).rows.map((r) => String(r[0]));
}
const withState = (over: Partial<ElementsReportState>): ElementsReportState => ({ ...DEFAULT_ELEMENTS_REPORT_STATE, ...over });

describe('elements state -> report', () => {
  it('default state lists everything by name', () => {
    expect(run(DEFAULT_ELEMENTS_REPORT_STATE)).toEqual(['Billing', 'CRM', 'Ledger', 'Payments']);
  });
  it('type, disposition and search filters', () => {
    expect(run(withState({ typeFilter: 'system' }))).toEqual(['Billing', 'CRM']);
    expect(run(withState({ dispositionFilter: 'migrate' }))).toEqual(['CRM']);
    expect(run(withState({ dispositionFilter: 'not_assessed' }))).toEqual(['Payments']);
    expect(run(withState({ query: ' ann ' }))).toEqual(['Billing']);
  });
  it('custom attribute equality', () => {
    expect(run(withState({ custom: { key: 'costCentre', value: 'B2' } }))).toEqual(['CRM']);
  });
  it('sorts unset criticality first ascending, and reverses descending', () => {
    expect(run(withState({ sortKey: 'criticality' }))).toEqual(['Ledger', 'CRM', 'Billing', 'Payments']);
    expect(run(withState({ sortKey: 'criticality', sortDirection: 'desc' }))).toEqual(['Payments', 'Billing', 'CRM', 'Ledger']);
  });
  it('sorts unset owner first', () => {
    expect(run(withState({ sortKey: 'owner' }))).toEqual(['CRM', 'Ledger', 'Billing', 'Payments']);
  });
  it('refuses a finding filter and a structured custom value, with a reason', () => {
    expect(elementsStateToSpec(DEFAULT_ELEMENTS_REPORT_STATE, 'unlinked-systems').ok).toBe(false);
    expect(elementsStateToSpec(withState({ custom: { key: 'tags', value: ['a'] } })).ok).toBe(false);
    expect(elementsStateToSpec(withState({ custom: { key: 'owner', value: 'x' } })).ok).toBe(false);
  });
  it('a custom attribute never shadows a built-in field', () => {
    const r = elementReportRow(row('9', 'X', {}, 'system', { owner: 'spoof', costCentre: 'Z' }));
    expect(r.owner).toBeNull();
    expect(r.costCentre).toBe('Z');
  });
});

describe('report -> elements state', () => {
  const states: ElementsReportState[] = [
    DEFAULT_ELEMENTS_REPORT_STATE,
    withState({ typeFilter: 'system', query: 'bill', sortKey: 'lifecycle', sortDirection: 'desc' }),
    withState({ dispositionFilter: 'not_assessed', sortKey: 'disposition' }),
    withState({ dispositionFilter: 'invest', custom: { key: 'costCentre', value: 'A1' }, sortKey: { custom: 'costCentre' } }),
  ];
  it.each(states.map((s, i) => [i, s] as const))('round-trips state %i through JSON', (_i, state) => {
    const made = elementsStateToSpec(state);
    if (!made.ok) throw new Error(made.reason);
    const back = specToElementsState(JSON.parse(JSON.stringify(made.spec)) as typeof made.spec);
    expect(back).toEqual({ ok: true, state });
  });
  it('refuses a spec the page cannot show, whole', () => {
    const made = elementsStateToSpec(DEFAULT_ELEMENTS_REPORT_STATE);
    if (!made.ok) throw new Error('unreachable');
    expect(specToElementsState({ ...made.spec, source: 'portfolio' }).ok).toBe(false);
    expect(specToElementsState({ ...made.spec, groupBy: 'type' }).ok).toBe(false);
    expect(specToElementsState({ ...made.spec, filters: [{ field: 'name', operator: 'gt', value: 'a' }] }).ok).toBe(false);
    expect(specToElementsState({ ...made.spec, filters: [{ field: 'type', operator: 'in', value: ['system', 'container'] }] }).ok).toBe(false);
  });
});

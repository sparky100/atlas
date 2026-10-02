import { describe, expect, it } from 'vitest';
import { EXISTS_ATTRIBUTE } from '../contracts/delta';
import type { ElementsHeadRow, FactsRow, Json } from '../contracts/rows';
import { buildAttestationDeltas } from './attestation';

const system: ElementsHeadRow = { element_id: 'sys', element_type: 'system', name: 'Payroll', parent_id: null, attributes: {}, exists_delta_id: 'exists-sys' };

function fact(attribute: string, value: Json): FactsRow {
  return { subject_type: 'element', subject_id: 'sys', attribute, value, delta_id: `fact-${attribute}`, source_id: 'old-src', source_ref: null, effective_date: '2020-01-01', confidence: 0.6, asserted_by: 'u', asserted_at: '2020-01-01T00:00:00Z' };
}

function ids(): () => string {
  let n = 0;
  return () => `id-${String(++n)}`;
}

describe('buildAttestationDeltas (ADR-025)', () => {
  it('re-asserts every current fact unchanged — same value, superseding it, under the attestation source at confidence 1 — except existence', () => {
    const facts = new Map([
      [EXISTS_ATTRIBUTE, fact(EXISTS_ATTRIBUTE, { type: 'system' })],
      ['name', fact('name', 'Payroll')],
      ['criticality', fact('criticality', 'high')],
      ['costCentre', fact('costCentre', 'CC-42')],
    ]);
    const deltas = buildAttestationDeltas({ element: system, facts, sourceId: 'attest-src', newId: ids() });
    expect(deltas).toEqual([
      // Not a core attribute of a system: an org's custom one.
      { kind: 'element.update_custom', id: 'id-1', elementId: 'sys', elementType: 'system', attribute: 'costCentre', value: 'CC-42', previousDeltaId: 'fact-costCentre', sourceId: 'attest-src', confidence: 1 },
      { kind: 'element.update', id: 'id-2', elementId: 'sys', elementType: 'system', attribute: 'criticality', value: 'high', previousDeltaId: 'fact-criticality', sourceId: 'attest-src', confidence: 1 },
      { kind: 'element.update', id: 'id-3', elementId: 'sys', elementType: 'system', attribute: 'name', value: 'Payroll', previousDeltaId: 'fact-name', sourceId: 'attest-src', confidence: 1 },
    ]);
  });

  it('carries no effectiveDate, so the confirmation\'s own commit time becomes each fact\'s date', () => {
    const [delta] = buildAttestationDeltas({ element: system, facts: new Map([['criticality', fact('criticality', 'low')]]), sourceId: 's', newId: ids() });
    expect(delta && 'effectiveDate' in delta).toBe(false);
  });

  it('confirms nothing when only existence is recorded', () => {
    expect(buildAttestationDeltas({ element: system, facts: new Map([[EXISTS_ATTRIBUTE, fact(EXISTS_ATTRIBUTE, {})]]), sourceId: 's', newId: ids() })).toEqual([]);
  });
});

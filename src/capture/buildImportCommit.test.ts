import { describe, expect, it } from 'vitest';
import type { FactsRow } from '../contracts/rows';
import type { ImportRow } from './importRowSchema';
import type { MatchedImportRow } from './matchImportRows';
import { buildImportDeltas } from './buildImportCommit';

const SOURCE_ID = 'source-1';

function row(overrides: Partial<ImportRow> & { rowNumber: number; name: string }): ImportRow {
  return { id: null, attributes: {}, supportsCapabilityName: null, ...overrides };
}

function fact(deltaId: string, value: string): FactsRow {
  return { subject_type: 'element', subject_id: 'irrelevant', attribute: 'irrelevant', value, delta_id: deltaId, source_id: 'irrelevant', source_ref: null, effective_date: null, confidence: 1, asserted_by: 'irrelevant' } as FactsRow;
}

describe('buildImportDeltas', () => {
  it('creates a new system with the row-provided attributes merged over the schema default', () => {
    const matchedRows: MatchedImportRow[] = [{ row: row({ rowNumber: 2, name: 'Northgate', attributes: { description: 'A revenues platform' } }), match: { kind: 'new' }, supports: { kind: 'none' } }];
    const { deltas, warnings } = buildImportDeltas({ matchedRows, resolutions: new Map(), sourceId: SOURCE_ID, factsByElementId: new Map(), existsDeltaIdByElementId: new Map() });
    expect(warnings).toEqual([]);
    expect(deltas).toHaveLength(1);
    const [create] = deltas;
    expect(create).toMatchObject({ kind: 'element.create', elementType: 'system', name: 'Northgate', parentId: null, sourceId: SOURCE_ID, confidence: 1 });
    if (create?.kind === 'element.create') {
      expect(create.attributes).toMatchObject({ description: 'A revenues platform', isExternal: false });
    }
  });

  it('creates a secondary supports edge (never primary) for a new system with a resolved supports column', () => {
    const matchedRows: MatchedImportRow[] = [{ row: row({ rowNumber: 2, name: 'Northgate', supportsCapabilityName: 'Billing' }), match: { kind: 'new' }, supports: { kind: 'matched', capability: { elementId: 'cap-1', name: 'Billing' } } }];
    const { deltas } = buildImportDeltas({ matchedRows, resolutions: new Map(), sourceId: SOURCE_ID, factsByElementId: new Map(), existsDeltaIdByElementId: new Map() });
    expect(deltas).toHaveLength(2);
    const relationship = deltas.find((d) => d.kind === 'relationship.create');
    expect(relationship).toMatchObject({ kind: 'relationship.create', relationshipType: 'supports', toElementId: 'cap-1', attributes: { role: 'secondary' } });
  });

  it('warns, but still creates the system, when the supports column names a capability that was not found', () => {
    const matchedRows: MatchedImportRow[] = [{ row: row({ rowNumber: 2, name: 'Northgate', supportsCapabilityName: 'Nonexistent' }), match: { kind: 'new' }, supports: { kind: 'unresolved', name: 'Nonexistent' } }];
    const { deltas, warnings } = buildImportDeltas({ matchedRows, resolutions: new Map(), sourceId: SOURCE_ID, factsByElementId: new Map(), existsDeltaIdByElementId: new Map() });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.kind).toBe('element.create');
    expect(warnings).toEqual(['Row 2 ("Northgate"): capability "Nonexistent" was not found — created without a supports link.']);
  });

  it('updates only the attributes a matched row actually changed', () => {
    const matchedRows: MatchedImportRow[] = [
      { row: row({ rowNumber: 2, name: 'Northgate', attributes: { description: 'New description', vendor: 'SameVendor' } }), match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, supports: { kind: 'none' } },
    ];
    const factsByElementId = new Map([['sys-1', new Map([['description', fact('d-desc', 'Old description')], ['vendor', fact('d-vendor', 'SameVendor')]])]]);
    const existsDeltaIdByElementId = new Map([['sys-1', 'd-create']]);
    const { deltas } = buildImportDeltas({ matchedRows, resolutions: new Map(), sourceId: SOURCE_ID, factsByElementId, existsDeltaIdByElementId });
    // Only `description` differs — `vendor` already says "SameVendor", so no delta for it (no no-op updates).
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ kind: 'element.update', elementId: 'sys-1', attribute: 'description', value: 'New description', previousDeltaId: 'd-desc' });
  });

  it("falls back to the element's own exists_delta_id when an attribute has never had its own fact", () => {
    const matchedRows: MatchedImportRow[] = [{ row: row({ rowNumber: 2, name: 'Northgate', attributes: { vendor: 'Acme' } }), match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, supports: { kind: 'none' } }];
    const { deltas } = buildImportDeltas({ matchedRows, resolutions: new Map(), sourceId: SOURCE_ID, factsByElementId: new Map(), existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]) });
    expect(deltas[0]).toMatchObject({ kind: 'element.update', previousDeltaId: 'd-create' });
  });

  it('never emits a supports relationship.create for a matched (existing) system, even when a capability resolved', () => {
    const matchedRows: MatchedImportRow[] = [{ row: row({ rowNumber: 2, name: 'Northgate', supportsCapabilityName: 'Billing' }), match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, supports: { kind: 'matched', capability: { elementId: 'cap-1', name: 'Billing' } } }];
    const { deltas, warnings } = buildImportDeltas({ matchedRows, resolutions: new Map(), sourceId: SOURCE_ID, factsByElementId: new Map(), existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]) });
    expect(deltas.some((d) => d.kind === 'relationship.create')).toBe(false);
    expect(warnings).toEqual(['Row 2 ("Northgate") matched an existing system — its supports link was left unchanged (not re-linked by this import).']);
  });

  it('throws, naming the row, when an ambiguous match has no resolution yet', () => {
    const matchedRows: MatchedImportRow[] = [{ row: row({ rowNumber: 5, name: 'Northgate' }), match: { kind: 'ambiguous', candidates: [{ elementId: 'sys-1', name: 'Northgate' }, { elementId: 'sys-2', name: 'northgate' }] }, supports: { kind: 'none' } }];
    expect(() => buildImportDeltas({ matchedRows, resolutions: new Map(), sourceId: SOURCE_ID, factsByElementId: new Map(), existsDeltaIdByElementId: new Map() })).toThrow(/Row 5/);
  });

  it("honours the reviewer's own resolution for an ambiguous row — 'new'", () => {
    const matchedRows: MatchedImportRow[] = [{ row: row({ rowNumber: 5, name: 'Northgate' }), match: { kind: 'ambiguous', candidates: [{ elementId: 'sys-1', name: 'Northgate' }, { elementId: 'sys-2', name: 'northgate' }] }, supports: { kind: 'none' } }];
    const { deltas } = buildImportDeltas({ matchedRows, resolutions: new Map([[5, 'new']]), sourceId: SOURCE_ID, factsByElementId: new Map(), existsDeltaIdByElementId: new Map() });
    expect(deltas[0]?.kind).toBe('element.create');
  });

  it("honours the reviewer's own resolution for an ambiguous row — a specific existing element", () => {
    const matchedRows: MatchedImportRow[] = [
      { row: row({ rowNumber: 5, name: 'Northgate', attributes: { vendor: 'Acme' } }), match: { kind: 'ambiguous', candidates: [{ elementId: 'sys-1', name: 'Northgate' }, { elementId: 'sys-2', name: 'northgate' }] }, supports: { kind: 'none' } },
    ];
    const { deltas } = buildImportDeltas({ matchedRows, resolutions: new Map([[5, 'sys-2']]), sourceId: SOURCE_ID, factsByElementId: new Map(), existsDeltaIdByElementId: new Map([['sys-2', 'd-create']]) });
    expect(deltas[0]).toMatchObject({ kind: 'element.update', elementId: 'sys-2' });
  });
});

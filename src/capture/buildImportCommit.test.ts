import { describe, expect, it } from 'vitest';
import type { FactsRow } from '../contracts/rows';
import type { ImportRow } from './importRowSchema';
import type { MatchedImportRow, NameResolutionOutcome } from './matchImportRows';
import { buildImportDeltas } from './buildImportCommit';

const SOURCE_ID = 'source-1';
const FILE_NAME = 'systems.csv';

function row(overrides: Partial<ImportRow> & { rowNumber: number; name: string }): ImportRow {
  return { elementType: 'system', attributes: {}, platformName: null, capabilityName: null, businessOwnerName: null, technicalOwnerName: null, ...overrides };
}

function matchedRow(rowInput: ImportRow, overrides: Partial<Omit<MatchedImportRow, 'row'>> = {}): MatchedImportRow {
  const none: NameResolutionOutcome = { kind: 'none' };
  return { row: rowInput, match: { kind: 'new' }, platform: none, capability: none, businessOwner: none, technicalOwner: none, ...overrides };
}

function fact(deltaId: string, value: string): FactsRow {
  return { subject_type: 'element', subject_id: 'irrelevant', attribute: 'irrelevant', value, delta_id: deltaId, source_id: 'irrelevant', source_ref: null, effective_date: null, confidence: 1, asserted_by: 'irrelevant' } as FactsRow;
}

function build(matchedRows: MatchedImportRow[], resolutions: Map<number, string> = new Map<number, string>(), factsByElementId: Map<string, Map<string, FactsRow>> = new Map<string, Map<string, FactsRow>>(), existsDeltaIdByElementId: Map<string, string> = new Map<string, string>()) {
  return buildImportDeltas({ matchedRows, resolutions, fileName: FILE_NAME, sourceId: SOURCE_ID, factsByElementId, existsDeltaIdByElementId });
}

describe('buildImportDeltas — new rows', () => {
  it('creates a new system with the row-provided attributes merged over the schema default, carrying file/row/column provenance', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', attributes: { description: 'A revenues platform' } }))];
    const { rows, deltas } = build(matchedRows);
    expect(rows).toEqual([{ rowNumber: 2, name: 'Northgate', outcome: { status: 'new' }, warnings: [] }]);
    expect(deltas).toHaveLength(1);
    const [create] = deltas;
    expect(create).toMatchObject({ kind: 'element.create', elementType: 'system', name: 'Northgate', parentId: null, sourceId: SOURCE_ID, sourceRef: `${FILE_NAME} › row 2 › row`, confidence: 1 });
    if (create?.kind === 'element.create') expect(create.attributes).toMatchObject({ description: 'A revenues platform', isExternal: false });
  });

  it('creates a module (container) parented to its resolved platform', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'PM', elementType: 'container', platformName: 'SAP' }), { platform: { kind: 'matched', element: { elementId: 'sap-1', name: 'SAP' } } })];
    const { deltas } = build(matchedRows);
    expect(deltas[0]).toMatchObject({ kind: 'element.create', elementType: 'container', parentId: 'sap-1' });
  });

  it('creates a secondary supports edge (never primary) for a new row with a matched capability', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityName: 'Billing' }), { capability: { kind: 'matched', element: { elementId: 'cap-1', name: 'Billing' } } })];
    const { deltas } = build(matchedRows);
    expect(deltas).toHaveLength(2);
    const relationship = deltas.find((d) => d.kind === 'relationship.create');
    expect(relationship).toMatchObject({ kind: 'relationship.create', relationshipType: 'supports', toElementId: 'cap-1', attributes: { role: 'secondary' }, sourceRef: `${FILE_NAME} › row 2 › capability` });
  });

  it('warns, but still creates the row, when the capability column names one that was not found', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityName: 'Nonexistent' }), { capability: { kind: 'new' } })];
    const { rows, deltas } = build(matchedRows);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.kind).toBe('element.create');
    expect(rows[0]?.warnings).toEqual(['capability "Nonexistent" was not found — never created by an import.']);
  });

  it('creates a new actor and an owns edge for an unresolved business_owner, deduplicating one actor across every row/column that names it', () => {
    const matchedRows = [
      matchedRow(row({ rowNumber: 2, name: 'Northgate', businessOwnerName: 'Jane Doe' }), { businessOwner: { kind: 'new' } }),
      matchedRow(row({ rowNumber: 3, name: 'Southgate', businessOwnerName: 'jane doe' }), { businessOwner: { kind: 'new' } }),
    ];
    const { deltas } = build(matchedRows);
    const actorCreates = deltas.filter((d) => d.kind === 'element.create' && d.elementType === 'actor');
    expect(actorCreates).toHaveLength(1);
    expect(actorCreates[0]).toMatchObject({ name: 'Jane Doe', attributes: { subtype: 'person', isExternal: false } });
    const ownsEdges = deltas.filter((d) => d.kind === 'relationship.create' && d.relationshipType === 'owns');
    expect(ownsEdges).toHaveLength(2);
    if (actorCreates[0]?.kind === 'element.create') {
      expect(ownsEdges.every((e) => e.fromElementId === actorCreates[0]?.elementId)).toBe(true);
    }
  });

  it('creates an owns edge to an already-matched actor without creating a new one', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', technicalOwnerName: 'John Smith' }), { technicalOwner: { kind: 'matched', element: { elementId: 'actor-1', name: 'John Smith' } } })];
    const { deltas } = build(matchedRows);
    expect(deltas.filter((d) => d.kind === 'element.create' && d.elementType === 'actor')).toHaveLength(0);
    expect(deltas.find((d) => d.kind === 'relationship.create')).toMatchObject({ relationshipType: 'owns', fromElementId: 'actor-1', attributes: { role: 'technical' } });
  });
});

describe('buildImportDeltas — matched/changed rows', () => {
  it('updates only the attributes a matched row actually changed', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', attributes: { description: 'New description', vendor: 'SameVendor' } }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } } })];
    const factsByElementId = new Map([['sys-1', new Map([['description', fact('d-desc', 'Old description')], ['vendor', fact('d-vendor', 'SameVendor')]])]]);
    const { rows, deltas } = build(matchedRows, new Map(), factsByElementId, new Map([['sys-1', 'd-create']]));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ kind: 'element.update', elementId: 'sys-1', attribute: 'description', value: 'New description', previousDeltaId: 'd-desc', sourceRef: `${FILE_NAME} › row 2 › description` });
    expect(rows[0]?.outcome).toEqual({ status: 'changed', elementId: 'sys-1', changedColumns: ['description'] });
  });

  it('reports unchanged, with zero deltas, when every set column already matches', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', attributes: { vendor: 'SameVendor' } }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } } })];
    const factsByElementId = new Map([['sys-1', new Map([['vendor', fact('d-vendor', 'SameVendor')]])]]);
    const { rows, deltas } = build(matchedRows, new Map(), factsByElementId, new Map([['sys-1', 'd-create']]));
    expect(deltas).toHaveLength(0);
    expect(rows[0]?.outcome).toEqual({ status: 'unchanged', elementId: 'sys-1' });
  });

  it("falls back to the element's own exists_delta_id when an attribute has never had its own fact", () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', attributes: { vendor: 'Acme' } }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } } })];
    const { deltas } = build(matchedRows, new Map(), new Map(), new Map([['sys-1', 'd-create']]));
    expect(deltas[0]).toMatchObject({ kind: 'element.update', previousDeltaId: 'd-create' });
  });

  it('never (re-)links capability/owners for a matched row, even when one resolved', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityName: 'Billing' }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, capability: { kind: 'matched', element: { elementId: 'cap-1', name: 'Billing' } } })];
    const { rows, deltas } = build(matchedRows, new Map(), new Map(), new Map([['sys-1', 'd-create']]));
    expect(deltas.some((d) => d.kind === 'relationship.create')).toBe(false);
    expect(rows[0]?.warnings).toEqual(['matched an existing element — its capability/owner links were left unchanged (not re-linked by this import).']);
  });
});

describe('buildImportDeltas — rows needing a pick, or blocked', () => {
  it('never throws for a row still needing a pick — surfaces it as needs-pick, with zero deltas for that row', () => {
    const candidates = [{ elementId: 'sys-1', name: 'Northgate' }, { elementId: 'sys-2', name: 'northgate' }];
    const matchedRows = [matchedRow(row({ rowNumber: 5, name: 'Northgate' }), { match: { kind: 'undecided', candidates } })];
    const { rows, deltas } = build(matchedRows);
    expect(deltas).toHaveLength(0);
    expect(rows[0]?.outcome).toEqual({ status: 'needs-pick', candidates });
  });

  it("honours the reviewer's own resolution for an undecided row — 'new'", () => {
    const candidates = [{ elementId: 'sys-1', name: 'Northgate' }, { elementId: 'sys-2', name: 'northgate' }];
    const matchedRows = [matchedRow(row({ rowNumber: 5, name: 'Northgate' }), { match: { kind: 'undecided', candidates } })];
    const { deltas } = build(matchedRows, new Map([[5, 'new']]));
    expect(deltas[0]?.kind).toBe('element.create');
  });

  it("honours the reviewer's own resolution for an undecided row — a specific existing element, and aliases the file's own spelling", () => {
    const candidates = [{ elementId: 'sys-1', name: 'Northgate' }, { elementId: 'sys-2', name: 'Northgatte' }];
    const matchedRows = [matchedRow(row({ rowNumber: 5, name: 'Northgate', attributes: { vendor: 'Acme' } }), { match: { kind: 'undecided', candidates } })];
    const { deltas, aliasesToWrite } = build(matchedRows, new Map([[5, 'sys-2']]), new Map(), new Map([['sys-2', 'd-create']]));
    expect(deltas.find((d) => d.kind === 'element.update')).toMatchObject({ elementId: 'sys-2' });
    // Picked "Northgatte" but the file itself says "Northgate" — worth an alias.
    expect(aliasesToWrite).toEqual([{ elementId: 'sys-2', aliasValue: 'Northgate' }]);
  });

  it('does not alias a same-as pick whose own candidate name already matches the file exactly', () => {
    const candidates = [{ elementId: 'sys-1', name: 'Northgate' }, { elementId: 'sys-2', name: 'northgate' }];
    const matchedRows = [matchedRow(row({ rowNumber: 5, name: 'Northgate' }), { match: { kind: 'undecided', candidates } })];
    const { aliasesToWrite } = build(matchedRows, new Map([[5, 'sys-2']]), new Map(), new Map([['sys-2', 'd-create']]));
    expect(aliasesToWrite).toEqual([]);
  });

  it('blocks a module row whose platform never resolved, with zero deltas', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'PM', elementType: 'container', platformName: 'Nonexistent' }), { match: { kind: 'blocked', reason: 'platform "Nonexistent" was not found — a platform is matched, never created by an import' } })];
    const { rows, deltas } = build(matchedRows);
    expect(deltas).toHaveLength(0);
    expect(rows[0]?.outcome).toEqual({ status: 'blocked', reason: 'platform "Nonexistent" was not found — a platform is matched, never created by an import' });
  });
});

describe('buildImportDeltas — touchedElementIds', () => {
  it('includes every non-blocked row’s own resolved element id, plus any newly minted owner actor', () => {
    const matchedRows = [
      matchedRow(row({ rowNumber: 2, name: 'Northgate', businessOwnerName: 'Jane Doe' }), { businessOwner: { kind: 'new' } }),
      matchedRow(row({ rowNumber: 3, name: 'Southgate' }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Southgate' } } }),
    ];
    const { touchedElementIds, deltas } = build(matchedRows, new Map(), new Map(), new Map([['sys-1', 'd-create']]));
    const newRowCreate = deltas.find((d) => d.kind === 'element.create' && d.elementType === 'system');
    const actorCreate = deltas.find((d) => d.kind === 'element.create' && d.elementType === 'actor');
    if (newRowCreate?.kind !== 'element.create' || actorCreate?.kind !== 'element.create') throw new Error('expected both creates to be present');
    expect(new Set(touchedElementIds)).toEqual(new Set([newRowCreate.elementId, actorCreate.elementId, 'sys-1']));
  });

  it('excludes a blocked row entirely', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'PM', elementType: 'container', platformName: 'X' }), { match: { kind: 'blocked', reason: 'not found' } })];
    const { touchedElementIds } = build(matchedRows);
    expect(touchedElementIds).toEqual([]);
  });
});

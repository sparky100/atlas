import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../contracts/rows';
import type { ImportChangeRow } from './importChangeRow';
import type { ImportRelationshipRow } from './importRelationshipRow';
import type { ImportRow } from './importRowSchema';
import type { CurrentSupportsEdge } from './buildImportCommit';
import type { MatchedImportRow, NameResolutionOutcome } from './matchImportRows';
import { buildImportDeltas } from './buildImportCommit';

const SOURCE_ID = 'source-1';
const FILE_NAME = 'systems.csv';

function row(overrides: Partial<ImportRow> & { rowNumber: number; name: string }): ImportRow {
  return { elementType: 'system', attributes: {}, isExternal: undefined, platformName: null, capabilityNames: [], businessOwner: null, technicalOwner: null, ...overrides };
}

function matchedRow(rowInput: ImportRow, overrides: Partial<Omit<MatchedImportRow, 'row'>> = {}): MatchedImportRow {
  const none: NameResolutionOutcome = { kind: 'none' };
  return { row: rowInput, match: { kind: 'new' }, platform: none, capabilities: [], businessOwner: none, technicalOwner: none, ...overrides };
}

function fact(deltaId: string, value: FactsRow['value']): FactsRow {
  return { subject_type: 'element', subject_id: 'irrelevant', attribute: 'irrelevant', value, delta_id: deltaId, source_id: 'irrelevant', source_ref: null, effective_date: null, confidence: 1, asserted_by: 'irrelevant' } as FactsRow;
}

function system(id: string, name: string, attributes: Record<string, unknown> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes, exists_delta_id: `${id}-create` } as ElementsHeadRow;
}

interface BuildOptions {
  resolutions?: Map<number, string>;
  factsByElementId?: Map<string, Map<string, FactsRow>>;
  existsDeltaIdByElementId?: Map<string, string>;
  currentSupportsByElementId?: Map<string, CurrentSupportsEdge[]>;
  relationshipRows?: ImportRelationshipRow[];
  systems?: ElementsHeadRow[];
  containers?: ElementsHeadRow[];
  actors?: ElementsHeadRow[];
  aliasesByElementId?: Map<string, readonly string[]>;
  currentUsesFlowsToEdges?: RelationshipsHeadRow[];
  relationshipFactsByRelationshipId?: Map<string, Map<string, FactsRow>>;
  changeRows?: ImportChangeRow[];
}

function build(matchedRows: MatchedImportRow[], options: BuildOptions = {}) {
  return buildImportDeltas({
    matchedRows,
    resolutions: options.resolutions ?? new Map<number, string>(),
    fileName: FILE_NAME,
    sourceId: SOURCE_ID,
    factsByElementId: options.factsByElementId ?? new Map<string, Map<string, FactsRow>>(),
    existsDeltaIdByElementId: options.existsDeltaIdByElementId ?? new Map<string, string>(),
    currentSupportsByElementId: options.currentSupportsByElementId,
    relationshipRows: options.relationshipRows,
    systems: options.systems,
    containers: options.containers,
    actors: options.actors,
    aliasesByElementId: options.aliasesByElementId,
    currentUsesFlowsToEdges: options.currentUsesFlowsToEdges,
    relationshipFactsByRelationshipId: options.relationshipFactsByRelationshipId,
    changeRows: options.changeRows,
  });
}

function relationshipRow(overrides: Partial<ImportRelationshipRow> & { rowNumber: number }): ImportRelationshipRow {
  return { from: 'A', type: 'uses', to: 'B', description: 'reads from', via: null, dataClassification: null, ...overrides };
}

function changeRow(overrides: Partial<ImportChangeRow> & { rowNumber: number; name: string; action: ImportChangeRow['action'] }): ImportChangeRow {
  return { reason: null, replacedBy: null, ...overrides };
}

function container(id: string, name: string, parentId: string, attributes: Record<string, unknown> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'container', name, parent_id: parentId, attributes, exists_delta_id: `${id}-create` } as ElementsHeadRow;
}

function supportsEdge(overrides: Partial<CurrentSupportsEdge> & { relationshipId: string; capabilityId: string; role: CurrentSupportsEdge['role'] }): CurrentSupportsEdge {
  return { roleDeltaId: 'd-role', existsDeltaId: 'd-exists', ...overrides };
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

  it('sets isExternal on a new row only when the is_external column was actually filled', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Ofgem', isExternal: true }))];
    const { deltas } = build(matchedRows);
    const create = deltas[0];
    if (create?.kind === 'element.create') expect(create.attributes).toMatchObject({ isExternal: true });
  });

  it('creates a primary supports edge for a new row whose capability list has just one name — the first (only) entry is always primary', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Billing'] }), { capabilities: [{ kind: 'matched', element: { elementId: 'cap-1', name: 'Billing' } }] })];
    const { deltas } = build(matchedRows);
    expect(deltas).toHaveLength(2);
    const relationship = deltas.find((d) => d.kind === 'relationship.create');
    expect(relationship).toMatchObject({ kind: 'relationship.create', relationshipType: 'supports', toElementId: 'cap-1', attributes: { role: 'primary' }, sourceRef: `${FILE_NAME} › row 2 › capability` });
  });

  it('creates one primary and the rest secondary for a new row with a "|"-delimited list', () => {
    const matchedRows = [
      matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Billing', 'Customer Accounts'] }), {
        capabilities: [
          { kind: 'matched', element: { elementId: 'cap-1', name: 'Billing' } },
          { kind: 'matched', element: { elementId: 'cap-2', name: 'Customer Accounts' } },
        ],
      }),
    ];
    const { deltas } = build(matchedRows);
    const supports = deltas.filter((d) => d.kind === 'relationship.create' && d.relationshipType === 'supports');
    expect(supports).toEqual([
      expect.objectContaining({ toElementId: 'cap-1', attributes: { role: 'primary' } }),
      expect.objectContaining({ toElementId: 'cap-2', attributes: { role: 'secondary' } }),
    ]);
  });

  it('warns, but still creates the row, when the capability column names one that was not found', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Nonexistent'] }), { capabilities: [{ kind: 'new' }] })];
    const { rows, deltas } = build(matchedRows);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.kind).toBe('element.create');
    expect(rows[0]?.warnings).toEqual(['capability "Nonexistent" was not found — never created by an import.']);
  });

  it('creates a new actor and an owns edge for an unresolved business_owner, deduplicating one actor across every row/column that names it', () => {
    const matchedRows = [
      matchedRow(row({ rowNumber: 2, name: 'Northgate', businessOwner: { name: 'Jane Doe', externalOrganisation: null } }), { businessOwner: { kind: 'new' } }),
      matchedRow(row({ rowNumber: 3, name: 'Southgate', businessOwner: { name: 'jane doe', externalOrganisation: null } }), { businessOwner: { kind: 'new' } }),
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

  it('creates an external organisation actor for "Name (External: Org)"', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', technicalOwner: { name: 'Ofgem', externalOrganisation: 'Energy regulator' } }), { technicalOwner: { kind: 'new' } })];
    const { deltas } = build(matchedRows);
    const actorCreate = deltas.find((d) => d.kind === 'element.create' && d.elementType === 'actor');
    expect(actorCreate).toMatchObject({ name: 'Ofgem', attributes: { subtype: 'organisation', isExternal: true, externalOrganisation: 'Energy regulator' } });
  });

  it('creates an owns edge to an already-matched actor without creating a new one', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', technicalOwner: { name: 'John Smith', externalOrganisation: null } }), { technicalOwner: { kind: 'matched', element: { elementId: 'actor-1', name: 'John Smith' } } })];
    const { deltas } = build(matchedRows);
    expect(deltas.filter((d) => d.kind === 'element.create' && d.elementType === 'actor')).toHaveLength(0);
    expect(deltas.find((d) => d.kind === 'relationship.create')).toMatchObject({ relationshipType: 'owns', fromElementId: 'actor-1', attributes: { role: 'technical' } });
  });
});

describe('buildImportDeltas — matched/changed rows', () => {
  it('updates only the attributes a matched row actually changed', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', attributes: { description: 'New description', vendor: 'SameVendor' } }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } } })];
    const factsByElementId = new Map([['sys-1', new Map([['description', fact('d-desc', 'Old description')], ['vendor', fact('d-vendor', 'SameVendor')]])]]);
    const { rows, deltas } = build(matchedRows, { factsByElementId, existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]) });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ kind: 'element.update', elementId: 'sys-1', attribute: 'description', value: 'New description', previousDeltaId: 'd-desc', sourceRef: `${FILE_NAME} › row 2 › description` });
    expect(rows[0]?.outcome).toEqual({ status: 'changed', elementId: 'sys-1', changedColumns: ['description'] });
  });

  it('reports unchanged, with zero deltas, when every set column already matches', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', attributes: { vendor: 'SameVendor' } }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } } })];
    const factsByElementId = new Map([['sys-1', new Map([['vendor', fact('d-vendor', 'SameVendor')]])]]);
    const { rows, deltas } = build(matchedRows, { factsByElementId, existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]) });
    expect(deltas).toHaveLength(0);
    expect(rows[0]?.outcome).toEqual({ status: 'unchanged', elementId: 'sys-1' });
  });

  it("falls back to the element's own exists_delta_id when an attribute has never had its own fact", () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', attributes: { vendor: 'Acme' } }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } } })];
    const { deltas } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]) });
    expect(deltas[0]).toMatchObject({ kind: 'element.update', previousDeltaId: 'd-create' });
  });

  it('updates isExternal when it changed, falling back to exists_delta_id when never set before', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', isExternal: true }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } } })];
    const { deltas, rows } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]) });
    expect(deltas[0]).toMatchObject({ kind: 'element.update', attribute: 'isExternal', value: true, previousDeltaId: 'd-create' });
    expect(rows[0]?.outcome).toMatchObject({ status: 'changed', changedColumns: ['is_external'] });
  });

  it('uses the resolved element’s own real type, not the row’s own (a bare row can resolve to a module — matchImportRows.ts’s own container cross-check)', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'PM', attributes: { description: 'New description' } }), { match: { kind: 'matched', element: { elementId: 'pm-1', name: 'PM' } } })];
    const containers = [container('pm-1', 'PM', 'sap-1')];
    const { deltas } = build(matchedRows, { containers, existsDeltaIdByElementId: new Map([['pm-1', 'd-create']]) });
    expect(deltas[0]).toMatchObject({ kind: 'element.update', elementId: 'pm-1', elementType: 'container', attribute: 'description', value: 'New description' });
  });

  it('never (re-)links owners for a matched row, even when one resolved', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', technicalOwner: { name: 'John Smith', externalOrganisation: null } }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, technicalOwner: { kind: 'matched', element: { elementId: 'actor-1', name: 'John Smith' } } })];
    const { rows, deltas } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]) });
    expect(deltas.some((d) => d.kind === 'relationship.create')).toBe(false);
    expect(rows[0]?.warnings).toEqual(['matched an existing element — its owner links were left unchanged (not re-linked by this import).']);
  });

  describe('capability diff — a changed primary demotes the previous one', () => {
    it('does nothing when the row’s own resolved capability already matches the current primary', () => {
      const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Billing'] }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, capabilities: [{ kind: 'matched', element: { elementId: 'cap-1', name: 'Billing' } }] })];
      const currentSupportsByElementId = new Map([['sys-1', [supportsEdge({ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' })]]]);
      const { deltas, rows } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]), currentSupportsByElementId });
      expect(deltas.some((d) => d.kind === 'relationship.create' || d.kind === 'relationship.update')).toBe(false);
      expect(rows[0]?.outcome).toEqual({ status: 'unchanged', elementId: 'sys-1' });
    });

    it('creates the new primary and demotes the old one when the row names a different capability', () => {
      const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Payments'] }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, capabilities: [{ kind: 'matched', element: { elementId: 'cap-2', name: 'Payments' } }] })];
      const currentSupportsByElementId = new Map([['sys-1', [supportsEdge({ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' })]]]);
      const { deltas, rows } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]), currentSupportsByElementId });
      expect(deltas).toEqual([
        expect.objectContaining({ kind: 'relationship.update', relationshipId: 'rel-1', attribute: 'role', value: 'secondary', previousDeltaId: 'd-role' }),
        expect.objectContaining({ kind: 'relationship.create', relationshipType: 'supports', fromElementId: 'sys-1', toElementId: 'cap-2', attributes: { role: 'primary' } }),
      ]);
      expect(rows[0]?.outcome).toMatchObject({ status: 'changed', changedColumns: ['capability'] });
    });

    it('adds a second listed capability as secondary without touching the primary, when it is not already linked', () => {
      const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Billing', 'Reporting'] }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, capabilities: [{ kind: 'matched', element: { elementId: 'cap-1', name: 'Billing' } }, { kind: 'matched', element: { elementId: 'cap-3', name: 'Reporting' } }] })];
      const currentSupportsByElementId = new Map([['sys-1', [supportsEdge({ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' })]]]);
      const { deltas } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]), currentSupportsByElementId });
      expect(deltas).toEqual([expect.objectContaining({ kind: 'relationship.create', relationshipType: 'supports', toElementId: 'cap-3', attributes: { role: 'secondary' } })]);
    });

    it('never removes a capability link that is simply absent from the row’s own list', () => {
      const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Billing'] }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, capabilities: [{ kind: 'matched', element: { elementId: 'cap-1', name: 'Billing' } }] })];
      const currentSupportsByElementId = new Map([
        ['sys-1', [
          supportsEdge({ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' }),
          supportsEdge({ relationshipId: 'rel-2', capabilityId: 'cap-9', role: 'secondary', roleDeltaId: 'd-role-2' }),
        ]],
      ]);
      const { deltas } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]), currentSupportsByElementId });
      expect(deltas.some((d) => d.kind === 'relationship.retract')).toBe(false);
      expect(deltas).toHaveLength(0);
    });

    it('leaves capability links entirely alone when the row has no capability column at all', () => {
      const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate' }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } } })];
      const currentSupportsByElementId = new Map([['sys-1', [supportsEdge({ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' })]]]);
      const { deltas } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]), currentSupportsByElementId });
      expect(deltas).toHaveLength(0);
    });
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
    const { deltas } = build(matchedRows, { resolutions: new Map([[5, 'new']]) });
    expect(deltas[0]?.kind).toBe('element.create');
  });

  it("honours the reviewer's own resolution for an undecided row — a specific existing element, and aliases the file's own spelling", () => {
    const candidates = [{ elementId: 'sys-1', name: 'Northgate' }, { elementId: 'sys-2', name: 'Northgatte' }];
    const matchedRows = [matchedRow(row({ rowNumber: 5, name: 'Northgate', attributes: { vendor: 'Acme' } }), { match: { kind: 'undecided', candidates } })];
    const { deltas, aliasesToWrite } = build(matchedRows, { resolutions: new Map([[5, 'sys-2']]), existsDeltaIdByElementId: new Map([['sys-2', 'd-create']]) });
    expect(deltas.find((d) => d.kind === 'element.update')).toMatchObject({ elementId: 'sys-2' });
    // Picked "Northgatte" but the file itself says "Northgate" — worth an alias, staged (not written) here.
    expect(aliasesToWrite).toEqual([{ elementId: 'sys-2', aliasValue: 'Northgate' }]);
  });

  it('does not alias a same-as pick whose own candidate name already matches the file exactly', () => {
    const candidates = [{ elementId: 'sys-1', name: 'Northgate' }, { elementId: 'sys-2', name: 'northgate' }];
    const matchedRows = [matchedRow(row({ rowNumber: 5, name: 'Northgate' }), { match: { kind: 'undecided', candidates } })];
    const { aliasesToWrite } = build(matchedRows, { resolutions: new Map([[5, 'sys-2']]), existsDeltaIdByElementId: new Map([['sys-2', 'd-create']]) });
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
      matchedRow(row({ rowNumber: 2, name: 'Northgate', businessOwner: { name: 'Jane Doe', externalOrganisation: null } }), { businessOwner: { kind: 'new' } }),
      matchedRow(row({ rowNumber: 3, name: 'Southgate' }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Southgate' } } }),
    ];
    const { touchedElementIds, deltas } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]) });
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

describe('buildImportDeltas — Relationships sheet', () => {
  it('creates a uses edge between two rows in the same file, resolved by name after both are minted', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate' })), matchedRow(row({ rowNumber: 3, name: 'Southgate' }))];
    const relationshipRows = [relationshipRow({ rowNumber: 6, from: 'Northgate', to: 'Southgate', type: 'uses', description: 'reads accounts from' })];
    const { deltas, relationshipRows: results } = build(matchedRows, { relationshipRows });
    const edge = deltas.find((d) => d.kind === 'relationship.create' && d.relationshipType === 'uses');
    const northgate = deltas.find((d) => d.kind === 'element.create' && d.name === 'Northgate');
    const southgate = deltas.find((d) => d.kind === 'element.create' && d.name === 'Southgate');
    expect(edge).toMatchObject({ fromElementId: northgate?.kind === 'element.create' ? northgate.elementId : undefined, toElementId: southgate?.kind === 'element.create' ? southgate.elementId : undefined, attributes: { description: 'reads accounts from' } });
    expect(results).toEqual([{ rowNumber: 6, outcome: { status: 'new' } }]);
  });

  it('resolves an endpoint against the existing model by name or alias', () => {
    const systems = [system('sys-1', 'Northgate'), system('sys-2', 'Southgate')];
    const relationshipRows = [relationshipRow({ rowNumber: 6, from: 'Northgate', to: 'Southgate' })];
    const { deltas } = build([], { relationshipRows, systems });
    expect(deltas.find((d) => d.kind === 'relationship.create')).toMatchObject({ fromElementId: 'sys-1', toElementId: 'sys-2' });
  });

  it('resolves a "Platform · Module" compound endpoint to an existing module', () => {
    const systems = [system('sap-1', 'SAP', { kind: 'platform' }), system('other-1', 'Other')];
    const containers = [{ element_id: 'pm-1', element_type: 'container', name: 'PM', parent_id: 'sap-1', attributes: {}, exists_delta_id: 'pm-create' } as ElementsHeadRow];
    const relationshipRows = [relationshipRow({ rowNumber: 6, from: 'Other', to: 'SAP · PM' })];
    const { deltas } = build([], { relationshipRows, systems, containers });
    expect(deltas.find((d) => d.kind === 'relationship.create')).toMatchObject({ toElementId: 'pm-1' });
  });

  it('blocks the row when an endpoint is not found', () => {
    const { relationshipRows: results } = build([], { relationshipRows: [relationshipRow({ rowNumber: 6, from: 'Nonexistent', to: 'AlsoNonexistent' })] });
    expect(results[0]?.outcome).toEqual({ status: 'blocked', reason: '"from" "Nonexistent" was not found' });
  });

  it('resolves via to an integration platform and blocks when it does not resolve to one', () => {
    const systems = [system('sys-1', 'Northgate'), system('sys-2', 'Southgate'), system('esb-1', 'ESB', { kind: 'integration_platform' })];
    const ok = build([], { relationshipRows: [relationshipRow({ rowNumber: 6, from: 'Northgate', to: 'Southgate', type: 'flows_to', via: 'ESB' })], systems });
    expect(ok.deltas.find((d) => d.kind === 'relationship.create')).toMatchObject({ attributes: { via: 'esb-1' } });

    const blocked = build([], { relationshipRows: [relationshipRow({ rowNumber: 6, from: 'Northgate', to: 'Southgate', type: 'flows_to', via: 'Northgate' })], systems });
    expect(blocked.relationshipRows[0]?.outcome).toEqual({ status: 'blocked', reason: '"via" "Northgate" must resolve to an integration platform' });
  });

  it('updates an existing edge’s changed attribute instead of creating a duplicate', () => {
    const systems = [system('sys-1', 'Northgate'), system('sys-2', 'Southgate')];
    const currentUsesFlowsToEdges: RelationshipsHeadRow[] = [{ relationship_id: 'rel-1', relationship_type: 'uses', from_element_id: 'sys-1', to_element_id: 'sys-2', attributes: { description: 'old verb' }, exists_delta_id: 'rel-1-create' }];
    const relationshipFactsByRelationshipId = new Map([['rel-1', new Map([['description', fact('d-verb', 'old verb')]])]]);
    const { deltas, relationshipRows: results } = build([], { relationshipRows: [relationshipRow({ rowNumber: 6, from: 'Northgate', to: 'Southgate', description: 'new verb' })], systems, currentUsesFlowsToEdges, relationshipFactsByRelationshipId });
    expect(deltas).toEqual([expect.objectContaining({ kind: 'relationship.update', relationshipId: 'rel-1', attribute: 'description', value: 'new verb', previousDeltaId: 'd-verb' })]);
    expect(results[0]?.outcome).toEqual({ status: 'changed', changedColumns: ['description'] });
  });

  it('reports unchanged, with zero deltas, when the existing edge already matches', () => {
    const systems = [system('sys-1', 'Northgate'), system('sys-2', 'Southgate')];
    const currentUsesFlowsToEdges: RelationshipsHeadRow[] = [{ relationship_id: 'rel-1', relationship_type: 'uses', from_element_id: 'sys-1', to_element_id: 'sys-2', attributes: { description: 'reads from' }, exists_delta_id: 'rel-1-create' }];
    const relationshipFactsByRelationshipId = new Map([['rel-1', new Map([['description', fact('d-verb', 'reads from')]])]]);
    const { deltas, relationshipRows: results } = build([], { relationshipRows: [relationshipRow({ rowNumber: 6, from: 'Northgate', to: 'Southgate', description: 'reads from' })], systems, currentUsesFlowsToEdges, relationshipFactsByRelationshipId });
    expect(deltas).toHaveLength(0);
    expect(results[0]?.outcome).toEqual({ status: 'unchanged' });
  });
});

describe('buildImportDeltas — JSON import "changes" section', () => {
  it('retires a matched system: sets lifecycleStatus to retired', () => {
    const systems = [system('sys-1', 'Legacy CRM')];
    const factsByElementId = new Map([['sys-1', new Map([['lifecycleStatus', fact('d-lifecycle', 'active')]])]]);
    const { deltas, changeRows: results } = build([], { systems, factsByElementId, existsDeltaIdByElementId: new Map([['sys-1', 'sys-1-create']]), changeRows: [changeRow({ rowNumber: 1, name: 'Legacy CRM', action: 'retire' })] });
    expect(deltas).toEqual([expect.objectContaining({ kind: 'element.update', elementId: 'sys-1', elementType: 'system', attribute: 'lifecycleStatus', value: 'retired', previousDeltaId: 'd-lifecycle' })]);
    expect(results).toEqual([{ rowNumber: 1, name: 'Legacy CRM', action: 'retire', reason: null, outcome: { status: 'applied', elementId: 'sys-1' } }]);
  });

  it('restores a matched module: sets lifecycleStatus back to active', () => {
    const systems = [system('sap-1', 'SAP', { kind: 'platform' })];
    const containers = [container('pm-1', 'PM', 'sap-1')];
    const factsByElementId = new Map([['pm-1', new Map([['lifecycleStatus', fact('d-lifecycle', 'retired')]])]]);
    const { deltas, changeRows: results } = build([], { systems, containers, factsByElementId, existsDeltaIdByElementId: new Map([['pm-1', 'pm-1-create']]), changeRows: [changeRow({ rowNumber: 1, name: 'PM', action: 'restore', reason: 'Brought back into service' })] });
    expect(deltas).toEqual([expect.objectContaining({ kind: 'element.update', elementId: 'pm-1', elementType: 'container', attribute: 'lifecycleStatus', value: 'active', previousDeltaId: 'd-lifecycle' })]);
    expect(results).toEqual([{ rowNumber: 1, name: 'PM', action: 'restore', reason: 'Brought back into service', outcome: { status: 'applied', elementId: 'pm-1' } }]);
  });

  it('reports unchanged, with zero deltas, when the target already has the requested lifecycle status', () => {
    const systems = [system('sys-1', 'Legacy CRM')];
    const factsByElementId = new Map([['sys-1', new Map([['lifecycleStatus', fact('d-lifecycle', 'retired')]])]]);
    const { deltas, changeRows: results } = build([], { systems, factsByElementId, existsDeltaIdByElementId: new Map([['sys-1', 'sys-1-create']]), changeRows: [changeRow({ rowNumber: 1, name: 'Legacy CRM', action: 'retire' })] });
    expect(deltas).toHaveLength(0);
    expect(results[0]?.outcome).toEqual({ status: 'unchanged', elementId: 'sys-1' });
  });

  it('blocks when the name is not found among the model’s current systems/modules', () => {
    const { changeRows: results } = build([], { changeRows: [changeRow({ rowNumber: 1, name: 'Nonexistent', action: 'retire' })] });
    expect(results[0]?.outcome).toEqual({ status: 'blocked', reason: '"Nonexistent" was not found, or matched more than one existing system/module' });
  });

  it('resolves against this same file’s own newly-created row when nothing existing matches — a full-inventory import can create a system only to retire it in the same commit', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Brand New System' }))];
    const { deltas, changeRows: results } = build(matchedRows, { changeRows: [changeRow({ rowNumber: 1, name: 'Brand New System', action: 'retire' })] });
    const create = deltas.find((d) => d.kind === 'element.create');
    if (create?.kind !== 'element.create') throw new Error('expected an element.create delta');
    expect(deltas).toEqual([create, expect.objectContaining({ kind: 'element.update', elementId: create.elementId, attribute: 'lifecycleStatus', value: 'retired', previousDeltaId: create.id })]);
    expect(results[0]?.outcome).toEqual({ status: 'applied', elementId: create.elementId });
  });

  it('still blocks when the name matches nothing at all — neither the model nor this same file', () => {
    const { changeRows: results } = build([], { changeRows: [changeRow({ rowNumber: 1, name: 'Nowhere To Be Found', action: 'retire' })] });
    expect(results[0]?.outcome).toEqual({ status: 'blocked', reason: '"Nowhere To Be Found" was not found, or matched more than one existing system/module' });
  });

  it('prefers a real existing match over a same-file new row of the identical name', () => {
    const systems = [system('sys-1', 'Legacy CRM')];
    const factsByElementId = new Map([['sys-1', new Map([['lifecycleStatus', fact('d-lifecycle', 'active')]])]]);
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Legacy CRM' }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Legacy CRM' } } })];
    const { deltas, changeRows: results } = build(matchedRows, { systems, factsByElementId, existsDeltaIdByElementId: new Map([['sys-1', 'sys-1-create']]), changeRows: [changeRow({ rowNumber: 1, name: 'Legacy CRM', action: 'retire' })] });
    expect(deltas.find((d) => d.kind === 'element.update')).toMatchObject({ elementId: 'sys-1', previousDeltaId: 'd-lifecycle' });
    expect(results[0]?.outcome).toEqual({ status: 'applied', elementId: 'sys-1' });
  });

  it('resolves a "Platform · Module" compound name to a specific platform’s own module', () => {
    const systems = [system('sap-1', 'SAP', { kind: 'platform' }), system('workday-1', 'Workday', { kind: 'platform' })];
    // Two platforms each have their own module named "PM" — a plain "PM" would be ambiguous (two exact matches), so only the compound form disambiguates.
    const containers = [container('sap-pm-1', 'PM', 'sap-1'), container('workday-pm-1', 'PM', 'workday-1')];
    const factsByElementId = new Map([['sap-pm-1', new Map([['lifecycleStatus', fact('d-lifecycle', 'active')]])]]);
    const { deltas, changeRows: results } = build([], { systems, containers, factsByElementId, existsDeltaIdByElementId: new Map([['sap-pm-1', 'sap-pm-1-create'], ['workday-pm-1', 'workday-pm-1-create']]), changeRows: [changeRow({ rowNumber: 1, name: 'SAP · PM', action: 'retire' })] });
    expect(deltas).toEqual([expect.objectContaining({ kind: 'element.update', elementId: 'sap-pm-1', elementType: 'container', attribute: 'lifecycleStatus', value: 'retired' })]);
    expect(results).toEqual([{ rowNumber: 1, name: 'SAP · PM', action: 'retire', reason: null, outcome: { status: 'applied', elementId: 'sap-pm-1' } }]);
  });

  it('blocks a plain module name that exact-matches more than one platform’s own module, same as the ambiguous-without-qualification case', () => {
    const systems = [system('sap-1', 'SAP', { kind: 'platform' }), system('workday-1', 'Workday', { kind: 'platform' })];
    const containers = [container('sap-pm-1', 'PM', 'sap-1'), container('workday-pm-1', 'PM', 'workday-1')];
    const { changeRows: results } = build([], { systems, containers, changeRows: [changeRow({ rowNumber: 1, name: 'PM', action: 'retire' })] });
    expect(results[0]?.outcome).toEqual({ status: 'blocked', reason: '"PM" was not found, or matched more than one existing system/module' });
  });

  it('never targets an actor — lifecycleStatus is a system/module attribute only', () => {
    const actors = [{ element_id: 'actor-1', element_type: 'actor', name: 'Jane Doe', parent_id: null, attributes: {}, exists_delta_id: 'actor-1-create' } as ElementsHeadRow];
    const { changeRows: results } = build([], { actors, changeRows: [changeRow({ rowNumber: 1, name: 'Jane Doe', action: 'retire' })] });
    expect(results[0]?.outcome).toMatchObject({ status: 'blocked' });
  });

  describe('replaced_by — transfers supports edges to the named replacement', () => {
    it('retracts every one of the retiring element’s own supports edges and re-creates them on the replacement, role secondary (never primary, matching useElementRetire.ts)', () => {
      const systems = [system('legacy-1', 'Legacy CRM'), system('electron-1', 'Electron')];
      const factsByElementId = new Map([['legacy-1', new Map([['lifecycleStatus', fact('d-lifecycle', 'active')]])]]);
      const currentSupportsByElementId = new Map([
        ['legacy-1', [
          supportsEdge({ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' }),
          supportsEdge({ relationshipId: 'rel-2', capabilityId: 'cap-2', role: 'secondary', roleDeltaId: 'd-role-2', existsDeltaId: 'd-exists-2' }),
        ]],
      ]);
      const { deltas, changeRows: results } = build([], {
        systems,
        factsByElementId,
        currentSupportsByElementId,
        existsDeltaIdByElementId: new Map([['legacy-1', 'legacy-1-create'], ['electron-1', 'electron-1-create']]),
        changeRows: [changeRow({ rowNumber: 1, name: 'Legacy CRM', action: 'retire', replacedBy: 'Electron' })],
      });
      expect(deltas).toEqual([
        expect.objectContaining({ kind: 'element.update', elementId: 'legacy-1', attribute: 'lifecycleStatus', value: 'retired' }),
        expect.objectContaining({ kind: 'relationship.retract', relationshipId: 'rel-1', previousDeltaId: 'd-exists' }),
        expect.objectContaining({ kind: 'relationship.create', relationshipType: 'supports', fromElementId: 'electron-1', toElementId: 'cap-1', attributes: { role: 'secondary' } }),
        expect.objectContaining({ kind: 'relationship.retract', relationshipId: 'rel-2', previousDeltaId: 'd-exists-2' }),
        expect.objectContaining({ kind: 'relationship.create', relationshipType: 'supports', fromElementId: 'electron-1', toElementId: 'cap-2', attributes: { role: 'secondary' } }),
      ]);
      expect(results).toEqual([{ rowNumber: 1, name: 'Legacy CRM', action: 'retire', reason: null, outcome: { status: 'applied', elementId: 'legacy-1' } }]);
    });

    it('resolves replaced_by against this same file’s own newly-created row too (retiring an existing element in favour of a system this same import is also introducing)', () => {
      const systems = [system('legacy-1', 'Legacy CRM')];
      const factsByElementId = new Map([['legacy-1', new Map([['lifecycleStatus', fact('d-lifecycle', 'active')]])]]);
      const currentSupportsByElementId = new Map([['legacy-1', [supportsEdge({ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' })]]]);
      const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Electron Platform' }))];
      const { deltas, changeRows: results } = build(matchedRows, {
        systems,
        factsByElementId,
        currentSupportsByElementId,
        existsDeltaIdByElementId: new Map([['legacy-1', 'legacy-1-create']]),
        changeRows: [changeRow({ rowNumber: 1, name: 'Legacy CRM', action: 'retire', replacedBy: 'Electron Platform' })],
      });
      const create = deltas.find((d) => d.kind === 'element.create');
      if (create?.kind !== 'element.create') throw new Error('expected an element.create delta');
      expect(deltas.find((d) => d.kind === 'relationship.create' && d.relationshipType === 'supports')).toMatchObject({ fromElementId: create.elementId, toElementId: 'cap-1', attributes: { role: 'secondary' } });
      expect(results[0]?.outcome).toEqual({ status: 'applied', elementId: 'legacy-1' });
    });

    it('leaves a same-batch retiring element’s own newly-created capability link untransferred — nothing is pre-loaded to read for an element that doesn’t exist outside this batch yet', () => {
      const matchedRows = [
        matchedRow(row({ rowNumber: 2, name: 'Piclo', capabilityNames: ['Flexibility Markets'] }), { capabilities: [{ kind: 'matched', element: { elementId: 'cap-1', name: 'Flexibility Markets' } }] }),
        matchedRow(row({ rowNumber: 3, name: 'Electron Platform' })),
      ];
      const { deltas, changeRows: results } = build(matchedRows, { changeRows: [changeRow({ rowNumber: 1, name: 'Piclo', action: 'retire', replacedBy: 'Electron Platform' })] });
      const piclo = deltas.find((d) => d.kind === 'element.create' && d.name === 'Piclo');
      if (piclo?.kind !== 'element.create') throw new Error('expected Piclo’s own element.create delta');
      // Piclo's own capability link lands on Piclo itself (its own row said so) — never transferred, since there's no pre-existing edge for the changes pass to find and move.
      expect(deltas.find((d) => d.kind === 'relationship.create' && d.relationshipType === 'supports')).toMatchObject({ fromElementId: piclo.elementId, toElementId: 'cap-1' });
      expect(deltas.some((d) => d.kind === 'relationship.retract')).toBe(false);
      expect(results[0]?.outcome).toMatchObject({ status: 'applied' });
    });

    it('resolves replaced_by by "Platform · Module" the same as name itself', () => {
      const systems = [system('legacy-1', 'Legacy CRM'), system('sap-1', 'SAP', { kind: 'platform' })];
      const containers = [container('sap-pm-1', 'PM', 'sap-1')];
      const currentSupportsByElementId = new Map([['legacy-1', [supportsEdge({ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' })]]]);
      const { deltas } = build([], { systems, containers, currentSupportsByElementId, existsDeltaIdByElementId: new Map([['legacy-1', 'legacy-1-create'], ['sap-pm-1', 'sap-pm-1-create']]), changeRows: [changeRow({ rowNumber: 1, name: 'Legacy CRM', action: 'retire', replacedBy: 'SAP · PM' })] });
      expect(deltas.find((d) => d.kind === 'relationship.create')).toMatchObject({ fromElementId: 'sap-pm-1' });
    });

    it('blocks the whole row when replaced_by is given but does not resolve', () => {
      const systems = [system('legacy-1', 'Legacy CRM')];
      const { changeRows: results } = build([], { systems, existsDeltaIdByElementId: new Map([['legacy-1', 'legacy-1-create']]), changeRows: [changeRow({ rowNumber: 1, name: 'Legacy CRM', action: 'retire', replacedBy: 'Nonexistent' })] });
      expect(results[0]?.outcome).toEqual({ status: 'blocked', reason: '"replaced_by" "Nonexistent" was not found, or matched more than one existing system/module' });
    });

    it('is applied (not unchanged) when only the replacement transfer produces deltas, even though lifecycleStatus was already retired', () => {
      const systems = [system('legacy-1', 'Legacy CRM'), system('electron-1', 'Electron')];
      const factsByElementId = new Map([['legacy-1', new Map([['lifecycleStatus', fact('d-lifecycle', 'retired')]])]]);
      const currentSupportsByElementId = new Map([['legacy-1', [supportsEdge({ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' })]]]);
      const { deltas, changeRows: results } = build([], { systems, factsByElementId, currentSupportsByElementId, existsDeltaIdByElementId: new Map([['legacy-1', 'legacy-1-create'], ['electron-1', 'electron-1-create']]), changeRows: [changeRow({ rowNumber: 1, name: 'Legacy CRM', action: 'retire', replacedBy: 'Electron' })] });
      expect(deltas.some((d) => d.kind === 'element.update')).toBe(false);
      expect(deltas.some((d) => d.kind === 'relationship.retract')).toBe(true);
      expect(results[0]?.outcome).toEqual({ status: 'applied', elementId: 'legacy-1' });
    });
  });
});

describe('buildImportDeltas — JSON import per-entry quote/confidence provenance', () => {
  it('overrides the otherwise-hardcoded confidence and appends the quote to sourceRef, on a new system row', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', quote: 'Northgate handles all revenue billing', confidence: 0.8 }))];
    const { deltas } = build(matchedRows);
    expect(deltas[0]).toMatchObject({ confidence: 0.8, sourceRef: `${FILE_NAME} › row 2 › row — "Northgate handles all revenue billing"` });
  });

  it('defaults to confidence 1 and a plain sourceRef when quote/confidence are omitted, unchanged from before they existed', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate' }))];
    const { deltas } = build(matchedRows);
    expect(deltas[0]).toMatchObject({ confidence: 1, sourceRef: `${FILE_NAME} › row 2 › row` });
  });

  it('carries confidence/quote onto a relationship row’s own delta', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate' })), matchedRow(row({ rowNumber: 3, name: 'Southgate' }))];
    const relationshipRows = [relationshipRow({ rowNumber: 6, from: 'Northgate', to: 'Southgate', quote: 'Northgate reads balances from Southgate', confidence: 0.65 })];
    const { deltas } = build(matchedRows, { relationshipRows });
    expect(deltas.find((d) => d.kind === 'relationship.create' && d.relationshipType === 'uses')).toMatchObject({ confidence: 0.65, sourceRef: `${FILE_NAME} › row 6 › row — "Northgate reads balances from Southgate"` });
  });

  it('carries confidence/quote onto a changes row’s own delta', () => {
    const systems = [system('sys-1', 'Legacy CRM')];
    const factsByElementId = new Map([['sys-1', new Map([['lifecycleStatus', fact('d-lifecycle', 'active')]])]]);
    const { deltas } = build([], { systems, factsByElementId, existsDeltaIdByElementId: new Map([['sys-1', 'sys-1-create']]), changeRows: [changeRow({ rowNumber: 1, name: 'Legacy CRM', action: 'retire', quote: 'CRM was decommissioned in March', confidence: 0.9 })] });
    expect(deltas[0]).toMatchObject({ confidence: 0.9, sourceRef: `${FILE_NAME} › row 1 › retire — "CRM was decommissioned in March"` });
  });

  it('carries confidence/quote from the mentioning row onto the new actor this import mints for an unresolved owner', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', businessOwner: { name: 'Jane Doe', externalOrganisation: null }, quote: 'Jane Doe owns Northgate', confidence: 0.7 }), { businessOwner: { kind: 'new' } })];
    const { deltas } = build(matchedRows);
    const actorCreate = deltas.find((d) => d.kind === 'element.create' && d.elementType === 'actor');
    expect(actorCreate).toMatchObject({ confidence: 0.7, sourceRef: `${FILE_NAME} › row 2 › business_owner — "Jane Doe owns Northgate"` });
  });
});

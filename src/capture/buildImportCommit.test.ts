import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../contracts/rows';
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
  });
}

function relationshipRow(overrides: Partial<ImportRelationshipRow> & { rowNumber: number }): ImportRelationshipRow {
  return { from: 'A', type: 'uses', to: 'B', description: 'reads from', via: null, dataClassification: null, ...overrides };
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

  it('never (re-)links owners for a matched row, even when one resolved', () => {
    const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', technicalOwner: { name: 'John Smith', externalOrganisation: null } }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, technicalOwner: { kind: 'matched', element: { elementId: 'actor-1', name: 'John Smith' } } })];
    const { rows, deltas } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]) });
    expect(deltas.some((d) => d.kind === 'relationship.create')).toBe(false);
    expect(rows[0]?.warnings).toEqual(['matched an existing element — its owner links were left unchanged (not re-linked by this import).']);
  });

  describe('capability diff — a changed primary demotes the previous one', () => {
    it('does nothing when the row’s own resolved capability already matches the current primary', () => {
      const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Billing'] }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, capabilities: [{ kind: 'matched', element: { elementId: 'cap-1', name: 'Billing' } }] })];
      const currentSupportsByElementId = new Map([['sys-1', [{ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' as const, roleDeltaId: 'd-role' }]]]);
      const { deltas, rows } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]), currentSupportsByElementId });
      expect(deltas.some((d) => d.kind === 'relationship.create' || d.kind === 'relationship.update')).toBe(false);
      expect(rows[0]?.outcome).toEqual({ status: 'unchanged', elementId: 'sys-1' });
    });

    it('creates the new primary and demotes the old one when the row names a different capability', () => {
      const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Payments'] }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, capabilities: [{ kind: 'matched', element: { elementId: 'cap-2', name: 'Payments' } }] })];
      const currentSupportsByElementId = new Map([['sys-1', [{ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' as const, roleDeltaId: 'd-role' }]]]);
      const { deltas, rows } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]), currentSupportsByElementId });
      expect(deltas).toEqual([
        expect.objectContaining({ kind: 'relationship.update', relationshipId: 'rel-1', attribute: 'role', value: 'secondary', previousDeltaId: 'd-role' }),
        expect.objectContaining({ kind: 'relationship.create', relationshipType: 'supports', fromElementId: 'sys-1', toElementId: 'cap-2', attributes: { role: 'primary' } }),
      ]);
      expect(rows[0]?.outcome).toMatchObject({ status: 'changed', changedColumns: ['capability'] });
    });

    it('adds a second listed capability as secondary without touching the primary, when it is not already linked', () => {
      const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Billing', 'Reporting'] }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, capabilities: [{ kind: 'matched', element: { elementId: 'cap-1', name: 'Billing' } }, { kind: 'matched', element: { elementId: 'cap-3', name: 'Reporting' } }] })];
      const currentSupportsByElementId = new Map([['sys-1', [{ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' as const, roleDeltaId: 'd-role' }]]]);
      const { deltas } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]), currentSupportsByElementId });
      expect(deltas).toEqual([expect.objectContaining({ kind: 'relationship.create', relationshipType: 'supports', toElementId: 'cap-3', attributes: { role: 'secondary' } })]);
    });

    it('never removes a capability link that is simply absent from the row’s own list', () => {
      const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Billing'] }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } }, capabilities: [{ kind: 'matched', element: { elementId: 'cap-1', name: 'Billing' } }] })];
      const currentSupportsByElementId = new Map([
        ['sys-1', [
          { relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' as const, roleDeltaId: 'd-role' },
          { relationshipId: 'rel-2', capabilityId: 'cap-9', role: 'secondary' as const, roleDeltaId: 'd-role-2' },
        ]],
      ]);
      const { deltas } = build(matchedRows, { existsDeltaIdByElementId: new Map([['sys-1', 'd-create']]), currentSupportsByElementId });
      expect(deltas.some((d) => d.kind === 'relationship.retract')).toBe(false);
      expect(deltas).toHaveLength(0);
    });

    it('leaves capability links entirely alone when the row has no capability column at all', () => {
      const matchedRows = [matchedRow(row({ rowNumber: 2, name: 'Northgate' }), { match: { kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } } })];
      const currentSupportsByElementId = new Map([['sys-1', [{ relationshipId: 'rel-1', capabilityId: 'cap-1', role: 'primary' as const, roleDeltaId: 'd-role' }]]]);
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

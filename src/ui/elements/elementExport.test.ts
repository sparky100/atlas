import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, FactsRow, Json, RelationshipsHeadRow } from '../../contracts/rows';
import type { AttributeDefinitionRow, SourceRow } from '../../db/types';
import type { BrowseRow } from '../../db/elementBrowse';
import {
  buildExportSheets,
  buildProvenanceById,
  coreColumnsForType,
  customColumnsForType,
  elementBrowseRowsToCsv,
  flatColumns,
  relationshipExportRows,
  sanitizeForFilename,
} from './elementExport';

function element(id: string, type: ElementsHeadRow['element_type'], attributes: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: type, name: id, parent_id: null, attributes, exists_delta_id: `d-${id}` };
}

function row(element: ElementsHeadRow, owner: ElementsHeadRow | null = null): BrowseRow {
  return { element, owner, lifecycleStatus: null, criticality: null, disposition: null, parent: null };
}

function definition(key: string, label: string, appliesTo: ElementsHeadRow['element_type'][]): AttributeDefinitionRow {
  return { id: `def-${key}`, org_id: 'org', key, label, kind: 'text', options: null, applies_to: appliesTo, required: false, description: null, order_index: 0, deprecated_at: null, created_by: 'u', created_at: 'now' };
}

const NOW = new Date('2026-06-15T00:00:00Z');

describe('elementExport columns', () => {
  it('core columns for a type come from the schema in order, hidden fields excluded', () => {
    const systemColumns = coreColumnsForType('system');
    expect(systemColumns.map((c) => c.key)).toContain('lifecycleStatus');
    expect(systemColumns.map((c) => c.key)).toContain('vendor');
    expect(systemColumns.every((c) => c.key !== 'memberId')).toBe(true);
  });

  it('custom columns are non-deprecated definitions applying to the type, ordered by order_index', () => {
    const a = definition('a', 'A', ['system']);
    const b = { ...definition('b', 'B', ['system']), order_index: 1, deprecated_at: 'now' };
    const c = definition('c', 'C', ['capability']);
    expect(customColumnsForType('system', [a, b, c]).map((d) => d.key)).toEqual(['a']);
  });

  it('flat columns are fixed, then union core, then union custom, then provenance', () => {
    const columns = flatColumns([definition('flag', 'Flag', ['system'])]);
    const keys = columns.map((c) => c.key);
    expect(keys.slice(0, 4)).toEqual(['name', 'type', 'owner', 'parent']);
    expect(keys.slice(-3)).toEqual(['source', 'age', 'atlasId']);
    expect(keys).toContain('flag');
    expect(keys).toContain('lifecycleStatus');
  });
});

describe('buildProvenanceById', () => {
  it('maps each element\'s $exists fact to its source name and age', () => {
    const facts: FactsRow[] = [
      { subject_type: 'element', subject_id: 's-1', attribute: '$exists', value: null, delta_id: 'd1', source_id: 'src-1', source_ref: null, effective_date: '2026-01-15', confidence: 1, asserted_by: 'u', asserted_at: '2026-01-15T00:00:00Z' },
      { subject_type: 'element', subject_id: 's-1', attribute: 'vendor', value: 'V', delta_id: 'd2', source_id: 'src-1', source_ref: null, effective_date: null, confidence: 1, asserted_by: 'u', asserted_at: '2026-01-15T00:00:00Z' },
    ];
    const sources = new Map<string, SourceRow>([['src-1', { id: 'src-1', org_id: 'o', model_id: 'm', kind: 'spreadsheet', name: 'Register.xlsx', uri: null, captured_at: null, capture_job_id: null, capability_map_id: null, user_id: null, created_by: 'u', created_at: 'now', import_touched_element_ids: [], pending_aliases: [] }]]);
    const provenance = buildProvenanceById(facts, sources, NOW);
    expect(provenance.get('s-1')?.sourceName).toBe('Register.xlsx');
    expect(provenance.get('s-1')?.age).toBe('5mo');
  });
});

describe('relationshipExportRows', () => {
  it('reads verb from description and role from attributes.role', () => {
    const edges: RelationshipsHeadRow[] = [
      { relationship_id: 'r1', relationship_type: 'uses', from_element_id: 'a', to_element_id: 'b', attributes: { description: 'reads from' }, exists_delta_id: 'd' },
      { relationship_id: 'r2', relationship_type: 'supports', from_element_id: 'a', to_element_id: 'c', attributes: { role: 'primary' }, exists_delta_id: 'd' },
    ];
    const elementsById = new Map<string, ElementsHeadRow>([['a', element('a', 'system')], ['b', element('b', 'system')], ['c', element('c', 'capability')]]);
    const rows = relationshipExportRows(edges, elementsById);
    expect(rows[0]).toEqual({ from: 'a', type: 'uses', to: 'b', verb: 'reads from', role: '' });
    expect(rows[1]).toEqual({ from: 'a', type: 'supports', to: 'c', verb: '', role: 'primary' });
  });
});

describe('elementBrowseRowsToCsv', () => {
  it('emits a header and one row per element with provenance', () => {
    const rows = [row(element('s-1', 'system', { lifecycleStatus: 'active', isExternal: false, vendor: 'V' }))];
    const provenance = new Map([['s-1', { sourceName: 'Register.xlsx', age: '5mo' }]]);
    const csv = elementBrowseRowsToCsv(rows, [definition('flag', 'Flag', ['system'])], provenance);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Name,Type,Owner');
    expect(lines[0]).toContain('Source');
    expect(lines[0]).toContain('Age');
    expect(lines[1]).toContain('s-1');
    expect(lines[1]).toContain('Register.xlsx');
  });
});

describe('buildExportSheets', () => {
  it('makes one sheet per element type present plus a Relationships sheet', () => {
    const rows = [row(element('s-1', 'system', { isExternal: false, lifecycleStatus: 'active' })), row(element('c-1', 'capability'))];
    const sheets = buildExportSheets(rows, [], new Map(), [{ from: 's-1', type: 'supports', to: 'c-1', verb: '', role: 'primary' }]);
    expect(sheets.map((s) => s.name)).toEqual(['Capabilities', 'Systems', 'Relationships']);
    const systems = sheets.find((s) => s.name === 'Systems');
    expect(systems?.cells[0]).toContain('Lifecycle');
    const relationships = sheets.find((s) => s.name === 'Relationships');
    expect(relationships?.cells[0]).toEqual(['From', 'Type', 'To', 'Verb', 'Role']);
  });
});

describe('the round-trip columns (parent, Atlas ID, Actor type)', () => {
  const platform = element('SAP', 'system', { kind: 'platform', isExternal: false });
  const mod = { ...element('PM', 'container', { isExternal: false }), parent_id: 'SAP' };
  const topCap = element('Customer', 'capability');
  const subCap = { ...element('Connections', 'capability'), parent_id: 'Customer' };
  const actor = element('Network Team', 'actor', { subtype: 'team', isExternal: false });
  const names = new Map([['SAP', 'SAP'], ['Customer', 'Customer']]);
  const rows = [row(platform), row(mod), row(topCap), row(subCap), row(actor)];

  it('a module sheet carries "Parent system", a capability sheet "Parent capability", each after Owner, with the parent\'s name and a blank for a top-level element', () => {
    const sheets = buildExportSheets(rows, [], new Map(), [], names);
    const containers = sheets.find((s) => s.name === 'Containers');
    expect(containers?.cells[0]?.slice(0, 4)).toEqual(['Name', 'Type', 'Owner', 'Parent system']);
    expect(containers?.cells[1]?.slice(0, 4)).toEqual(['PM', 'container', '', 'SAP']);
    const capabilities = sheets.find((s) => s.name === 'Capabilities');
    expect(capabilities?.cells[0]?.slice(0, 4)).toEqual(['Name', 'Type', 'Owner', 'Parent capability']);
    expect(capabilities?.cells.slice(1).map((r) => [r[0], r[3]])).toEqual([['Customer', ''], ['Connections', 'Customer']]);
    // A system has no parent column at all.
    expect(sheets.find((s) => s.name === 'Systems')?.cells[0]).not.toContain('Parent system');
  });

  it('every sheet ends with an Atlas ID column holding the element id', () => {
    const sheets = buildExportSheets(rows, [], new Map(), [], names);
    for (const sheet of sheets.filter((s) => s.name !== 'Relationships')) {
      expect(sheet.cells[0]?.[sheet.cells[0].length - 1]).toBe('Atlas ID');
    }
    expect(sheets.find((s) => s.name === 'Containers')?.cells[1]?.slice(-1)).toEqual(['PM']);
  });

  it("an actor's person/team column is \"Actor type\", so the sheet has one column called Type", () => {
    const actors = buildExportSheets(rows, [], new Map(), [], names).find((s) => s.name === 'Actors');
    const header = actors?.cells[0] ?? [];
    expect(header.filter((h) => h === 'Type')).toHaveLength(1);
    expect(header).toContain('Actor type');
  });

  it('a system\'s domain is "IT/OT domain" — the importer would read a "Domain" header as a capability list', () => {
    const systems = buildExportSheets([row(platform)], [], new Map(), [], names).find((s) => s.name === 'Systems');
    expect(systems?.cells[0]).toContain('IT/OT domain');
    expect(systems?.cells[0]).not.toContain('Domain');
  });

  it('the flat CSV has a single "Parent" column and an Atlas ID last', () => {
    const csv = elementBrowseRowsToCsv(rows, [], new Map(), names);
    const [header, ...lines] = csv.split('\r\n');
    const columns = (header ?? '').split(',');
    expect(columns[3]).toBe('Parent');
    expect(columns[columns.length - 1]).toBe('Atlas ID');
    expect(lines.find((l) => l.startsWith('PM,'))?.split(',')[3]).toBe('SAP');
  });

  it('a parent that is not among the exported rows is still named — the lookup is every element, not the visible set', () => {
    const csv = elementBrowseRowsToCsv([row(mod)], [], new Map(), names);
    expect(csv.split('\r\n')[1]?.split(',')[3]).toBe('SAP');
  });
});

describe('relationshipExportRows endpoint names', () => {
  it('names an endpoint plainly, but qualifies two same-named modules by their platform', () => {
    const sap = element('SAP', 'system');
    const other = element('Other', 'system');
    const sapPm = { ...element('PM', 'container'), element_id: 'sap-pm', parent_id: 'SAP' };
    const otherPm = { ...element('PM', 'container'), element_id: 'other-pm', parent_id: 'Other' };
    const escoms = element('ESCOMS', 'container');
    const elementsById = new Map<string, ElementsHeadRow>([sap, other, sapPm, otherPm, escoms].map((e) => [e.element_id, e]));
    const edges = [
      { relationship_id: 'r1', relationship_type: 'uses', from_element_id: 'ESCOMS', to_element_id: 'sap-pm', attributes: { description: 'reads' }, exists_delta_id: 'd' },
      { relationship_id: 'r2', relationship_type: 'uses', from_element_id: 'ESCOMS', to_element_id: 'other-pm', attributes: { description: 'reads' }, exists_delta_id: 'd' },
    ] as RelationshipsHeadRow[];
    expect(relationshipExportRows(edges, elementsById).map((r) => [r.from, r.to])).toEqual([['ESCOMS', 'SAP · PM'], ['ESCOMS', 'Other · PM']]);
  });
});

describe('sanitizeForFilename', () => {
  it('replaces path-hostile characters and never returns empty', () => {
    expect(sanitizeForFilename('a/b\\c:d')).toBe('a-b-c-d');
    expect(sanitizeForFilename('   ')).toBe('export');
  });
});

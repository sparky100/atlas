/**
 * The export → import round trip (2026-10-08): this product's own `.xlsx`
 * export (`buildExportSheets`) written out and read back by the real capture
 * importer (`runCapture`) into an empty model. Before the round-trip fixes a
 * re-import created every module with no platform, dropped every `supports`
 * and `uses`/`flows_to` row (the importer wanted a `description` column the
 * export called "Verb", and never read `supports`), read the Actors sheet as
 * systems, and merged similarly named capabilities into one.
 *
 * The importer is given no model at all (CLAUDE.md rule 7: nothing here fakes
 * one): every header the export writes is a recognised synonym, so reading
 * the export back must never need prompt A — it throws if asked.
 */
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import type { BrowseRow } from '../db/elementBrowse';
import { emptyHead } from '../engine/deltas';
import { buildExportSheets, relationshipExportRows } from '../ui/elements/elementExport';
import { buildMatchIndex } from './matchIndex';
import { runCapture, type ResolvedCandidate } from './runCapture';

function el(id: string, type: ElementsHeadRow['element_type'], name: string, parentId: string | null = null, attributes: ElementsHeadRow['attributes'] = {}): ElementsHeadRow {
  return { element_id: id, element_type: type, name, parent_id: parentId, attributes, exists_delta_id: `d-${id}` };
}
function edge(id: string, type: string, from: string, to: string, attributes: Record<string, string> = {}): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: type, from_element_id: from, to_element_id: to, attributes, exists_delta_id: `d-${id}` } as RelationshipsHeadRow;
}

// Two platforms each with a module called "PM" — a bare "PM" is ambiguous.
const sys = { isExternal: false, lifecycleStatus: 'active' };
const ELEMENTS: ElementsHeadRow[] = [
  el('00000000-0000-4000-8000-000000000001', 'system', 'SAP', null, { ...sys, kind: 'platform' }),
  el('00000000-0000-4000-8000-000000000002', 'system', 'Salesforce', null, { ...sys, kind: 'platform' }),
  el('00000000-0000-4000-8000-000000000003', 'system', 'Aurora', null, sys),
  el('00000000-0000-4000-8000-000000000011', 'container', 'PM', '00000000-0000-4000-8000-000000000001', { isExternal: false }),
  el('00000000-0000-4000-8000-000000000012', 'container', 'PM', '00000000-0000-4000-8000-000000000002', { isExternal: false }),
  el('00000000-0000-4000-8000-000000000013', 'container', 'ESCOMS', '00000000-0000-4000-8000-000000000002', { isExternal: false }),
  // A capability tree three levels deep. Sorted by name, a child comes before its parent ("Connection Quotations" < "Customer").
  el('00000000-0000-4000-8000-000000000021', 'capability', 'Customer'),
  el('00000000-0000-4000-8000-000000000022', 'capability', 'Connection Quotations', '00000000-0000-4000-8000-000000000021'),
  el('00000000-0000-4000-8000-000000000023', 'capability', 'Connections', '00000000-0000-4000-8000-000000000021'),
  el('00000000-0000-4000-8000-000000000024', 'capability', 'Quotation Pricing', '00000000-0000-4000-8000-000000000022'),
  el('00000000-0000-4000-8000-000000000025', 'capability', 'Land, Wayleaves & Consents'),
  el('00000000-0000-4000-8000-000000000031', 'actor', 'Network Team', null, { subtype: 'team', isExternal: false }),
];
const EDGES: RelationshipsHeadRow[] = [
  edge('r1', 'supports', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000025', { role: 'primary' }),
  edge('r2', 'supports', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000023', { role: 'secondary' }),
  edge('r3', 'uses', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000011', { description: 'reads work orders from' }),
  edge('r4', 'flows_to', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000003', { description: 'sends incidents to' }),
  edge('r5', 'owns', '00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000003', { role: 'business' }),
];

function exportAsXlsxBytes(): ArrayBuffer {
  const elementsById = new Map(ELEMENTS.map((e) => [e.element_id, e]));
  const rows: BrowseRow[] = [...ELEMENTS].sort((a, b) => a.name.localeCompare(b.name)).map((element) => ({ element, owner: null, lifecycleStatus: null, criticality: null, disposition: null, parent: null }));
  const sheets = buildExportSheets(rows, [], new Map(), relationshipExportRows(EDGES, elementsById), new Map(ELEMENTS.map((e) => [e.element_id, e.name])));
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.cells), sheet.name);
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

/** Importing this product's own export needs no model: every header it writes is in the synonym table, so prompt A is never asked — and nothing here supplies one. */
const llm = {
  complete: (): Promise<never> => {
    throw new Error("the importer asked the model for help reading its own export — a header the export writes isn't in the synonym table");
  },
};

async function reimport(): Promise<{ candidates: ResolvedCandidate[]; stats: Record<string, number> }> {
  let n = 0;
  const result = await runCapture({
    inputName: 'export.xlsx',
    source: { format: 'xlsx', bytes: exportAsXlsxBytes() },
    documentDate: null,
    llmClient: llm,
    matchIndex: buildMatchIndex([], []),
    mainHead: emptyHead(),
    mintId: () => `id-${String(n++)}`,
  });
  if (result.status !== 'parsed') throw new Error(`import did not parse: ${JSON.stringify(result)}`);
  return { candidates: result.candidates, stats: result.stats };
}

const nameOf = (c: ResolvedCandidate) => (c.proposal.kind === 'element' ? c.proposal.name : '');

describe('exporting a model and importing it into an empty one', () => {
  it('creates every element as its own type — actors are actors, not systems — and merges none of the alike-named capabilities', async () => {
    const { candidates } = await reimport();
    const byType = (type: string) => candidates.filter((c) => c.kind === 'element' && c.elementType === type).map(nameOf).sort();
    expect(byType('system')).toEqual(['Aurora', 'SAP', 'Salesforce']);
    expect(byType('container')).toEqual(['ESCOMS', 'PM', 'PM']);
    expect(byType('actor')).toEqual(['Network Team']);
    expect(byType('capability')).toEqual(['Connection Quotations', 'Connections', 'Customer', 'Land, Wayleaves & Consents', 'Quotation Pricing']);
    expect(candidates.filter((c) => c.kind === 'element').every((c) => c.class === 'new')).toBe(true);
  });

  it('puts each module under its own platform, including two modules with the same name', async () => {
    const { candidates } = await reimport();
    const idOf = (name: string) => candidates.find((c) => c.kind === 'element' && nameOf(c) === name && c.elementType === 'system')?.draftSubjectId;
    const parents = candidates
      .filter((c) => c.kind === 'element' && c.elementType === 'container')
      .map((c) => [nameOf(c), c.proposal.kind === 'element' && c.proposal.parent?.kind === 'existing' ? c.proposal.parent.elementId : null] as const);
    expect(parents.filter(([, parent]) => parent === null)).toEqual([]);
    expect(parents.filter(([name]) => name === 'PM').map(([, parent]) => parent).sort()).toEqual([idOf('SAP'), idOf('Salesforce')].sort());
    expect(parents.find(([name]) => name === 'ESCOMS')?.[1]).toBe(idOf('Salesforce'));
  });

  it('rebuilds the capability tree even though the sheet lists a child before its parent', async () => {
    const { candidates } = await reimport();
    const capabilities = candidates.filter((c) => c.kind === 'element' && c.elementType === 'capability');
    const idOf = (name: string) => capabilities.find((c) => nameOf(c) === name)?.draftSubjectId;
    const parentOf = (name: string) => {
      const proposal = capabilities.find((c) => nameOf(c) === name)?.proposal;
      return proposal?.kind === 'element' && proposal.parent?.kind === 'existing' ? proposal.parent.elementId : null;
    };
    expect(parentOf('Customer')).toBeNull();
    expect(parentOf('Connections')).toBe(idOf('Customer'));
    expect(parentOf('Connection Quotations')).toBe(idOf('Customer'));
    expect(parentOf('Quotation Pricing')).toBe(idOf('Connection Quotations'));
    expect(parentOf('Land, Wayleaves & Consents')).toBeNull();
  });

  it('brings every supports, uses and flows_to row back as a resolved relationship, linked to the right elements', async () => {
    const { candidates, stats } = await reimport();
    const relationships = candidates.filter((c) => c.kind === 'relationship');
    expect(relationships.map((c) => `${String(c.relationshipType)}/${c.class}`).sort()).toEqual(['flows_to/new', 'supports/new', 'supports/new', 'uses/new']);
    const id = (name: string, type: string, parentName?: string) => {
      const parentId = parentName ? candidates.find((c) => c.kind === 'element' && nameOf(c) === parentName && c.elementType === 'system')?.draftSubjectId : undefined;
      return candidates.find((c) => c.kind === 'element' && nameOf(c) === name && c.elementType === type && (parentName === undefined || (c.proposal.kind === 'element' && c.proposal.parent?.kind === 'existing' && c.proposal.parent.elementId === parentId)))?.draftSubjectId;
    };
    const ends = (type: string) => relationships.filter((c) => c.relationshipType === type).map((c) => (c.proposal.kind === 'relationship' && c.proposal.from.kind === 'existing' && c.proposal.to.kind === 'existing' ? [c.proposal.from.elementId, c.proposal.to.elementId, (c.proposal.attributes as Record<string, unknown>).role ?? (c.proposal.attributes as Record<string, unknown>).description] : null));
    expect(ends('supports')).toContainEqual([id('ESCOMS', 'container'), id('Land, Wayleaves & Consents', 'capability'), 'primary']);
    expect(ends('supports')).toContainEqual([id('Aurora', 'system'), id('Connections', 'capability'), 'secondary']);
    // Both PM endpoints were written qualified ("SAP · PM", "Salesforce · PM") because two modules share the name, and each resolves to its own platform's module.
    expect(ends('uses')).toEqual([[id('ESCOMS', 'container'), id('PM', 'container', 'SAP'), 'reads work orders from']]);
    expect(ends('flows_to')).toEqual([[id('PM', 'container', 'Salesforce'), id('Aurora', 'system'), 'sends incidents to']]);
    // The one `owns` row is not read from the Relationships sheet (the Owner column is the owner path) — and is counted, not silent.
    expect(stats['relationships.skipped.UNSUPPORTED_TYPE']).toBe(1);
  });
});

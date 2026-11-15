import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { AttributeDefinitionRow, SourceRow } from '../../db/types';
import { buildModelSnapshot, MODEL_SNAPSHOT_FORMAT } from './modelSnapshot';

const el = (id: string, type: ElementsHeadRow['element_type'], name: string, parent: string | null = null): ElementsHeadRow => ({ element_id: id, element_type: type, name, parent_id: parent, attributes: { lifecycleStatus: 'active' }, exists_delta_id: `d-${id}` });
const rel = (id: string, type: RelationshipsHeadRow['relationship_type'], from: string, to: string): RelationshipsHeadRow => ({ relationship_id: id, relationship_type: type, from_element_id: from, to_element_id: to, attributes: {}, exists_delta_id: `d-${id}` });
const fact = (subject: string, attribute: string): FactsRow => ({ subject_type: 'element', subject_id: subject, attribute, value: 'x', delta_id: 'delta', source_id: 'src-1', source_ref: 'text:1-1', effective_date: null, confidence: 0.9, asserted_by: 'u', asserted_at: '2026-01-01T00:00:00Z' });
const source = { id: 'src-1', kind: 'spreadsheet', name: 'Import', uri: null, captured_at: null, created_at: '2026-01-01T00:00:00Z' } as unknown as SourceRow;
const definition = { key: 'tier', label: 'Tier', kind: 'text', options: null, applies_to: ['system'], required: false, description: null, order_index: 1, deprecated_at: null } as unknown as AttributeDefinitionRow;

describe('buildModelSnapshot', () => {
  const snapshot = buildModelSnapshot({
    modelId: 'm1',
    modelName: 'Distribution',
    commitId: 'c1',
    exportedAt: new Date('2026-11-15T12:00:00Z'),
    elements: [el('b', 'container', 'Finance', 'a'), el('a', 'system', 'SAP'), el('c', 'system', 'Esri')],
    relationships: [rel('r1', 'replaces', 'c', 'a'), rel('r2', 'supports', 'a', 'b')],
    facts: [fact('a', 'lifecycleStatus')],
    sources: [source],
    definitions: [definition],
  });

  it('carries the format, model and the commit it was read at', () => {
    expect(snapshot.format).toBe(MODEL_SNAPSHOT_FORMAT);
    expect(snapshot.model).toEqual({ id: 'm1', name: 'Distribution' });
    expect(snapshot.asOfCommit).toBe('c1');
    expect(snapshot.exportedAt).toBe('2026-11-15T12:00:00.000Z');
  });

  it('exports every element with its parent name, in a stable order', () => {
    expect(snapshot.elements.map((e) => e.name)).toEqual(['Finance', 'Esri', 'SAP']);
    expect(snapshot.elements[0]).toMatchObject({ parentId: 'a', parentName: 'SAP' });
  });

  it('exports relationships of every type, including replaces, with endpoint names', () => {
    expect(snapshot.relationships.map((r) => r.type)).toEqual(['replaces', 'supports']);
    expect(snapshot.relationships[0]).toMatchObject({ fromName: 'Esri', toName: 'SAP' });
  });

  it('keeps where each value came from, the sources, and the custom attribute definitions', () => {
    expect(snapshot.provenance).toEqual([expect.objectContaining({ subjectId: 'a', attribute: 'lifecycleStatus', sourceId: 'src-1', confidence: 0.9 })]);
    expect(snapshot.sources).toEqual([expect.objectContaining({ id: 'src-1', name: 'Import' })]);
    expect(snapshot.attributeDefinitions).toEqual([expect.objectContaining({ key: 'tier', appliesTo: ['system'], deprecated: false })]);
  });
});

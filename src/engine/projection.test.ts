import { describe, expect, it } from 'vitest';
import { emptyHead } from './deltas';
import { serializeHeadProjection } from './projection';

describe('serializeHeadProjection', () => {
  it('serialises elements and relationships verbatim, with attributes carried through', () => {
    const head = emptyHead();
    head.elements.set('el-1', { elementType: 'system', name: 'Housing Options', parentId: null, attributes: { lifecycleStatus: 'active' }, existsDeltaId: 'd1' });
    head.relationships.set('rel-1', { relationshipType: 'uses', fromElementId: 'el-1', toElementId: 'el-2', attributes: { protocol: 'https' }, existsDeltaId: 'd2' });

    const { elementsHead, relationshipsHead } = serializeHeadProjection(head);

    expect(elementsHead).toEqual([
      { element_id: 'el-1', element_type: 'system', name: 'Housing Options', parent_id: null, attributes: { lifecycleStatus: 'active' }, exists_delta_id: 'd1' },
    ]);
    expect(relationshipsHead).toEqual([
      { relationship_id: 'rel-1', relationship_type: 'uses', from_element_id: 'el-1', to_element_id: 'el-2', attributes: { protocol: 'https' }, exists_delta_id: 'd2' },
    ]);
  });

  it('classifies each fact\'s subject_type by which map it actually lives in, not by guessing', () => {
    const head = emptyHead();
    head.elements.set('el-1', { elementType: 'system', name: 'Housing Options', parentId: null, attributes: {}, existsDeltaId: 'd1' });
    head.relationships.set('rel-1', { relationshipType: 'uses', fromElementId: 'el-1', toElementId: 'el-2', attributes: {}, existsDeltaId: 'd2' });
    head.facts.set('el-1 name', { subjectId: 'el-1', attribute: 'name', deltaId: 'd1', sourceId: 'src-1', confidence: 1, authorId: 'u1', createdAt: '2026-01-01T00:00:00Z', value: 'Housing Options' });
    head.facts.set('rel-1 $exists', { subjectId: 'rel-1', attribute: '$exists', deltaId: 'd2', sourceId: 'src-1', confidence: 1, authorId: 'u1', createdAt: '2026-01-01T00:00:00Z', value: null });

    const { facts } = serializeHeadProjection(head);

    const elementFact = facts.find((f) => f.subject_id === 'el-1');
    const relationshipFact = facts.find((f) => f.subject_id === 'rel-1');
    expect(elementFact?.subject_type).toBe('element');
    expect(relationshipFact?.subject_type).toBe('relationship');
  });

  it('coalesces absent optional provenance fields (sourceRef, effectiveDate) to null, never undefined', () => {
    const head = emptyHead();
    head.elements.set('el-1', { elementType: 'system', name: 'X', parentId: null, attributes: {}, existsDeltaId: 'd1' });
    head.facts.set('el-1 $exists', { subjectId: 'el-1', attribute: '$exists', deltaId: 'd1', sourceId: 'src-1', confidence: 1, authorId: 'u1', createdAt: '2026-01-01T00:00:00Z', value: null });

    const { facts } = serializeHeadProjection(head);

    expect(facts[0]).toMatchObject({ source_ref: null, effective_date: null });
  });

  it('produces empty arrays for an empty head', () => {
    expect(serializeHeadProjection(emptyHead())).toEqual({ elementsHead: [], relationshipsHead: [], facts: [] });
  });
});

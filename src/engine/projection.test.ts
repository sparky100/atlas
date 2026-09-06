import { describe, expect, it } from 'vitest';
import { emptyHead } from './deltas';
import { headHash } from './head';
import { deserializeHeadProjection, serializeHeadProjection } from './projection';

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

describe('deserializeHeadProjection', () => {
  it('round-trips through serializeHeadProjection with the same head_hash (SPEC §6.6\'s tag-creation check depends on this)', () => {
    const head = emptyHead();
    head.elements.set('el-1', { elementType: 'system', name: 'Housing Options', parentId: null, attributes: { lifecycleStatus: 'active' }, existsDeltaId: 'd1' });
    head.elements.set('el-2', { elementType: 'capability', name: 'Housing', parentId: null, attributes: {}, existsDeltaId: 'd2' });
    head.relationships.set('rel-1', { relationshipType: 'supports', fromElementId: 'el-1', toElementId: 'el-2', attributes: {}, existsDeltaId: 'd3' });
    head.facts.set('el-1 name', { subjectId: 'el-1', attribute: 'name', deltaId: 'd1', sourceId: 'src-1', confidence: 1, authorId: 'u1', createdAt: '2026-01-01T00:00:00Z', value: 'Housing Options' });
    head.facts.set('el-1 $exists', { subjectId: 'el-1', attribute: '$exists', deltaId: 'd1', sourceId: 'src-1', sourceRef: 'sheet1!A1', effectiveDate: '2026-01-01', confidence: 0.9, authorId: 'u1', createdAt: '2026-01-01T00:00:00Z', value: null });

    const projection = serializeHeadProjection(head);
    const roundTripped = deserializeHeadProjection(projection.elementsHead, projection.relationshipsHead, projection.facts);

    expect(headHash(roundTripped)).toBe(headHash(head));
  });

  it('produces an empty head from empty rows', () => {
    const head = deserializeHeadProjection([], [], []);
    expect(head.elements.size).toBe(0);
    expect(head.relationships.size).toBe(0);
    expect(head.facts.size).toBe(0);
  });

  it('produces a different head_hash when a materialised row has been tampered with (the corruption tag creation must catch)', () => {
    const head = emptyHead();
    head.elements.set('el-1', { elementType: 'system', name: 'Housing Options', parentId: null, attributes: {}, existsDeltaId: 'd1' });
    const projection = serializeHeadProjection(head);
    const tampered = projection.elementsHead.map((row) => ({ ...row, name: 'Corrupted Name' }));

    const honest = deserializeHeadProjection(projection.elementsHead, projection.relationshipsHead, projection.facts);
    const corrupted = deserializeHeadProjection(tampered, projection.relationshipsHead, projection.facts);

    expect(headHash(corrupted)).not.toBe(headHash(honest));
  });
});

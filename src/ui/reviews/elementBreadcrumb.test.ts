import { describe, expect, it } from 'vitest';
import { emptyHead, type ElementRow, type RelationshipRow } from '../../engine/deltas';
import { subjectAnchorType } from './elementBreadcrumb';

const ELEMENT_ID = '11111111-1111-1111-1111-111111111111';
const RELATIONSHIP_ID = '22222222-2222-2222-2222-222222222222';
const UNKNOWN_ID = '99999999-9999-9999-9999-999999999999';

const element: ElementRow = { elementType: 'system', name: 'Payments', parentId: null, attributes: {}, existsDeltaId: 'd1' };
const relationship: RelationshipRow = { relationshipType: 'uses', fromElementId: ELEMENT_ID, toElementId: ELEMENT_ID, attributes: {}, existsDeltaId: 'd2' };

describe('subjectAnchorType', () => {
  it("returns 'element' when the subject id is an element in any given head", () => {
    const head = emptyHead();
    head.elements.set(ELEMENT_ID, element);
    expect(subjectAnchorType([head], ELEMENT_ID)).toBe('element');
  });

  it("returns 'relationship' when the subject id is a relationship in any given head", () => {
    const head = emptyHead();
    head.relationships.set(RELATIONSHIP_ID, relationship);
    expect(subjectAnchorType([head], RELATIONSHIP_ID)).toBe('relationship');
  });

  it('checks heads in order, returning the first match — mirrors subjectName\'s own lookup order', () => {
    const headWithoutIt = emptyHead();
    const headWithIt = emptyHead();
    headWithIt.relationships.set(RELATIONSHIP_ID, relationship);
    expect(subjectAnchorType([headWithoutIt, headWithIt], RELATIONSHIP_ID)).toBe('relationship');
  });

  it("falls back to 'element' for an id found in no head (never expected — a finding always names a real subject)", () => {
    const head = emptyHead();
    expect(subjectAnchorType([head], UNKNOWN_ID)).toBe('element');
  });
});

import { describe, expect, it } from 'vitest';
import type { Json } from '../contracts/rows';
import { computeVersionDiff } from './versionDiff';
import { emptyHead, type ElementRow, type Head, type RelationshipRow } from './deltas';

function withElement(head: Head, id: string, row: ElementRow): Head {
  head.elements.set(id, row);
  return head;
}

function withRelationship(head: Head, id: string, row: RelationshipRow): Head {
  head.relationships.set(id, row);
  return head;
}

function system(name: string, parentId: string | null = null, attributes: Record<string, Json> = {}): ElementRow {
  return { elementType: 'system', name, parentId, attributes, existsDeltaId: 'd1' };
}

function uses(from: string, to: string, attributes: Record<string, Json> = {}): RelationshipRow {
  return { relationshipType: 'uses', fromElementId: from, toElementId: to, attributes, existsDeltaId: 'd2' };
}

describe('computeVersionDiff', () => {
  it('classifies an element present in both, unchanged, as unchanged', () => {
    const row = system('CRM');
    const asIs = withElement(emptyHead(), 'sys1', row);
    const toBe = withElement(emptyHead(), 'sys1', row);
    const diff = computeVersionDiff(asIs, toBe);
    expect(diff.elements).toEqual([{ elementId: 'sys1', state: 'unchanged', asIs: row, toBe: row, changedAttributes: [] }]);
  });

  it('classifies an element only in toBe as added', () => {
    const row = system('CRM');
    const diff = computeVersionDiff(emptyHead(), withElement(emptyHead(), 'sys1', row));
    expect(diff.elements).toEqual([{ elementId: 'sys1', state: 'added', asIs: null, toBe: row, changedAttributes: [] }]);
  });

  it('classifies an element only in asIs as removed', () => {
    const row = system('CRM');
    const diff = computeVersionDiff(withElement(emptyHead(), 'sys1', row), emptyHead());
    expect(diff.elements).toEqual([{ elementId: 'sys1', state: 'removed', asIs: row, toBe: null, changedAttributes: [] }]);
  });

  it('classifies a name change as changed, listing "name"', () => {
    const asIs = withElement(emptyHead(), 'sys1', system('CRM'));
    const toBe = withElement(emptyHead(), 'sys1', system('Customer Hub'));
    const diff = computeVersionDiff(asIs, toBe);
    expect(diff.elements[0]).toMatchObject({ state: 'changed', changedAttributes: ['name'] });
  });

  it('classifies an attribute value change as changed, listing the attribute key', () => {
    const asIs = withElement(emptyHead(), 'sys1', system('CRM', null, { lifecycleStatus: 'active' }));
    const toBe = withElement(emptyHead(), 'sys1', system('CRM', null, { lifecycleStatus: 'retiring' }));
    const diff = computeVersionDiff(asIs, toBe);
    expect(diff.elements[0]).toMatchObject({ state: 'changed', changedAttributes: ['lifecycleStatus'] });
  });

  it('classifies a parentId change as moved, not changed, even when no other attribute changed', () => {
    const asIs = withElement(emptyHead(), 'sys1', system('CRM', 'group-a'));
    const toBe = withElement(emptyHead(), 'sys1', system('CRM', 'group-b'));
    const diff = computeVersionDiff(asIs, toBe);
    expect(diff.elements[0]).toMatchObject({ state: 'moved', changedAttributes: [] });
  });

  it('classifies a parentId change alongside an attribute change as moved, but still lists the changed attribute', () => {
    const asIs = withElement(emptyHead(), 'sys1', system('CRM', 'group-a', { lifecycleStatus: 'active' }));
    const toBe = withElement(emptyHead(), 'sys1', system('CRM', 'group-b', { lifecycleStatus: 'retiring' }));
    const diff = computeVersionDiff(asIs, toBe);
    expect(diff.elements[0]).toMatchObject({ state: 'moved', changedAttributes: ['lifecycleStatus'] });
  });

  it('never reports "moved" for a relationship — endpoints are immutable, so a re-point is removed+added', () => {
    const asIs = withRelationship(emptyHead(), 'rel1', uses('a', 'b'));
    const toBe = emptyHead();
    withRelationship(toBe, 'rel2', uses('a', 'c'));
    const diff = computeVersionDiff(asIs, toBe);
    expect(diff.relationships).toEqual([
      { relationshipId: 'rel1', state: 'removed', asIs: expect.objectContaining({ toElementId: 'b' }), toBe: null, changedAttributes: [] },
      { relationshipId: 'rel2', state: 'added', asIs: null, toBe: expect.objectContaining({ toElementId: 'c' }), changedAttributes: [] },
    ]);
  });

  it('classifies a relationship attribute change as changed', () => {
    const asIs = withRelationship(emptyHead(), 'rel1', uses('a', 'b', { protocol: 'http' }));
    const toBe = withRelationship(emptyHead(), 'rel1', uses('a', 'b', { protocol: 'https' }));
    const diff = computeVersionDiff(asIs, toBe);
    expect(diff.relationships[0]).toMatchObject({ state: 'changed', changedAttributes: ['protocol'] });
  });

  it('is symmetric under swapping asIs/toBe: added becomes removed and vice versa', () => {
    const row = system('CRM');
    const forward = computeVersionDiff(emptyHead(), withElement(emptyHead(), 'sys1', row));
    const backward = computeVersionDiff(withElement(emptyHead(), 'sys1', row), emptyHead());
    expect(forward.elements[0]?.state).toBe('added');
    expect(backward.elements[0]?.state).toBe('removed');
  });

  it('produces nothing for two empty heads', () => {
    expect(computeVersionDiff(emptyHead(), emptyHead())).toEqual({ elements: [], relationships: [] });
  });
});

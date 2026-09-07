import { describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { emptyHead, type ElementRow, type RelationshipRow } from '../engine/deltas';
import { summarizeOwnDeltas } from './changeSummary';

function elementCreate(id: string, elementId: string, name: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'src', confidence: 1 };
}

function elementUpdate(id: string, elementId: string, value: string, previousDeltaId: string): Delta {
  return { kind: 'element.update', id, elementId, elementType: 'system', attribute: 'name', value, previousDeltaId, sourceId: 'src', confidence: 1 };
}

function relationshipCreate(id: string, relationshipId: string, fromElementId: string, toElementId: string): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType: 'supports', fromElementId, toElementId, attributes: {}, sourceId: 'src', confidence: 1 };
}

function system(name: string): ElementRow {
  return { elementType: 'system', name, parentId: null, attributes: {}, existsDeltaId: `create-${name}` };
}

function capability(name: string): ElementRow {
  return { elementType: 'capability', name, parentId: null, attributes: {}, existsDeltaId: `create-${name}` };
}

function supports(fromElementId: string, toElementId: string): RelationshipRow {
  return { relationshipType: 'supports', fromElementId, toElementId, attributes: {}, existsDeltaId: 'create-supports' };
}

describe('summarizeOwnDeltas', () => {
  it('groups a subject\'s own deltas together, named from the to-be side', () => {
    const asIs = emptyHead();
    asIs.elements.set('sys-1', system('Old Name'));

    const toBe = emptyHead();
    toBe.elements.set('sys-1', system('New Name'));

    const deltas = [elementUpdate('d1', 'sys-1', 'New Name', 'create-1')];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.subjects).toHaveLength(1);
    expect(result.subjects[0]).toMatchObject({ subjectId: 'sys-1', subjectType: 'element', name: 'New Name', deltas });
  });

  it('falls back to the as-is name for a subject this branch retracted (gone from to-be)', () => {
    const asIs = emptyHead();
    asIs.elements.set('sys-1', system('Retiring System'));
    const toBe = emptyHead(); // retracted — not present

    const deltas: Delta[] = [{ kind: 'element.retract', id: 'd1', elementId: 'sys-1', elementType: 'system', previousDeltaId: 'create-1', sourceId: 'src', confidence: 1 }];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.subjects[0]?.name).toBe('Retiring System');
  });

  it('names a relationship subject "type A → B", resolving both endpoints', () => {
    const asIs = emptyHead();
    const toBe = emptyHead();
    toBe.elements.set('sys-a', system('Alpha'));
    toBe.elements.set('cap-1', capability('Housing'));
    toBe.relationships.set('rel-1', supports('sys-a', 'cap-1'));

    const deltas = [relationshipCreate('d1', 'rel-1', 'sys-a', 'cap-1')];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.subjects[0]).toMatchObject({ subjectId: 'rel-1', subjectType: 'relationship', name: 'supports Alpha → Housing' });
  });

  it('finds affected capabilities via a touched system\'s own supports edge, even when the capability itself has no delta', () => {
    const asIs = emptyHead();
    asIs.elements.set('sys-a', system('Alpha'));

    const toBe = emptyHead();
    toBe.elements.set('sys-a', system('Alpha Renamed'));
    toBe.elements.set('cap-1', capability('Housing')); // pre-existing, no delta from this branch
    toBe.relationships.set('rel-1', supports('sys-a', 'cap-1'));

    const deltas = [elementUpdate('d1', 'sys-a', 'Alpha Renamed', 'create-1')];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.affectedCapabilities).toHaveLength(1);
    expect(result.affectedCapabilities[0]).toMatchObject({ capability: { element_id: 'cap-1', name: 'Housing' } });
    expect(result.affectedCapabilities[0]?.viaSystems.map((s) => s.element_id)).toEqual(['sys-a']);
  });

  it('includes a directly-touched capability with no supporting system in scope', () => {
    const asIs = emptyHead();
    const toBe = emptyHead();
    toBe.elements.set('cap-1', capability('New Capability'));

    const deltas = [elementCreate('d1', 'cap-1', 'New Capability')];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.affectedCapabilities).toMatchObject([{ capability: { element_id: 'cap-1' }, viaSystems: [] }]);
  });

  it('ignores a supports edge from an untouched system', () => {
    const asIs = emptyHead();
    const toBe = emptyHead();
    toBe.elements.set('sys-untouched', system('Untouched'));
    toBe.elements.set('cap-1', capability('Housing'));
    toBe.relationships.set('rel-1', supports('sys-untouched', 'cap-1'));
    toBe.elements.set('sys-b', system('Beta'));

    // Only sys-b has a delta — the supports edge from sys-untouched doesn't count.
    const deltas = [elementCreate('d1', 'sys-b', 'Beta')];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.affectedCapabilities).toHaveLength(0);
  });
});

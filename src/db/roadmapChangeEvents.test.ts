import { describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { emptyHead, type ElementRow, type RelationshipRow } from '../engine/deltas';
import { deriveRoadmapChangeEvents } from './roadmapChangeEvents';

function elementCreate(id: string, elementId: string, name: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'src', confidence: 1 };
}

function retireUpdate(id: string, elementId: string, previousDeltaId: string): Delta {
  return { kind: 'element.update', id, elementId, elementType: 'system', attribute: 'lifecycleStatus', value: 'retiring', previousDeltaId, sourceId: 'src', confidence: 1 };
}

function otherUpdate(id: string, elementId: string, previousDeltaId: string): Delta {
  return { kind: 'element.update', id, elementId, elementType: 'system', attribute: 'name', value: 'Renamed', previousDeltaId, sourceId: 'src', confidence: 1 };
}

function relationshipRetract(id: string, relationshipId: string, previousDeltaId: string): Delta {
  return { kind: 'relationship.retract', id, relationshipId, relationshipType: 'supports', previousDeltaId, sourceId: 'src', confidence: 1 };
}

function relationshipCreate(id: string, relationshipId: string, fromElementId: string, toElementId: string): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType: 'supports', fromElementId, toElementId, attributes: { role: 'secondary' }, sourceId: 'src', confidence: 1 };
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

describe('deriveRoadmapChangeEvents', () => {
  it('marks a new system as an add event', () => {
    const asIs = emptyHead();
    const toBe = emptyHead();
    toBe.elements.set('sys-new', system('New Portal'));

    const events = deriveRoadmapChangeEvents([elementCreate('d1', 'sys-new', 'New Portal')], asIs, toBe);

    expect(events).toEqual([{ kind: 'add', elementId: 'sys-new', elementName: 'New Portal' }]);
  });

  it('marks a lifecycleStatus update to "retiring" as a retire event, ignoring other attribute updates', () => {
    const asIs = emptyHead();
    asIs.elements.set('sys-1', system('Legacy System'));
    const toBe = emptyHead();
    toBe.elements.set('sys-1', system('Legacy System'));

    const events = deriveRoadmapChangeEvents([retireUpdate('d1', 'sys-1', 'create-1'), otherUpdate('d2', 'sys-1', 'd1')], asIs, toBe);

    expect(events).toEqual([{ kind: 'retire', elementId: 'sys-1', elementName: 'Legacy System' }]);
  });

  it('does not mark a bare update on an unrelated attribute as a retire', () => {
    const asIs = emptyHead();
    const toBe = emptyHead();
    toBe.elements.set('sys-1', system('System'));

    const events = deriveRoadmapChangeEvents([otherUpdate('d1', 'sys-1', 'create-1')], asIs, toBe);

    expect(events).toEqual([]);
  });

  it('pairs a supports retract and a supports create into the same capability as a replacement arrow', () => {
    const asIs = emptyHead();
    asIs.elements.set('sys-old', system('Old System'));
    asIs.elements.set('cap-1', capability('Housing'));
    asIs.relationships.set('rel-old', supports('sys-old', 'cap-1'));

    const toBe = emptyHead();
    toBe.elements.set('sys-new', system('New System'));
    toBe.elements.set('cap-1', capability('Housing'));
    toBe.relationships.set('rel-new', supports('sys-new', 'cap-1'));

    const deltas = [relationshipRetract('d1', 'rel-old', 'create-rel-old'), relationshipCreate('d2', 'rel-new', 'sys-new', 'cap-1')];
    const events = deriveRoadmapChangeEvents(deltas, asIs, toBe);

    expect(events).toEqual([
      {
        kind: 'replace',
        capabilityId: 'cap-1',
        capabilityName: 'Housing',
        fromSystemId: 'sys-old',
        fromSystemName: 'Old System',
        toSystemId: 'sys-new',
        toSystemName: 'New System',
      },
    ]);
  });

  it('does not synthesize a replacement when a supports edge is only retracted, with no matching create for the same capability', () => {
    const asIs = emptyHead();
    asIs.elements.set('sys-old', system('Old System'));
    asIs.elements.set('cap-1', capability('Housing'));
    asIs.relationships.set('rel-old', supports('sys-old', 'cap-1'));
    const toBe = emptyHead();

    const events = deriveRoadmapChangeEvents([relationshipRetract('d1', 'rel-old', 'create-rel-old')], asIs, toBe);

    expect(events).toEqual([]);
  });

  it('does not synthesize a replacement when a supports edge is only created, with no prior retract for the same capability', () => {
    const asIs = emptyHead();
    const toBe = emptyHead();
    toBe.elements.set('sys-new', system('New System'));
    toBe.elements.set('cap-1', capability('Housing'));
    toBe.relationships.set('rel-new', supports('sys-new', 'cap-1'));

    const events = deriveRoadmapChangeEvents([relationshipCreate('d1', 'rel-new', 'sys-new', 'cap-1')], asIs, toBe);

    expect(events).toEqual([]);
  });
});

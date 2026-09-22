import { describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { emptyHead, type ElementRow, type RelationshipRow } from '../engine/deltas';
import { deriveRoadmapChangeEvents } from './roadmapChangeEvents';

function elementCreate(id: string, elementId: string, name: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'src', confidence: 1 };
}

function containerCreate(id: string, elementId: string, name: string, parentId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'container', name, parentId, attributes: { isExternal: false }, sourceId: 'src', confidence: 1 };
}

function retireUpdate(id: string, elementId: string, previousDeltaId: string): Delta {
  return { kind: 'element.update', id, elementId, elementType: 'system', attribute: 'lifecycleStatus', value: 'retiring', previousDeltaId, sourceId: 'src', confidence: 1 };
}

function containerRetireUpdate(id: string, elementId: string, previousDeltaId: string): Delta {
  return { kind: 'element.update', id, elementId, elementType: 'container', attribute: 'lifecycleStatus', value: 'retiring', previousDeltaId, sourceId: 'src', confidence: 1 };
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

function replacesCreate(id: string, relationshipId: string, fromElementId: string, toElementId: string): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType: 'replaces', fromElementId, toElementId, attributes: {}, sourceId: 'src', confidence: 1 };
}

function system(name: string): ElementRow {
  return { elementType: 'system', name, parentId: null, attributes: {}, existsDeltaId: `create-${name}` };
}

function container(name: string, parentId: string | null = null): ElementRow {
  return { elementType: 'container', name, parentId, attributes: {}, existsDeltaId: `create-${name}` };
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

  it('marks a new module (Container) as an add event — "platforms and modules" carry the same lifecycle facts a system does', () => {
    const asIs = emptyHead();
    asIs.elements.set('sap', system('SAP'));
    const toBe = emptyHead();
    toBe.elements.set('sap', system('SAP'));
    toBe.elements.set('mod-new', container('New Module', 'sap'));

    const events = deriveRoadmapChangeEvents([containerCreate('d1', 'mod-new', 'New Module', 'sap')], asIs, toBe);

    expect(events).toEqual([{ kind: 'add', elementId: 'mod-new', elementName: 'New Module' }]);
  });

  it('marks a module\'s lifecycleStatus update to "retiring" as a retire event, same as a system\'s', () => {
    const asIs = emptyHead();
    asIs.elements.set('bw', container('BW', 'sap'));
    const toBe = emptyHead();
    toBe.elements.set('bw', container('BW', 'sap'));

    const events = deriveRoadmapChangeEvents([containerRetireUpdate('d1', 'bw', 'create-1')], asIs, toBe);

    expect(events).toEqual([{ kind: 'retire', elementId: 'bw', elementName: 'BW' }]);
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

  it('pairs a module (Container) being replaced by a system into the same capability as a replacement arrow', () => {
    const asIs = emptyHead();
    asIs.elements.set('bw', container('BW', 'sap'));
    asIs.elements.set('cap-1', capability('Reporting'));
    asIs.relationships.set('rel-old', supports('bw', 'cap-1'));

    const toBe = emptyHead();
    toBe.elements.set('datasphere', system('Datasphere'));
    toBe.elements.set('cap-1', capability('Reporting'));
    toBe.relationships.set('rel-new', supports('datasphere', 'cap-1'));

    const deltas = [relationshipRetract('d1', 'rel-old', 'create-rel-old'), relationshipCreate('d2', 'rel-new', 'datasphere', 'cap-1')];
    const events = deriveRoadmapChangeEvents(deltas, asIs, toBe);

    expect(events).toEqual([
      {
        kind: 'replace',
        capabilityId: 'cap-1',
        capabilityName: 'Reporting',
        fromSystemId: 'bw',
        fromSystemName: 'BW',
        toSystemId: 'datasphere',
        toSystemName: 'Datasphere',
      },
    ]);
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

  it('derives a replacement arrow from a `replaces` edge created in the change — replacement-from is the arrow\'s `to`, retiring-to is its `from`', () => {
    const asIs = emptyHead();
    asIs.elements.set('sys-old', system('Old System'));
    const toBe = emptyHead();
    toBe.elements.set('sys-old', system('Old System'));
    toBe.elements.set('sys-new', system('New System'));

    const events = deriveRoadmapChangeEvents([replacesCreate('d1', 'rel-1', 'sys-new', 'sys-old')], asIs, toBe);

    expect(events).toEqual([
      {
        kind: 'replace',
        fromSystemId: 'sys-old',
        fromSystemName: 'Old System',
        toSystemId: 'sys-new',
        toSystemName: 'New System',
      },
    ]);
  });

  it('derives a replacement arrow from a module\'s (Container) `replaces` edge, same as a system\'s', () => {
    const asIs = emptyHead();
    asIs.elements.set('bw', container('BW', 'sap'));
    const toBe = emptyHead();
    toBe.elements.set('bw', container('BW', 'sap'));
    toBe.elements.set('datasphere', system('Datasphere'));

    const events = deriveRoadmapChangeEvents([replacesCreate('d1', 'rel-1', 'datasphere', 'bw')], asIs, toBe);

    expect(events).toEqual([
      {
        kind: 'replace',
        fromSystemId: 'bw',
        fromSystemName: 'BW',
        toSystemId: 'datasphere',
        toSystemName: 'Datasphere',
      },
    ]);
  });

  it('prefers the `replaces` edge over re-deriving the swap from transferred supports edges, emitting one arrow not one per capability', () => {
    const asIs = emptyHead();
    asIs.elements.set('sys-old', system('Old System'));
    asIs.elements.set('cap-1', capability('Housing'));
    asIs.elements.set('cap-2', capability('Finance'));
    asIs.relationships.set('rel-old-1', supports('sys-old', 'cap-1'));
    asIs.relationships.set('rel-old-2', supports('sys-old', 'cap-2'));

    const toBe = emptyHead();
    toBe.elements.set('sys-old', system('Old System'));
    toBe.elements.set('sys-new', system('New System'));
    toBe.elements.set('cap-1', capability('Housing'));
    toBe.elements.set('cap-2', capability('Finance'));
    toBe.relationships.set('rel-new-1', supports('sys-new', 'cap-1'));
    toBe.relationships.set('rel-new-2', supports('sys-new', 'cap-2'));

    const deltas = [
      relationshipRetract('d1', 'rel-old-1', 'create-rel-old-1'),
      relationshipRetract('d2', 'rel-old-2', 'create-rel-old-2'),
      relationshipCreate('d3', 'rel-new-1', 'sys-new', 'cap-1'),
      relationshipCreate('d4', 'rel-new-2', 'sys-new', 'cap-2'),
      replacesCreate('d5', 'rel-repl', 'sys-new', 'sys-old'),
    ];
    const events = deriveRoadmapChangeEvents(deltas, asIs, toBe);

    expect(events).toEqual([
      {
        kind: 'replace',
        fromSystemId: 'sys-old',
        fromSystemName: 'Old System',
        toSystemId: 'sys-new',
        toSystemName: 'New System',
      },
    ]);
  });

  it('still derives a capability-qualified arrow when a supports transfer happens without a `replaces` edge (import-driven replacement)', () => {
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
});

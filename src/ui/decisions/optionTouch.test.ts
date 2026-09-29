import { describe, expect, it } from 'vitest';
import type { Delta, RelationshipType } from '../../contracts/delta';
import type { ChangeSubjectSummary } from '../../db/changeSummary';
import { deriveOptionTouch } from './optionTouch';

function elementSubject(id: string, name: string, delta: Delta): ChangeSubjectSummary {
  return { subjectType: 'element', elementType: 'system', subjectId: id, name, deltas: [delta] };
}

function createDelta(elementId: string, name: string): Delta {
  return { kind: 'element.create', id: `create-${elementId}`, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 's1', confidence: 1 };
}

function retractDelta(elementId: string): Delta {
  return { kind: 'element.retract', id: `retract-${elementId}`, elementId, elementType: 'system', previousDeltaId: 'prev', sourceId: 's1', confidence: 1 };
}

function updateDelta(elementId: string): Delta {
  return { kind: 'element.update', id: `update-${elementId}`, elementId, elementType: 'system', attribute: 'lifecycleStatus', value: 'retiring', previousDeltaId: 'prev', sourceId: 's1', confidence: 1 };
}

function relationshipSubject(id: string, relationshipType: RelationshipType, from: string, to: string): ChangeSubjectSummary {
  const delta = { kind: 'relationship.create', id: `create-${id}`, relationshipId: id, relationshipType, fromElementId: from, toElementId: to, attributes: {}, sourceId: 's1', confidence: 1 } as Delta;
  return { subjectType: 'relationship', relationshipType, subjectId: id, name: `${relationshipType} ${from} → ${to}`, deltas: [delta] };
}

describe('deriveOptionTouch', () => {
  it('lists an element.retract subject as both touched and retired, with its name', () => {
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', retractDelta('pm'))]);
    expect(touch.touchedElementIds.has('pm')).toBe(true);
    expect(touch.retiredElements).toEqual([{ id: 'pm', name: 'PM' }]);
    expect(touch.addedElements).toEqual([]);
  });

  it('lists an element.create subject as both touched and added, with its name', () => {
    const touch = deriveOptionTouch([elementSubject('hana', 'Hana equivalent', createDelta('hana', 'Hana equivalent'))]);
    expect(touch.touchedElementIds.has('hana')).toBe(true);
    expect(touch.addedElements).toEqual([{ id: 'hana', name: 'Hana equivalent' }]);
    expect(touch.retiredElements).toEqual([]);
  });

  it('lists an element.update subject as touched, but neither retired nor added', () => {
    const touch = deriveOptionTouch([elementSubject('sys1', 'Some System', updateDelta('sys1'))]);
    expect(touch.touchedElementIds.has('sys1')).toBe(true);
    expect(touch.retiredElements).toEqual([]);
    expect(touch.addedElements).toEqual([]);
  });

  it('extracts a `replaces` relationship.create subject into replacesEdges, excluded from repointedRelationshipCount', () => {
    const touch = deriveOptionTouch([relationshipSubject('r1', 'replaces', 'hana', 'pm')]);
    expect(touch.replacesEdges).toEqual([{ fromElementId: 'hana', toElementId: 'pm' }]);
    expect(touch.repointedRelationshipCount).toBe(0);
  });

  it('counts a non-replaces relationship subject toward repointedRelationshipCount, not replacesEdges', () => {
    const touch = deriveOptionTouch([relationshipSubject('r1', 'flows_to', 'a', 'b')]);
    expect(touch.repointedRelationshipCount).toBe(1);
    expect(touch.replacesEdges).toEqual([]);
  });

  it('combines a retire+add+replaces+repoint into one coherent touch', () => {
    const touch = deriveOptionTouch([
      elementSubject('pm', 'PM', retractDelta('pm')),
      elementSubject('hana', 'Hana equivalent', createDelta('hana', 'Hana equivalent')),
      relationshipSubject('r1', 'replaces', 'hana', 'pm'),
      relationshipSubject('r2', 'flows_to', 'hana', 'x'),
    ]);
    expect(touch.touchedElementIds).toEqual(new Set(['pm', 'hana']));
    expect(touch.retiredElements).toEqual([{ id: 'pm', name: 'PM' }]);
    expect(touch.addedElements).toEqual([{ id: 'hana', name: 'Hana equivalent' }]);
    expect(touch.replacesEdges).toEqual([{ fromElementId: 'hana', toElementId: 'pm' }]);
    expect(touch.repointedRelationshipCount).toBe(1);
  });

  it('an empty subject list produces an empty touch', () => {
    const touch = deriveOptionTouch([]);
    expect(touch.touchedElementIds.size).toBe(0);
    expect(touch.retiredElements).toEqual([]);
    expect(touch.addedElements).toEqual([]);
    expect(touch.replacesEdges).toEqual([]);
    expect(touch.repointedRelationshipCount).toBe(0);
  });
});

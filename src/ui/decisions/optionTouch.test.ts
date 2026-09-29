import { describe, expect, it } from 'vitest';
import type { Delta, RelationshipType } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { ChangeSubjectSummary } from '../../db/changeSummary';
import { deriveOptionTouch } from './optionTouch';

function elementSubject(id: string, name: string, delta: Delta): ChangeSubjectSummary {
  return { subjectType: 'element', elementType: 'system', subjectId: id, name, deltas: [delta] };
}

function elementSubjectMulti(id: string, name: string, deltas: Delta[]): ChangeSubjectSummary {
  return { subjectType: 'element', elementType: 'system', subjectId: id, name, deltas };
}

function elementRow(id: string, name: string, lifecycleStatus: 'active' | 'retiring' | 'retired' = 'active'): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: { lifecycleStatus, isExternal: false }, exists_delta_id: `d-${id}` };
}

function createDelta(elementId: string, name: string): Delta {
  return { kind: 'element.create', id: `create-${elementId}`, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 's1', confidence: 1 };
}

function retractDelta(elementId: string): Delta {
  return { kind: 'element.retract', id: `retract-${elementId}`, elementId, elementType: 'system', previousDeltaId: 'prev', sourceId: 's1', confidence: 1 };
}

function lifecycleUpdateDelta(elementId: string, value: 'retiring' | 'retired' = 'retiring'): Delta {
  return { kind: 'element.update', id: `update-lifecycle-${elementId}`, elementId, elementType: 'system', attribute: 'lifecycleStatus', value, previousDeltaId: 'prev', sourceId: 's1', confidence: 1 };
}

function updateDelta(elementId: string): Delta {
  return { kind: 'element.update', id: `update-${elementId}`, elementId, elementType: 'system', attribute: 'criticality', value: 'high', previousDeltaId: 'prev', sourceId: 's1', confidence: 1 };
}

function relationshipSubject(id: string, relationshipType: RelationshipType, from: string, to: string): ChangeSubjectSummary {
  const delta = { kind: 'relationship.create', id: `create-${id}`, relationshipId: id, relationshipType, fromElementId: from, toElementId: to, attributes: {}, sourceId: 's1', confidence: 1 } as Delta;
  return { subjectType: 'relationship', relationshipType, subjectId: id, name: `${relationshipType} ${from} → ${to}`, deltas: [delta] };
}

function relationshipSubjectMulti(id: string, relationshipType: RelationshipType, from: string, to: string, deltas: Delta[]): ChangeSubjectSummary {
  return { subjectType: 'relationship', relationshipType, subjectId: id, name: `${relationshipType} ${from} → ${to}`, deltas };
}

function liveRelationship(id: string, relationshipType: RelationshipType, from: string, to: string): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: relationshipType, from_element_id: from, to_element_id: to, attributes: {}, exists_delta_id: `d-${id}` };
}

describe('deriveOptionTouch', () => {
  it('a real element.retract, still absent from the option\'s own head, is "removed from model" (retiredElements) — not a lifecycle retirement', () => {
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', retractDelta('pm'))], new Map(), []);
    expect(touch.touchedElementIds.has('pm')).toBe(true);
    expect(touch.retiredElements).toEqual([{ id: 'pm', name: 'PM' }]);
    expect(touch.lifecycleRetiredElements).toEqual([]);
    expect(touch.addedElements).toEqual([]);
  });

  it('an element.create, still present in the option\'s own head, is added', () => {
    const optionElementsById = new Map([['hana', elementRow('hana', 'Hana equivalent')]]);
    const touch = deriveOptionTouch([elementSubject('hana', 'Hana equivalent', createDelta('hana', 'Hana equivalent'))], optionElementsById, []);
    expect(touch.touchedElementIds.has('hana')).toBe(true);
    expect(touch.addedElements).toEqual([{ id: 'hana', name: 'Hana equivalent' }]);
    expect(touch.retiredElements).toEqual([]);
  });

  it('an ordinary element.update (not lifecycleStatus) is touched, but neither retired nor a lifecycle retirement', () => {
    const optionElementsById = new Map([['sys1', elementRow('sys1', 'Some System')]]);
    const touch = deriveOptionTouch([elementSubject('sys1', 'Some System', updateDelta('sys1'))], optionElementsById, []);
    expect(touch.touchedElementIds.has('sys1')).toBe(true);
    expect(touch.retiredElements).toEqual([]);
    expect(touch.lifecycleRetiredElements).toEqual([]);
  });

  it("a lifecycleStatus update to 'retiring', with the element still existing in the option's own head, is a lifecycle retirement — the real \"Retire…\" action's own shape, never a real removal", () => {
    const optionElementsById = new Map([['pm', elementRow('pm', 'PM', 'retiring')]]);
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', lifecycleUpdateDelta('pm'))], optionElementsById, []);
    expect(touch.lifecycleRetiredElements).toEqual([{ id: 'pm', name: 'PM' }]);
    expect(touch.retiredElements).toEqual([]);
  });

  it("a lifecycleStatus update this option itself made, but where the option's own head no longer shows 'retiring'/'retired' (e.g. undone by a later update in the same option), is not a lifecycle retirement", () => {
    const optionElementsById = new Map([['pm', elementRow('pm', 'PM', 'active')]]);
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', lifecycleUpdateDelta('pm'))], optionElementsById, []);
    expect(touch.lifecycleRetiredElements).toEqual([]);
  });

  it('a `replaces` relationship.create subject, still live in the option\'s own head, is a live replaces edge', () => {
    const optionElementsById = new Map([
      ['hana', elementRow('hana', 'Hana equivalent')],
      ['pm', elementRow('pm', 'PM', 'retiring')],
    ]);
    const optionRelationshipsHead = [liveRelationship('r1', 'replaces', 'hana', 'pm')];
    const touch = deriveOptionTouch([relationshipSubject('r1', 'replaces', 'hana', 'pm')], optionElementsById, optionRelationshipsHead);
    expect(touch.replacesEdges).toEqual([{ fromElementId: 'hana', toElementId: 'pm' }]);
    expect(touch.repointedRelationshipCount).toBe(0);
  });

  it('a `replaces` edge this option created and *also* retracted itself (e.g. a later "Remove from model") is excluded — not live in the option\'s own head', () => {
    const deltas: Delta[] = [
      { kind: 'relationship.create', id: 'create-r1', relationshipId: 'r1', relationshipType: 'replaces', fromElementId: 'hana', toElementId: 'pm', attributes: {}, sourceId: 's1', confidence: 1 },
      { kind: 'relationship.retract', id: 'retract-r1', relationshipId: 'r1', relationshipType: 'replaces', previousDeltaId: 'create-r1', sourceId: 's1', confidence: 1 },
    ];
    const touch = deriveOptionTouch([relationshipSubjectMulti('r1', 'replaces', 'hana', 'pm', deltas)], new Map(), []);
    expect(touch.replacesEdges).toEqual([]);
  });

  it('counts a non-replaces relationship subject toward repointedRelationshipCount, not replacesEdges', () => {
    const touch = deriveOptionTouch([relationshipSubject('r1', 'flows_to', 'a', 'b')], new Map(), []);
    expect(touch.repointedRelationshipCount).toBe(1);
    expect(touch.replacesEdges).toEqual([]);
  });

  it('combines a real removal, an addition, a live replaces edge, and a repoint into one coherent touch', () => {
    const optionElementsById = new Map([
      ['hana', elementRow('hana', 'Hana equivalent')],
      ['x', elementRow('x', 'X')],
    ]);
    const optionRelationshipsHead = [liveRelationship('r1', 'replaces', 'hana', 'legacy')];
    const touch = deriveOptionTouch(
      [
        elementSubject('legacy', 'Legacy PM', retractDelta('legacy')),
        elementSubject('hana', 'Hana equivalent', createDelta('hana', 'Hana equivalent')),
        relationshipSubject('r1', 'replaces', 'hana', 'legacy'),
        relationshipSubject('r2', 'flows_to', 'hana', 'x'),
      ],
      optionElementsById,
      optionRelationshipsHead,
    );
    expect(touch.touchedElementIds).toEqual(new Set(['legacy', 'hana']));
    expect(touch.retiredElements).toEqual([{ id: 'legacy', name: 'Legacy PM' }]);
    expect(touch.addedElements).toEqual([{ id: 'hana', name: 'Hana equivalent' }]);
    expect(touch.replacesEdges).toEqual([{ fromElementId: 'hana', toElementId: 'legacy' }]);
    expect(touch.repointedRelationshipCount).toBe(1);
  });

  it('an element created then retracted by this same option (a net no-op) is neither added nor retired', () => {
    const touch = deriveOptionTouch([elementSubjectMulti('tmp', 'Temp', [createDelta('tmp', 'Temp'), retractDelta('tmp')])], new Map(), []);
    expect(touch.touchedElementIds.has('tmp')).toBe(true);
    expect(touch.addedElements).toEqual([]);
    expect(touch.retiredElements).toEqual([]);
  });

  it('an empty subject list produces an empty touch', () => {
    const touch = deriveOptionTouch([], new Map(), []);
    expect(touch.touchedElementIds.size).toBe(0);
    expect(touch.retiredElements).toEqual([]);
    expect(touch.addedElements).toEqual([]);
    expect(touch.replacesEdges).toEqual([]);
    expect(touch.lifecycleRetiredElements).toEqual([]);
    expect(touch.repointedRelationshipCount).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import type { Delta, RelationshipType } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { ChangeSubjectSummary } from '../../db/changeSummary';
import { deriveOptionTouch } from './optionTouch';
import { summarizeOptionChanges } from './optionChangeSummary';

function elementSubject(id: string, name: string, delta: Delta): ChangeSubjectSummary {
  return { subjectType: 'element', elementType: 'system', subjectId: id, name, deltas: [delta] };
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

function lifecycleUpdateDelta(elementId: string): Delta {
  return { kind: 'element.update', id: `update-lifecycle-${elementId}`, elementId, elementType: 'system', attribute: 'lifecycleStatus', value: 'retiring', previousDeltaId: 'prev', sourceId: 's1', confidence: 1 };
}

function relationshipSubject(id: string, relationshipType: RelationshipType, from: string, to: string): ChangeSubjectSummary {
  const delta = { kind: 'relationship.create', id: `create-${id}`, relationshipId: id, relationshipType, fromElementId: from, toElementId: to, attributes: {}, sourceId: 's1', confidence: 1 } as Delta;
  return { subjectType: 'relationship', relationshipType, subjectId: id, name: `${relationshipType} ${from} → ${to}`, deltas: [delta] };
}

function liveRelationship(id: string, relationshipType: RelationshipType, from: string, to: string): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: relationshipType, from_element_id: from, to_element_id: to, attributes: {}, exists_delta_id: `d-${id}` };
}

describe('summarizeOptionChanges', () => {
  it('returns null for an empty-delta option (no subjects touched)', () => {
    expect(summarizeOptionChanges(deriveOptionTouch([], new Map(), []))).toBeNull();
  });

  it('describes a lifecycle retirement as "Retires X"', () => {
    const optionElementsById = new Map([['pm', elementRow('pm', 'PM', 'retiring')]]);
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', lifecycleUpdateDelta('pm'))], optionElementsById, []);
    expect(summarizeOptionChanges(touch)).toBe('Retires PM');
  });

  it('describes a real removal from the model as "Removes X from the model"', () => {
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', retractDelta('pm'))], new Map(), []);
    expect(summarizeOptionChanges(touch)).toBe('Removes PM from the model');
  });

  it('describes a single addition', () => {
    const optionElementsById = new Map([['hana', elementRow('hana', 'Hana equivalent')]]);
    const touch = deriveOptionTouch([elementSubject('hana', 'Hana equivalent', createDelta('hana', 'Hana equivalent'))], optionElementsById, []);
    expect(summarizeOptionChanges(touch)).toBe('Adds Hana equivalent');
  });

  it('combines a lifecycle retirement, an addition, and a re-pointed connection into one sentence — the sprint\'s own worked "replaced by" example, with no separate "replaces" verb needed', () => {
    const optionElementsById = new Map([
      ['pm', elementRow('pm', 'PM', 'retiring')],
      ['hana', elementRow('hana', 'Hana equivalent')],
    ]);
    const optionRelationshipsHead = [liveRelationship('r1', 'replaces', 'hana', 'pm')];
    const touch = deriveOptionTouch(
      [elementSubject('pm', 'PM', lifecycleUpdateDelta('pm')), elementSubject('hana', 'Hana equivalent', createDelta('hana', 'Hana equivalent')), relationshipSubject('r2', 'flows_to', 'hana', 'x')],
      optionElementsById,
      optionRelationshipsHead,
    );
    expect(summarizeOptionChanges(touch)).toBe('Retires PM, adds Hana equivalent, re-points 1 connection');
  });

  it('pluralizes multiple retirements/removals as a count, not a name list', () => {
    const optionElementsById = new Map([
      ['a', elementRow('a', 'A', 'retiring')],
      ['b', elementRow('b', 'B', 'retiring')],
    ]);
    const touch = deriveOptionTouch([elementSubject('a', 'A', lifecycleUpdateDelta('a')), elementSubject('b', 'B', lifecycleUpdateDelta('b'))], optionElementsById, []);
    expect(summarizeOptionChanges(touch)).toBe('Retires 2 elements');
  });

  it('excludes a `replaces` edge from the "re-points" count — it is already reflected in retire/add, not a connection re-point of its own', () => {
    const optionElementsById = new Map([
      ['pm', elementRow('pm', 'PM', 'retiring')],
      ['hana', elementRow('hana', 'Hana equivalent')],
    ]);
    const optionRelationshipsHead = [liveRelationship('r1', 'replaces', 'hana', 'pm')];
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', lifecycleUpdateDelta('pm')), elementSubject('hana', 'Hana equivalent', createDelta('hana', 'Hana equivalent')), relationshipSubject('r1', 'replaces', 'hana', 'pm')], optionElementsById, optionRelationshipsHead);
    expect(summarizeOptionChanges(touch)).toBe('Retires PM, adds Hana equivalent');
  });

  it('describes a re-point alone (no retire/add) as its own sentence', () => {
    const touch = deriveOptionTouch([relationshipSubject('r1', 'flows_to', 'a', 'b'), relationshipSubject('r2', 'flows_to', 'b', 'a')], new Map(), []);
    expect(summarizeOptionChanges(touch)).toBe('Re-points 2 connections');
  });
});

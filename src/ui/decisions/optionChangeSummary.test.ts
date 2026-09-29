import { describe, expect, it } from 'vitest';
import type { Delta, RelationshipType } from '../../contracts/delta';
import type { ChangeSubjectSummary } from '../../db/changeSummary';
import { deriveOptionTouch } from './optionTouch';
import { summarizeOptionChanges } from './optionChangeSummary';

function elementSubject(id: string, name: string, delta: Delta): ChangeSubjectSummary {
  return { subjectType: 'element', elementType: 'system', subjectId: id, name, deltas: [delta] };
}

function createDelta(elementId: string, name: string): Delta {
  return { kind: 'element.create', id: `create-${elementId}`, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 's1', confidence: 1 };
}

function retractDelta(elementId: string): Delta {
  return { kind: 'element.retract', id: `retract-${elementId}`, elementId, elementType: 'system', previousDeltaId: 'prev', sourceId: 's1', confidence: 1 };
}

function relationshipSubject(id: string, relationshipType: RelationshipType, from: string, to: string): ChangeSubjectSummary {
  const delta = { kind: 'relationship.create', id: `create-${id}`, relationshipId: id, relationshipType, fromElementId: from, toElementId: to, attributes: {}, sourceId: 's1', confidence: 1 } as Delta;
  return { subjectType: 'relationship', relationshipType, subjectId: id, name: `${relationshipType} ${from} → ${to}`, deltas: [delta] };
}

describe('summarizeOptionChanges', () => {
  it('returns null for an empty-delta option (no subjects touched)', () => {
    expect(summarizeOptionChanges(deriveOptionTouch([]))).toBeNull();
  });

  it('describes a single retirement', () => {
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', retractDelta('pm'))]);
    expect(summarizeOptionChanges(touch)).toBe('Retires PM');
  });

  it('describes a single addition', () => {
    const touch = deriveOptionTouch([elementSubject('hana', 'Hana equivalent', createDelta('hana', 'Hana equivalent'))]);
    expect(summarizeOptionChanges(touch)).toBe('Adds Hana equivalent');
  });

  it('combines retire, add, and re-pointed connections into one sentence', () => {
    const touch = deriveOptionTouch([
      elementSubject('pm', 'PM', retractDelta('pm')),
      elementSubject('hana', 'Hana equivalent', createDelta('hana', 'Hana equivalent')),
      relationshipSubject('r1', 'flows_to', 'hana', 'x'),
      relationshipSubject('r2', 'flows_to', 'y', 'hana'),
    ]);
    expect(summarizeOptionChanges(touch)).toBe('Retires PM, adds Hana equivalent, re-points 2 connections');
  });

  it('pluralizes multiple retirements/additions as a count, not a name list', () => {
    const touch = deriveOptionTouch([elementSubject('a', 'A', retractDelta('a')), elementSubject('b', 'B', retractDelta('b'))]);
    expect(summarizeOptionChanges(touch)).toBe('Retires 2 elements');
  });

  it('excludes `replaces` edges from the "re-points" count — they are already reflected in retire/add, not a connection re-point of their own', () => {
    const touch = deriveOptionTouch([
      elementSubject('pm', 'PM', retractDelta('pm')),
      elementSubject('hana', 'Hana equivalent', createDelta('hana', 'Hana equivalent')),
      relationshipSubject('r1', 'replaces', 'hana', 'pm'),
    ]);
    expect(summarizeOptionChanges(touch)).toBe('Retires PM, adds Hana equivalent');
  });

  it('describes a re-point alone (no retire/add) as its own sentence', () => {
    const touch = deriveOptionTouch([relationshipSubject('r1', 'flows_to', 'a', 'b'), relationshipSubject('r2', 'flows_to', 'b', 'a')]);
    expect(summarizeOptionChanges(touch)).toBe('Re-points 2 connections');
  });
});

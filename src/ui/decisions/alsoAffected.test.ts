import { describe, expect, it } from 'vitest';
import type { Delta } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { ChangeSubjectSummary } from '../../db/changeSummary';
import { computeAlsoAffected } from './alsoAffected';
import { deriveOptionTouch } from './optionTouch';

function elementRow(id: string, type: ElementsHeadRow['element_type'], name: string): ElementsHeadRow {
  return { element_id: id, element_type: type, name, parent_id: null, attributes: {}, exists_delta_id: 'd1' };
}

function ownsEdge(id: string, actorId: string, targetId: string, role: string): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: 'owns', from_element_id: actorId, to_element_id: targetId, attributes: { role }, exists_delta_id: 'd2' };
}

function elementSubject(id: string, name: string, delta: Delta): ChangeSubjectSummary {
  return { subjectType: 'element', elementType: 'system', subjectId: id, name, deltas: [delta] };
}

function createDelta(elementId: string, name: string): Delta {
  return { kind: 'element.create', id: `create-${elementId}`, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 's1', confidence: 1 };
}

function retractDelta(elementId: string): Delta {
  return { kind: 'element.retract', id: `retract-${elementId}`, elementId, elementType: 'system', previousDeltaId: 'prev', sourceId: 's1', confidence: 1 };
}

describe('computeAlsoAffected', () => {
  it('excludes a touched element that is a declared concern', () => {
    const touch = deriveOptionTouch([elementSubject('sys1', 'Touched', createDelta('sys1', 'Touched'))]);
    const elementsById = new Map([['sys1', elementRow('sys1', 'system', 'Touched')]]);
    const result = computeAlsoAffected(touch, new Set(['sys1']), [], new Map(), [], elementsById);
    expect(result).toEqual([]);
  });

  it('includes a touched (added) element not among the declared concerns, with owners resolved from the OPTION\'s own projection', () => {
    const touch = deriveOptionTouch([elementSubject('sys1', 'Touched', createDelta('sys1', 'Touched'))]);
    const optionElementsById = new Map([
      ['sys1', elementRow('sys1', 'system', 'Touched')],
      ['owner1', elementRow('owner1', 'actor', 'Ops Team')],
    ]);
    const result = computeAlsoAffected(touch, new Set(), [], new Map(), [ownsEdge('o1', 'owner1', 'sys1', 'business')], optionElementsById);
    expect(result).toHaveLength(1);
    expect(result[0]?.element.name).toBe('Touched');
    expect(result[0]?.ownersByRole.get('business')?.[0]?.name).toBe('Ops Team');
  });

  it('excludes an element this option never touched at all', () => {
    const touch = deriveOptionTouch([]);
    const result = computeAlsoAffected(touch, new Set(), [], new Map(), [], new Map([['sys1', elementRow('sys1', 'system', 'Same')]]));
    expect(result).toEqual([]);
  });

  it("resolves a removed (retired) element, AND its owners, from MAIN's own projection — the option's own head no longer has it", () => {
    const touch = deriveOptionTouch([elementSubject('sys1', 'Retired One', retractDelta('sys1'))]);
    const mainElementsById = new Map([
      ['sys1', elementRow('sys1', 'system', 'Retired One')],
      ['owner1', elementRow('owner1', 'actor', 'Ops Team')],
    ]);
    const mainOwnsEdges = [ownsEdge('o1', 'owner1', 'sys1', 'business')];
    // The option's own projection has neither the retired element nor its owner — proof this call reads the removed case entirely off main's side.
    const result = computeAlsoAffected(touch, new Set(), mainOwnsEdges, mainElementsById, [], new Map());
    expect(result).toHaveLength(1);
    expect(result[0]?.element.name).toBe('Retired One');
    expect(result[0]?.ownersByRole.get('business')?.[0]?.name).toBe('Ops Team');
  });

  it('a retired element with a DIFFERENT owner on main than an added element has on the option — each side reads its own owners, never mixed', () => {
    const touch = deriveOptionTouch([elementSubject('retired1', 'Retired', retractDelta('retired1')), elementSubject('added1', 'Added', createDelta('added1', 'Added'))]);
    const mainElementsById = new Map([
      ['retired1', elementRow('retired1', 'system', 'Retired')],
      ['mainOwner', elementRow('mainOwner', 'actor', 'Main-side Owner')],
    ]);
    const mainOwnsEdges = [ownsEdge('o1', 'mainOwner', 'retired1', 'business')];
    const optionElementsById = new Map([
      ['added1', elementRow('added1', 'system', 'Added')],
      ['optionOwner', elementRow('optionOwner', 'actor', 'Option-side Owner')],
    ]);
    const optionOwnsEdges = [ownsEdge('o2', 'optionOwner', 'added1', 'technical')];

    const result = computeAlsoAffected(touch, new Set(), mainOwnsEdges, mainElementsById, optionOwnsEdges, optionElementsById);
    const retired = result.find((r) => r.element.element_id === 'retired1');
    const added = result.find((r) => r.element.element_id === 'added1');
    expect(retired?.ownersByRole.get('business')?.[0]?.name).toBe('Main-side Owner');
    expect(added?.ownersByRole.get('technical')?.[0]?.name).toBe('Option-side Owner');
  });
});

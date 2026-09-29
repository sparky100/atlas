import { describe, expect, it } from 'vitest';
import { emptyHead, type ElementRow, type Head, type RelationshipRow } from '../../engine/deltas';
import { computeVersionDiff } from '../../engine/versionDiff';
import { summarizeOptionChanges } from './optionChangeSummary';

function withElement(head: Head, id: string, row: ElementRow): Head {
  head.elements.set(id, row);
  return head;
}

function withRelationship(head: Head, id: string, row: RelationshipRow): Head {
  head.relationships.set(id, row);
  return head;
}

function system(name: string): ElementRow {
  return { elementType: 'system', name, parentId: null, attributes: {}, existsDeltaId: 'd1' };
}

function rel(type: RelationshipRow['relationshipType'], from: string, to: string): RelationshipRow {
  return { relationshipType: type, fromElementId: from, toElementId: to, attributes: {}, existsDeltaId: 'd2' };
}

describe('summarizeOptionChanges', () => {
  it('returns null for an empty-delta option (no elements or relationships touched)', () => {
    expect(summarizeOptionChanges(computeVersionDiff(emptyHead(), emptyHead()))).toBeNull();
  });

  it('describes a single retirement', () => {
    const asIs = withElement(emptyHead(), 'pm', system('PM'));
    const diff = computeVersionDiff(asIs, emptyHead());
    expect(summarizeOptionChanges(diff)).toBe('Retires PM');
  });

  it('describes a single addition', () => {
    const toBe = withElement(emptyHead(), 'hana', system('Hana equivalent'));
    const diff = computeVersionDiff(emptyHead(), toBe);
    expect(summarizeOptionChanges(diff)).toBe('Adds Hana equivalent');
  });

  it('combines retire, add, and re-pointed connections into one sentence', () => {
    const asIs = withElement(withRelationship(emptyHead(), 'r1', rel('flows_to', 'pm', 'x')), 'pm', system('PM'));
    let toBe = withElement(emptyHead(), 'hana', system('Hana equivalent'));
    toBe = withRelationship(toBe, 'r2', rel('flows_to', 'hana', 'x'));
    const diff = computeVersionDiff(asIs, toBe);
    expect(summarizeOptionChanges(diff)).toBe('Retires PM, adds Hana equivalent, re-points 2 connections');
  });

  it('pluralizes multiple retirements/additions as a count, not a name list', () => {
    let asIs = withElement(emptyHead(), 'a', system('A'));
    asIs = withElement(asIs, 'b', system('B'));
    const diff = computeVersionDiff(asIs, emptyHead());
    expect(summarizeOptionChanges(diff)).toBe('Retires 2 elements');
  });

  it('excludes `replaces` edges from the "re-points" count — they are already reflected in retire/add, not a connection re-point of their own', () => {
    const asIs = withElement(emptyHead(), 'pm', system('PM'));
    let toBe = withElement(emptyHead(), 'hana', system('Hana equivalent'));
    toBe = withRelationship(toBe, 'r1', rel('replaces', 'hana', 'pm'));
    const diff = computeVersionDiff(asIs, toBe);
    expect(summarizeOptionChanges(diff)).toBe('Retires PM, adds Hana equivalent');
  });

  it('describes a re-point alone (no retire/add) as its own sentence', () => {
    let asIs = withElement(emptyHead(), 'a', system('A'));
    asIs = withElement(asIs, 'b', system('B'));
    asIs = withRelationship(asIs, 'r1', rel('flows_to', 'a', 'b'));
    let toBe = withElement(emptyHead(), 'a', system('A'));
    toBe = withElement(toBe, 'b', system('B'));
    toBe = withRelationship(toBe, 'r2', rel('flows_to', 'b', 'a'));
    const diff = computeVersionDiff(asIs, toBe);
    expect(summarizeOptionChanges(diff)).toBe('Re-points 2 connections');
  });
});

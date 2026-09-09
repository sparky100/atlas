import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, FactsRow, Json, RelationshipsHeadRow } from '../contracts/rows';
import { computeStaleAttributesFinding, findCapabilitiesWithoutOwner, findSystemsWithoutCapability, findUnlabeledVerbRelationships } from './healthFindings';

function system(id: string): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name: `System ${id}`, parent_id: null, attributes: {}, exists_delta_id: `delta-${id}` };
}

function capability(id: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name: `Capability ${id}`, parent_id: null, attributes: {}, exists_delta_id: `delta-${id}` };
}

function relationship(id: string, type: RelationshipsHeadRow['relationship_type'], from: string, to: string, attributes: Record<string, Json> = {}): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: type, from_element_id: from, to_element_id: to, attributes, exists_delta_id: `delta-${id}` };
}

function fact(subjectId: string, attribute: string, dateStr: string): FactsRow {
  return { subject_type: 'element', subject_id: subjectId, attribute, value: 'x', delta_id: `delta-${subjectId}-${attribute}`, source_id: 'source-1', source_ref: null, effective_date: dateStr, confidence: 1, asserted_by: 'user-1', asserted_at: dateStr };
}

describe('findSystemsWithoutCapability', () => {
  it('returns systems with no outbound supports edge at all', () => {
    const systems = [system('sys-1'), system('sys-2')];
    const edges = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    expect(findSystemsWithoutCapability(systems, edges)).toEqual([system('sys-2')]);
  });

  it('is empty when every system supports at least one capability', () => {
    const systems = [system('sys-1')];
    const edges = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    expect(findSystemsWithoutCapability(systems, edges)).toEqual([]);
  });

  it('does not count a supports edge from a different system as covering this one', () => {
    const systems = [system('sys-1'), system('sys-2')];
    const edges = [relationship('r1', 'supports', 'sys-2', 'cap-1')];
    expect(findSystemsWithoutCapability(systems, edges).map((s) => s.element_id)).toEqual(['sys-1']);
  });
});

describe('findCapabilitiesWithoutOwner', () => {
  it('a capability is owned when a supporting system has a primary owns relationship', () => {
    const capabilities = [capability('cap-1')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    const owns = [relationship('r2', 'owns', 'actor-1', 'sys-1', { primary: true })];
    expect(findCapabilitiesWithoutOwner(capabilities, supports, owns)).toEqual([]);
  });

  it('a capability is unowned when its supporting system has no primary owns relationship', () => {
    const capabilities = [capability('cap-1')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    expect(findCapabilitiesWithoutOwner(capabilities, supports, [])).toEqual([capability('cap-1')]);
  });

  it('a non-primary owns relationship does not count as ownership', () => {
    const capabilities = [capability('cap-1')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    const owns = [relationship('r2', 'owns', 'actor-1', 'sys-1', { primary: false })];
    expect(findCapabilitiesWithoutOwner(capabilities, supports, owns)).toEqual([capability('cap-1')]);
  });

  it('a capability with no supporting system at all is unowned', () => {
    expect(findCapabilitiesWithoutOwner([capability('cap-1')], [], [])).toEqual([capability('cap-1')]);
  });

  it('ownership of an unrelated system does not cover a different capability', () => {
    const capabilities = [capability('cap-1'), capability('cap-2')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    const owns = [relationship('r2', 'owns', 'actor-1', 'sys-1', { primary: true })];
    expect(findCapabilitiesWithoutOwner(capabilities, supports, owns).map((c) => c.element_id)).toEqual(['cap-2']);
  });
});

describe('computeStaleAttributesFinding', () => {
  const now = new Date('2026-09-08T00:00:00.000Z');

  it('is all zero/null when nothing is stale', () => {
    const facts = [fact('sys-1', 'vendor', '2026-08-01')];
    expect(computeStaleAttributesFinding(facts, new Set(['sys-1']), now)).toEqual({ staleFactCount: 0, systemCount: 0, oldestAgeYears: null });
  });

  it('counts a fact older than STALE_AFTER_MONTHS as stale', () => {
    const facts = [fact('sys-1', 'vendor', '2024-01-01')];
    const result = computeStaleAttributesFinding(facts, new Set(['sys-1']), now);
    expect(result.staleFactCount).toBe(1);
    expect(result.systemCount).toBe(1);
    expect(result.oldestAgeYears).toBe(2);
  });

  it('ignores facts on subjects outside systemIds (e.g. a capability, not a system)', () => {
    const facts = [fact('cap-1', 'description', '2020-01-01')];
    expect(computeStaleAttributesFinding(facts, new Set(['sys-1']), now)).toEqual({ staleFactCount: 0, systemCount: 0, oldestAgeYears: null });
  });

  it('counts each stale (system, attribute) fact separately but counts each system once', () => {
    const facts = [fact('sys-1', 'vendor', '2024-01-01'), fact('sys-1', 'description', '2024-06-01'), fact('sys-2', 'vendor', '2023-01-01')];
    const result = computeStaleAttributesFinding(facts, new Set(['sys-1', 'sys-2']), now);
    expect(result.staleFactCount).toBe(3);
    expect(result.systemCount).toBe(2);
    expect(result.oldestAgeYears).toBe(3);
  });

  it('falls back to asserted_at when effective_date is null', () => {
    const facts: FactsRow[] = [{ ...fact('sys-1', 'vendor', ''), effective_date: null, asserted_at: '2024-01-01' }];
    const result = computeStaleAttributesFinding(facts, new Set(['sys-1']), now);
    expect(result.staleFactCount).toBe(1);
  });
});

describe('findUnlabeledVerbRelationships (Sprint U4-1 B5)', () => {
  const elementsById = new Map([
    ['sys-1', system('sys-1')],
    ['sys-2', system('sys-2')],
  ]);

  it('a uses/flows_to edge with no description attribute at all is unlabeled', () => {
    const edges = [relationship('r1', 'uses', 'sys-1', 'sys-2')];
    expect(findUnlabeledVerbRelationships(edges, elementsById)).toEqual([{ relationshipId: 'r1', relationshipType: 'uses', fromName: 'System sys-1', toName: 'System sys-2' }]);
  });

  it('a blank or whitespace-only description still counts as unlabeled, not written', () => {
    const edges = [relationship('r1', 'flows_to', 'sys-1', 'sys-2', { description: '   ' })];
    expect(findUnlabeledVerbRelationships(edges, elementsById)).toHaveLength(1);
  });

  it('a real description means the edge is not flagged', () => {
    const edges = [relationship('r1', 'uses', 'sys-1', 'sys-2', { description: 'reads customer records from' })];
    expect(findUnlabeledVerbRelationships(edges, elementsById)).toEqual([]);
  });

  it('supports/owns edges are never flagged, labeled or not — this finding is uses/flows_to only', () => {
    const edges = [relationship('r1', 'supports', 'sys-1', 'sys-2', { role: 'secondary' }), relationship('r2', 'owns', 'sys-1', 'sys-2', { primary: true })];
    expect(findUnlabeledVerbRelationships(edges, elementsById)).toEqual([]);
  });

  it('falls back to the raw element id when an endpoint is missing from elementsById', () => {
    const edges = [relationship('r1', 'uses', 'sys-1', 'sys-missing')];
    expect(findUnlabeledVerbRelationships(edges, elementsById)).toEqual([{ relationshipId: 'r1', relationshipType: 'uses', fromName: 'System sys-1', toName: 'sys-missing' }]);
  });
});

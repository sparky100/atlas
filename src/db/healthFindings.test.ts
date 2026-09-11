import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, FactsRow, Json, RelationshipsHeadRow } from '../contracts/rows';
import { computeSelfOwnedCapabilityIds, computeStaleAttributesFinding, findCapabilitiesWithoutOwner, findSystemsWithoutCapability, findSystemsWithoutTechnicalOwner, findUnlabeledVerbRelationships, isCapabilityOwnedWithAncestry } from './healthFindings';

function system(id: string): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name: `System ${id}`, parent_id: null, attributes: {}, exists_delta_id: `delta-${id}` };
}

function capability(id: string, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name: `Capability ${id}`, parent_id: parentId, attributes: {}, exists_delta_id: `delta-${id}` };
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

describe('computeSelfOwnedCapabilityIds', () => {
  it('a capability owned via a supporting system\'s business owns edge', () => {
    const capabilities = [capability('cap-1')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    const owns = [relationship('r2', 'owns', 'actor-1', 'sys-1', { role: 'business' })];
    expect(computeSelfOwnedCapabilityIds(capabilities, supports, owns)).toEqual(new Set(['cap-1']));
  });

  it('a capability owned directly (Bug found during Sprint U4-1 B3: owns can target a capability, actor→capability, not only actor→system)', () => {
    const capabilities = [capability('cap-1')];
    const owns = [relationship('r1', 'owns', 'actor-1', 'cap-1', { role: 'business' })];
    expect(computeSelfOwnedCapabilityIds(capabilities, [], owns)).toEqual(new Set(['cap-1']));
  });

  it("a technical- or service-role owns relationship does not count — this finding is specifically business ownership (Prompt 7k item 2)", () => {
    const capabilities = [capability('cap-1'), capability('cap-2')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    const owns = [relationship('r2', 'owns', 'actor-1', 'sys-1', { role: 'technical' }), relationship('r3', 'owns', 'actor-1', 'cap-2', { role: 'service' })];
    expect(computeSelfOwnedCapabilityIds(capabilities, supports, owns)).toEqual(new Set());
  });

  it('ownership of an unrelated system does not cover a different capability', () => {
    const capabilities = [capability('cap-1'), capability('cap-2')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    const owns = [relationship('r2', 'owns', 'actor-1', 'sys-1', { role: 'business' })];
    expect(computeSelfOwnedCapabilityIds(capabilities, supports, owns)).toEqual(new Set(['cap-1']));
  });
});

describe('isCapabilityOwnedWithAncestry', () => {
  it('a capability that is itself self-owned is owned, with no ancestor lookup needed', () => {
    const byId = new Map([['cap-1', capability('cap-1')]]);
    expect(isCapabilityOwnedWithAncestry(capability('cap-1'), new Set(['cap-1']), byId)).toBe(true);
  });

  it('a capability inherits ownership from its parent', () => {
    const root = capability('root');
    const child = capability('child', 'root');
    const byId = new Map([['root', root], ['child', child]]);
    expect(isCapabilityOwnedWithAncestry(child, new Set(['root']), byId)).toBe(true);
  });

  it('a capability inherits ownership from its grandparent (level 3, the deepest ADR-016 allows)', () => {
    const root = capability('root');
    const mid = capability('mid', 'root');
    const leaf = capability('leaf', 'mid');
    const byId = new Map([['root', root], ['mid', mid], ['leaf', leaf]]);
    expect(isCapabilityOwnedWithAncestry(leaf, new Set(['root']), byId)).toBe(true);
  });

  it('a capability with no owned ancestor anywhere in the chain is unowned', () => {
    const root = capability('root');
    const child = capability('child', 'root');
    const byId = new Map([['root', root], ['child', child]]);
    expect(isCapabilityOwnedWithAncestry(child, new Set(), byId)).toBe(false);
  });

  it('a sibling subtree\'s ownership does not leak across', () => {
    const root = capability('root');
    const ownedChild = capability('owned-child', 'root');
    const unownedChild = capability('unowned-child', 'root');
    const byId = new Map([['root', root], ['owned-child', ownedChild], ['unowned-child', unownedChild]]);
    expect(isCapabilityOwnedWithAncestry(unownedChild, new Set(['owned-child']), byId)).toBe(false);
  });
});

describe('findCapabilitiesWithoutOwner', () => {
  it('a capability is owned when a supporting system has a business owns relationship', () => {
    const capabilities = [capability('cap-1')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    const owns = [relationship('r2', 'owns', 'actor-1', 'sys-1', { role: 'business' })];
    expect(findCapabilitiesWithoutOwner(capabilities, supports, owns)).toEqual([]);
  });

  it('a capability with a direct owns edge is owned (Bug found during Sprint U4-1 B3)', () => {
    const capabilities = [capability('cap-1')];
    const owns = [relationship('r1', 'owns', 'actor-1', 'cap-1', { role: 'business' })];
    expect(findCapabilitiesWithoutOwner(capabilities, [], owns)).toEqual([]);
  });

  it('a capability is unowned when its supporting system has no business owns relationship', () => {
    const capabilities = [capability('cap-1')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    expect(findCapabilitiesWithoutOwner(capabilities, supports, [])).toEqual([capability('cap-1')]);
  });

  it('a technical-role owns relationship does not count as (business) ownership — Prompt 7k item 2\'s own finding is specifically about a business owner', () => {
    const capabilities = [capability('cap-1')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    const owns = [relationship('r2', 'owns', 'actor-1', 'sys-1', { role: 'technical' })];
    expect(findCapabilitiesWithoutOwner(capabilities, supports, owns)).toEqual([capability('cap-1')]);
  });

  it('a capability with no supporting system at all is unowned', () => {
    expect(findCapabilitiesWithoutOwner([capability('cap-1')], [], [])).toEqual([capability('cap-1')]);
  });

  it('ownership of an unrelated system does not cover a different capability', () => {
    const capabilities = [capability('cap-1'), capability('cap-2')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    const owns = [relationship('r2', 'owns', 'actor-1', 'sys-1', { role: 'business' })];
    expect(findCapabilitiesWithoutOwner(capabilities, supports, owns).map((c) => c.element_id)).toEqual(['cap-2']);
  });

  it('Sprint U4-1 B3: a child inherits its parent\'s ownership and is not itself listed', () => {
    const root = capability('root');
    const child = capability('child', 'root');
    const owns = [relationship('r1', 'owns', 'actor-1', 'root', { role: 'business' })];
    expect(findCapabilitiesWithoutOwner([root, child], [], owns)).toEqual([]);
  });

  it('Sprint U4-1 B3: an unowned root with unowned children lists only the root — the highest unowned ancestor', () => {
    const root = capability('root');
    const child = capability('child', 'root');
    const grandchild = capability('grandchild', 'child');
    const result = findCapabilitiesWithoutOwner([root, child, grandchild], [], []);
    expect(result.map((c) => c.element_id)).toEqual(['root']);
  });

  it('Sprint U4-1 B3: when the root is owned, every child inherits regardless of its own edges', () => {
    const root = capability('root'); // owned directly
    const childA = capability('child-a', 'root');
    const childB = capability('child-b', 'root');
    const owns = [relationship('r1', 'owns', 'actor-1', 'root', { role: 'business' })];
    const result = findCapabilitiesWithoutOwner([root, childA, childB], [], owns);
    expect(result).toEqual([]);
  });
});

describe('findSystemsWithoutTechnicalOwner (Prompt 7k item 2)', () => {
  it('returns systems with no owns edge carrying role: technical', () => {
    const systems = [system('sys-1'), system('sys-2')];
    const owns = [relationship('r1', 'owns', 'actor-1', 'sys-1', { role: 'technical' })];
    expect(findSystemsWithoutTechnicalOwner(systems, owns).map((s) => s.element_id)).toEqual(['sys-2']);
  });

  it('a business-role owns edge does not count as a technical owner', () => {
    const systems = [system('sys-1')];
    const owns = [relationship('r1', 'owns', 'actor-1', 'sys-1', { role: 'business' })];
    expect(findSystemsWithoutTechnicalOwner(systems, owns).map((s) => s.element_id)).toEqual(['sys-1']);
  });

  it('is empty when every system has a technical owner', () => {
    const systems = [system('sys-1')];
    const owns = [relationship('r1', 'owns', 'actor-1', 'sys-1', { role: 'technical' })];
    expect(findSystemsWithoutTechnicalOwner(systems, owns)).toEqual([]);
  });
});

describe('computeStaleAttributesFinding', () => {
  const now = new Date('2026-09-08T00:00:00.000Z');

  it('is all zero/empty/null when nothing is stale', () => {
    const facts = [fact('sys-1', 'vendor', '2026-08-01')];
    expect(computeStaleAttributesFinding(facts, [system('sys-1')], now)).toEqual({ staleFactCount: 0, staleSystems: [], oldestAgeYears: null });
  });

  it('counts a fact older than STALE_AFTER_MONTHS as stale', () => {
    const facts = [fact('sys-1', 'vendor', '2024-01-01')];
    const result = computeStaleAttributesFinding(facts, [system('sys-1')], now);
    expect(result.staleFactCount).toBe(1);
    expect(result.staleSystems).toEqual([system('sys-1')]);
    expect(result.oldestAgeYears).toBe(2);
  });

  it('ignores facts on subjects outside the given systems (e.g. a capability, not a system)', () => {
    const facts = [fact('cap-1', 'description', '2020-01-01')];
    expect(computeStaleAttributesFinding(facts, [system('sys-1')], now)).toEqual({ staleFactCount: 0, staleSystems: [], oldestAgeYears: null });
  });

  it('counts each stale (system, attribute) fact separately but lists each system once, sorted by name', () => {
    const facts = [fact('sys-1', 'vendor', '2024-01-01'), fact('sys-1', 'description', '2024-06-01'), fact('sys-2', 'vendor', '2023-01-01')];
    const result = computeStaleAttributesFinding(facts, [system('sys-2'), system('sys-1')], now);
    expect(result.staleFactCount).toBe(3);
    expect(result.staleSystems).toEqual([system('sys-1'), system('sys-2')]);
    expect(result.oldestAgeYears).toBe(3);
  });

  it('falls back to asserted_at when effective_date is null', () => {
    const facts: FactsRow[] = [{ ...fact('sys-1', 'vendor', ''), effective_date: null, asserted_at: '2024-01-01' }];
    const result = computeStaleAttributesFinding(facts, [system('sys-1')], now);
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
    const edges = [relationship('r1', 'supports', 'sys-1', 'sys-2', { role: 'secondary' }), relationship('r2', 'owns', 'sys-1', 'sys-2', { role: 'business' })];
    expect(findUnlabeledVerbRelationships(edges, elementsById)).toEqual([]);
  });

  it('falls back to the raw element id when an endpoint is missing from elementsById', () => {
    const edges = [relationship('r1', 'uses', 'sys-1', 'sys-missing')];
    expect(findUnlabeledVerbRelationships(edges, elementsById)).toEqual([{ relationshipId: 'r1', relationshipType: 'uses', fromName: 'System sys-1', toName: 'sys-missing' }]);
  });
});

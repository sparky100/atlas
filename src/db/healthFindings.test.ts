import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, FactsRow, Json, RelationshipsHeadRow } from '../contracts/rows';
import {
  findOutgoingWithoutRetiringChange,
  computeSelfOwnedCapabilityIds,
  computeStaleAttributesFinding,
  findBoundaryCrossings,
  findBoundaryCrossingsMissingClassification,
  findBoundaryCrossingsMissingVerb,
  findCapabilitiesWithNoSupporters,
  findCapabilitiesWithoutOwner,
  findCriticalExposedSystems,
  findCriticalSystemsPastOrNearSupportEnd,
  findCriticalSystemsWithoutBusinessOwner,
  findExternalInterfacesMissingClassification,
  findExternalOrganisationAccess,
  findFlowsToPlatformInsteadOfModule,
  findPlatformSupportsThatShouldMoveToModule,
  findSystemsSupportingEssentialFunctionWithoutTechnicalOwner,
  findSystemsWithoutCapability,
  findSystemsWithoutTechnicalOwner,
  findUnlabeledVerbRelationships,
  findUnusedIntegrationInterfaces,
  findUnusedIntegrationPlatforms,
  isCapabilityOwnedWithAncestry,
} from './healthFindings';

function system(id: string, attributes: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name: `System ${id}`, parent_id: null, attributes, exists_delta_id: `delta-${id}` };
}

function container(id: string, parentId: string, attributes: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'container', name: `Container ${id}`, parent_id: parentId, attributes, exists_delta_id: `delta-${id}` };
}

function actor(id: string, attributes: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'actor', name: `Actor ${id}`, parent_id: null, attributes, exists_delta_id: `delta-${id}` };
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

  // S1 item 19: SAP (a platform) with FI and PM as its own modules, each
  // independently supporting a capability — SAP itself never carries a
  // `supports` edge, since "Platforms and modules" puts that on the module.
  it('a platform with modules counts as linked if any module supports a capability, even with no supports edge of its own', () => {
    const systems = [system('sap', { kind: 'platform' })];
    const containers = [container('fi', 'sap'), container('pm', 'sap')];
    const edges = [relationship('r1', 'supports', 'fi', 'finance'), relationship('r2', 'supports', 'pm', 'asset-mgmt')];
    expect(findSystemsWithoutCapability(systems, edges, containers)).toEqual([]);
  });

  it('a platform with modules is still flagged if none of its modules supports a capability', () => {
    const systems = [system('sap', { kind: 'platform' })];
    const containers = [container('fi', 'sap'), container('pm', 'sap')];
    expect(findSystemsWithoutCapability(systems, [], containers).map((s) => s.element_id)).toEqual(['sap']);
  });

  it('a platform with no modules at all is judged on its own supports edge, same as an ordinary system', () => {
    const linked = [system('sap-linked', { kind: 'platform' })];
    const linkedEdges = [relationship('r1', 'supports', 'sap-linked', 'finance')];
    expect(findSystemsWithoutCapability(linked, linkedEdges, [])).toEqual([]);

    const unlinked = [system('sap-unlinked', { kind: 'platform' })];
    expect(findSystemsWithoutCapability(unlinked, [], []).map((s) => s.element_id)).toEqual(['sap-unlinked']);
  });
});

describe('findPlatformSupportsThatShouldMoveToModule', () => {
  it('flags a platform with modules that itself carries a direct supports edge', () => {
    const systems = [system('sap', { kind: 'platform' })];
    const containers = [container('fi', 'sap'), container('pm', 'sap')];
    const edges = [relationship('r1', 'supports', 'sap', 'finance')];
    expect(findPlatformSupportsThatShouldMoveToModule(systems, edges, containers).map((s) => s.element_id)).toEqual(['sap']);
  });

  it('does not flag a platform whose modules (not the platform itself) carry the supports edges', () => {
    const systems = [system('sap', { kind: 'platform' })];
    const containers = [container('fi', 'sap'), container('pm', 'sap')];
    const edges = [relationship('r1', 'supports', 'fi', 'finance'), relationship('r2', 'supports', 'pm', 'asset-mgmt')];
    expect(findPlatformSupportsThatShouldMoveToModule(systems, edges, containers)).toEqual([]);
  });

  it('does not flag a platform with no modules — there is nowhere lower to move the edge', () => {
    const systems = [system('sap', { kind: 'platform' })];
    const edges = [relationship('r1', 'supports', 'sap', 'finance')];
    expect(findPlatformSupportsThatShouldMoveToModule(systems, edges, [])).toEqual([]);
  });

  it('does not flag an ordinary (non-platform) system with its own supports edge', () => {
    const systems = [system('sys-1')];
    const edges = [relationship('r1', 'supports', 'sys-1', 'finance')];
    expect(findPlatformSupportsThatShouldMoveToModule(systems, edges, [])).toEqual([]);
  });
});

function elementsMap(...elements: ElementsHeadRow[]): Map<string, ElementsHeadRow> {
  return new Map(elements.map((e) => [e.element_id, e]));
}

describe('findFlowsToPlatformInsteadOfModule', () => {
  it('flags a flows_to edge naming a platform-with-modules directly, on the "to" side', () => {
    const sap = system('sap', { kind: 'platform' });
    const fi = container('fi', 'sap');
    const salesforce = system('salesforce');
    const elementsById = elementsMap(sap, fi, salesforce);
    const edges = [relationship('r1', 'flows_to', 'salesforce', 'sap')];
    expect(findFlowsToPlatformInsteadOfModule(edges, elementsById)).toEqual([
      { relationshipId: 'r1', relationshipType: 'flows_to', fromName: 'System salesforce', toName: 'System sap', platformSide: 'to' },
    ]);
  });

  it('flags a uses edge naming a platform-with-modules directly, on the "from" side', () => {
    const sap = system('sap', { kind: 'platform' });
    const fi = container('fi', 'sap');
    const other = system('other');
    const elementsById = elementsMap(sap, fi, other);
    const edges = [relationship('r1', 'uses', 'sap', 'other')];
    expect(findFlowsToPlatformInsteadOfModule(edges, elementsById)).toEqual([
      { relationshipId: 'r1', relationshipType: 'uses', fromName: 'System sap', toName: 'System other', platformSide: 'from' },
    ]);
  });

  it('flags both sides as "both" when two platforms-with-modules flow to each other directly', () => {
    const sap = system('sap', { kind: 'platform' });
    const fi = container('fi', 'sap');
    const crm = system('crm', { kind: 'platform' });
    const crmModule = container('crm-module', 'crm');
    const elementsById = elementsMap(sap, fi, crm, crmModule);
    const edges = [relationship('r1', 'flows_to', 'sap', 'crm')];
    expect(findFlowsToPlatformInsteadOfModule(edges, elementsById)).toEqual([
      { relationshipId: 'r1', relationshipType: 'flows_to', fromName: 'System sap', toName: 'System crm', platformSide: 'both' },
    ]);
  });

  it('does not flag a flow that names the module, not the platform', () => {
    const sap = system('sap', { kind: 'platform' });
    const fi = container('fi', 'sap');
    const salesforce = system('salesforce');
    const elementsById = elementsMap(sap, fi, salesforce);
    const edges = [relationship('r1', 'flows_to', 'salesforce', 'fi')];
    expect(findFlowsToPlatformInsteadOfModule(edges, elementsById)).toEqual([]);
  });

  it('does not flag a platform with no modules — there is nowhere lower to point the edge', () => {
    const sap = system('sap', { kind: 'platform' });
    const salesforce = system('salesforce');
    const elementsById = elementsMap(sap, salesforce);
    const edges = [relationship('r1', 'flows_to', 'salesforce', 'sap')];
    expect(findFlowsToPlatformInsteadOfModule(edges, elementsById)).toEqual([]);
  });

  it('does not flag an ordinary (non-platform) system endpoint', () => {
    const a = system('a');
    const b = system('b');
    const elementsById = elementsMap(a, b);
    const edges = [relationship('r1', 'flows_to', 'a', 'b')];
    expect(findFlowsToPlatformInsteadOfModule(edges, elementsById)).toEqual([]);
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

  it('a platform module without its own technical owner is caught too, independently of its platform', () => {
    const sap = system('sap');
    const fi = container('fi', 'sap');
    const pm = container('pm', 'sap');
    const owns = [relationship('r1', 'owns', 'actor-1', 'sap', { role: 'technical' }), relationship('r2', 'owns', 'actor-1', 'fi', { role: 'technical' })];
    expect(findSystemsWithoutTechnicalOwner([sap, fi, pm], owns).map((e) => e.element_id)).toEqual(['pm']);
  });
});

describe('findCriticalSystemsWithoutBusinessOwner (Prompt 7k item 1)', () => {
  it('returns only critical systems, and only those with no business-role owns edge', () => {
    const systems = [system('sys-1', { criticality: 'critical' }), system('sys-2', { criticality: 'low' }), system('sys-3', { criticality: 'critical' })];
    const owns = [relationship('r1', 'owns', 'actor-1', 'sys-3', { role: 'business' })];
    expect(findCriticalSystemsWithoutBusinessOwner(systems, owns).map((s) => s.element_id)).toEqual(['sys-1']);
  });

  it('a technical-role owns edge does not count as a business owner', () => {
    const systems = [system('sys-1', { criticality: 'critical' })];
    const owns = [relationship('r1', 'owns', 'actor-1', 'sys-1', { role: 'technical' })];
    expect(findCriticalSystemsWithoutBusinessOwner(systems, owns).map((s) => s.element_id)).toEqual(['sys-1']);
  });

  it('a system with no recorded criticality at all is never flagged', () => {
    const systems = [system('sys-1')];
    expect(findCriticalSystemsWithoutBusinessOwner(systems, [])).toEqual([]);
  });

  it('is empty when every critical system has a business owner', () => {
    const systems = [system('sys-1', { criticality: 'critical' })];
    const owns = [relationship('r1', 'owns', 'actor-1', 'sys-1', { role: 'business' })];
    expect(findCriticalSystemsWithoutBusinessOwner(systems, owns)).toEqual([]);
  });

  it('a critical module rated independently of its platform is flagged too, same as a critical system', () => {
    const sap = system('sap', { criticality: 'low' });
    const fi = container('fi', 'sap', { criticality: 'critical' });
    expect(findCriticalSystemsWithoutBusinessOwner([sap, fi], []).map((e) => e.element_id)).toEqual(['fi']);
  });
});

describe('findCriticalExposedSystems (Prompt 7k item 1)', () => {
  const now = new Date('2026-06-15T00:00:00Z');

  it('flags a critical system whose plannedEnd falls within STALE_AFTER_MONTHS (12)', () => {
    const systems = [system('sys-1', { criticality: 'critical', plannedEnd: '2027-01-01' })]; // ~6.5 months out
    expect(findCriticalExposedSystems(systems, now).map((s) => s.element_id)).toEqual(['sys-1']);
  });

  it('flags a critical system already past its planned end (more exposed, not less)', () => {
    const systems = [system('sys-1', { criticality: 'critical', plannedEnd: '2026-01-01' })];
    expect(findCriticalExposedSystems(systems, now).map((s) => s.element_id)).toEqual(['sys-1']);
  });

  it('does not flag a non-critical system with the same near plannedEnd', () => {
    const systems = [system('sys-1', { criticality: 'medium', plannedEnd: '2027-01-01' })];
    expect(findCriticalExposedSystems(systems, now)).toEqual([]);
  });

  it('does not flag a critical system whose plannedEnd is well beyond the 12-month horizon', () => {
    const systems = [system('sys-1', { criticality: 'critical', plannedEnd: '2030-01-01' })];
    expect(findCriticalExposedSystems(systems, now)).toEqual([]);
  });

  it('does not flag a critical system with no plannedEnd at all', () => {
    const systems = [system('sys-1', { criticality: 'critical' })];
    expect(findCriticalExposedSystems(systems, now)).toEqual([]);
  });

  it('does not flag a system with a recorded replacement, however near or past its plannedEnd (ADR-001 amendment)', () => {
    const systems = [system('sys-1', { criticality: 'critical', plannedEnd: '2026-01-01' }), system('sys-2', { criticality: 'critical', plannedEnd: '2027-01-01' })];
    expect(findCriticalExposedSystems(systems, now, new Set(['sys-1'])).map((s) => s.element_id)).toEqual(['sys-2']);
  });
});

describe('computeStaleAttributesFinding', () => {
  const now = new Date('2026-09-08T00:00:00.000Z');

  it('is all zero/empty/null when nothing is stale', () => {
    const facts = [fact('sys-1', 'vendor', '2026-08-01')];
    expect(computeStaleAttributesFinding(facts, [system('sys-1')], now)).toEqual({ staleFactCount: 0, staleElements: [], oldestAgeYears: null });
  });

  it('counts a fact older than STALE_AFTER_MONTHS as stale', () => {
    const facts = [fact('sys-1', 'vendor', '2024-01-01')];
    const result = computeStaleAttributesFinding(facts, [system('sys-1')], now);
    expect(result.staleFactCount).toBe(1);
    expect(result.staleElements).toEqual([system('sys-1')]);
    expect(result.oldestAgeYears).toBe(2);
  });

  it('ignores facts on subjects outside the given systems (e.g. a capability, not a system)', () => {
    const facts = [fact('cap-1', 'description', '2020-01-01')];
    expect(computeStaleAttributesFinding(facts, [system('sys-1')], now)).toEqual({ staleFactCount: 0, staleElements: [], oldestAgeYears: null });
  });

  it('counts each stale (system, attribute) fact separately but lists each system once, sorted by name', () => {
    const facts = [fact('sys-1', 'vendor', '2024-01-01'), fact('sys-1', 'description', '2024-06-01'), fact('sys-2', 'vendor', '2023-01-01')];
    const result = computeStaleAttributesFinding(facts, [system('sys-2'), system('sys-1')], now);
    expect(result.staleFactCount).toBe(3);
    expect(result.staleElements).toEqual([system('sys-1'), system('sys-2')]);
    expect(result.oldestAgeYears).toBe(3);
  });

  it('ignores the $exists fact, so confirming an element clears it', () => {
    const facts = [fact('sys-1', '$exists', '2020-01-01'), fact('sys-1', 'vendor', '2026-08-01')];
    expect(computeStaleAttributesFinding(facts, [system('sys-1')], now)).toEqual({ staleFactCount: 0, staleElements: [], oldestAgeYears: null });
  });

  it("uses the organisation's own threshold", () => {
    const facts = [fact('sys-1', 'vendor', '2026-01-01')];
    expect(computeStaleAttributesFinding(facts, [system('sys-1')], now).staleFactCount).toBe(0);
    expect(computeStaleAttributesFinding(facts, [system('sys-1')], now, 6).staleFactCount).toBe(1);
  });

  it('covers every element type, not only systems', () => {
    const facts = [fact('cap-1', 'description', '2020-01-01'), fact('act-1', 'description', '2020-01-01')];
    const result = computeStaleAttributesFinding(facts, [capability('cap-1', null), actor('act-1', {})], now);
    expect(result.staleFactCount).toBe(2);
    expect(result.staleElements.map((e) => e.element_id)).toEqual(['act-1', 'cap-1']);
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

describe('findBoundaryCrossings (Prompt 7k item 3)', () => {
  it('flags a uses/flows_to edge between an it and an ot system, either direction', () => {
    const elementsById = new Map([
      ['sys-it', system('sys-it')],
      ['sys-ot', system('sys-ot', { domain: 'ot' })],
    ]);
    const edges = [relationship('r1', 'uses', 'sys-it', 'sys-ot'), relationship('r2', 'flows_to', 'sys-ot', 'sys-it')];
    const crossings = findBoundaryCrossings(edges, elementsById);
    expect(crossings.map((c) => c.relationshipId)).toEqual(['r1', 'r2']);
    expect(crossings[0]).toMatchObject({ fromDomain: 'it', toDomain: 'ot' });
  });

  it('does not flag an edge between two it systems, or two ot systems', () => {
    const elementsById = new Map([
      ['sys-it-1', system('sys-it-1')],
      ['sys-it-2', system('sys-it-2')],
      ['sys-ot-1', system('sys-ot-1', { domain: 'ot' })],
      ['sys-ot-2', system('sys-ot-2', { domain: 'ot' })],
    ]);
    const edges = [relationship('r1', 'uses', 'sys-it-1', 'sys-it-2'), relationship('r2', 'uses', 'sys-ot-1', 'sys-ot-2')];
    expect(findBoundaryCrossings(edges, elementsById)).toEqual([]);
  });

  it('a hybrid endpoint never participates in a crossing, on either side', () => {
    const elementsById = new Map([
      ['sys-hybrid', system('sys-hybrid', { domain: 'hybrid' })],
      ['sys-ot', system('sys-ot', { domain: 'ot' })],
      ['sys-it', system('sys-it')],
    ]);
    const edges = [relationship('r1', 'uses', 'sys-hybrid', 'sys-ot'), relationship('r2', 'uses', 'sys-hybrid', 'sys-it')];
    expect(findBoundaryCrossings(edges, elementsById)).toEqual([]);
  });

  it('a container endpoint resolves its domain from its parent system', () => {
    const sys = system('sys-ot', { domain: 'ot' });
    const cont = container('cont-1', 'sys-ot');
    const elementsById = new Map([
      ['sys-ot', sys],
      ['cont-1', cont],
      ['sys-it', system('sys-it')],
    ]);
    const edges = [relationship('r1', 'uses', 'cont-1', 'sys-it')];
    const crossings = findBoundaryCrossings(edges, elementsById);
    expect(crossings).toHaveLength(1);
    expect(crossings[0]).toMatchObject({ fromDomain: 'ot', toDomain: 'it' });
  });

  it('supports/owns edges are never crossings, even between it and ot systems', () => {
    const elementsById = new Map([
      ['sys-it', system('sys-it')],
      ['sys-ot', system('sys-ot', { domain: 'ot' })],
    ]);
    const edges = [relationship('r1', 'supports', 'sys-it', 'sys-ot')];
    expect(findBoundaryCrossings(edges, elementsById)).toEqual([]);
  });

  it('records whether a verb and (for flows_to) a data classification are missing', () => {
    const elementsById = new Map([
      ['sys-it', system('sys-it')],
      ['sys-ot', system('sys-ot', { domain: 'ot' })],
    ]);
    const edges = [relationship('r1', 'flows_to', 'sys-it', 'sys-ot', { description: 'sends readings to', dataClassification: 'official' })];
    expect(findBoundaryCrossings(edges, elementsById)).toEqual([
      { relationshipId: 'r1', relationshipType: 'flows_to', fromElementId: 'sys-it', toElementId: 'sys-ot', fromName: 'System sys-it', toName: 'System sys-ot', fromDomain: 'it', toDomain: 'ot', missingVerb: false, missingDataClassification: false },
    ]);
  });

  it('a uses crossing is never flagged for missing data classification — uses has no such attribute', () => {
    const elementsById = new Map([
      ['sys-it', system('sys-it')],
      ['sys-ot', system('sys-ot', { domain: 'ot' })],
    ]);
    const edges = [relationship('r1', 'uses', 'sys-it', 'sys-ot', { description: 'polls' })];
    expect(findBoundaryCrossings(edges, elementsById)[0]).toMatchObject({ missingVerb: false, missingDataClassification: false });
  });
});

describe('findBoundaryCrossingsMissingVerb (Prompt 7k item 3)', () => {
  const elementsById = new Map([
    ['sys-it', system('sys-it')],
    ['sys-ot', system('sys-ot', { domain: 'ot' })],
  ]);

  it('flags a crossing with no verb-phrase label', () => {
    const edges = [relationship('r1', 'uses', 'sys-it', 'sys-ot')];
    expect(findBoundaryCrossingsMissingVerb(edges, elementsById).map((c) => c.relationshipId)).toEqual(['r1']);
  });

  // Narrowed deliberately: a flows_to crossing that has a verb but no data
  // classification is Assurance's own finding (findBoundaryCrossingsMissingClassification)
  // alone, not this one too — the two used to overlap, showing the same
  // crossing under both "Health findings" and "Assurance" for what read as
  // the same reason (found during a walkthrough).
  it('does not flag a flows_to crossing that has a verb but is missing only its data classification', () => {
    const edges = [relationship('r1', 'flows_to', 'sys-it', 'sys-ot', { description: 'sends readings to' })];
    expect(findBoundaryCrossingsMissingVerb(edges, elementsById)).toEqual([]);
  });

  it('does not flag a fully-classified crossing', () => {
    const edges = [relationship('r1', 'flows_to', 'sys-it', 'sys-ot', { description: 'sends readings to', dataClassification: 'official' })];
    expect(findBoundaryCrossingsMissingVerb(edges, elementsById)).toEqual([]);
  });

  it('does not flag a non-crossing edge at all, regardless of metadata', () => {
    const bothIt = new Map([
      ['sys-it-1', system('sys-it-1')],
      ['sys-it-2', system('sys-it-2')],
    ]);
    const edges = [relationship('r1', 'uses', 'sys-it-1', 'sys-it-2')];
    expect(findBoundaryCrossingsMissingVerb(edges, bothIt)).toEqual([]);
  });
});

describe('findUnusedIntegrationPlatforms (Prompt 7k item 4)', () => {
  it('flags a kind: integration_platform system with no edge naming it as via', () => {
    const systems = [system('sys-esb', { kind: 'integration_platform' })];
    expect(findUnusedIntegrationPlatforms(systems, [])).toEqual([system('sys-esb', { kind: 'integration_platform' })]);
  });

  it('does not flag a platform that at least one edge routes via', () => {
    const systems = [system('sys-esb', { kind: 'integration_platform' })];
    const edges = [relationship('r1', 'flows_to', 'sys-a', 'sys-b', { via: 'sys-esb' })];
    expect(findUnusedIntegrationPlatforms(systems, edges)).toEqual([]);
  });

  it('never flags a system whose kind is not integration_platform, whether or not it is used', () => {
    const systems = [system('sys-app'), system('sys-data', { kind: 'data_platform' })];
    expect(findUnusedIntegrationPlatforms(systems, [])).toEqual([]);
  });

  it('a via naming a different platform does not clear this one', () => {
    const systems = [system('sys-esb-a', { kind: 'integration_platform' }), system('sys-esb-b', { kind: 'integration_platform' })];
    const edges = [relationship('r1', 'uses', 'sys-a', 'sys-b', { via: 'sys-esb-b' })];
    expect(findUnusedIntegrationPlatforms(systems, edges).map((s) => s.element_id)).toEqual(['sys-esb-a']);
  });
});

describe('integration interfaces (ADR-026)', () => {
  const esb = system('sys-esb', { kind: 'integration_platform' });

  it('a via naming one of the platform\'s interfaces counts as the platform being used', () => {
    const edges = [relationship('r1', 'flows_to', 'sys-a', 'sys-b', { via: 'if-api' })];
    expect(findUnusedIntegrationPlatforms([esb], edges, [container('if-api', 'sys-esb')])).toEqual([]);
  });

  it('flags an interface nothing flows via, named Platform · Interface', () => {
    const containers = [container('if-api', 'sys-esb'), container('if-file', 'sys-esb')];
    const edges = [relationship('r1', 'flows_to', 'sys-a', 'sys-b', { via: 'if-api' })];
    expect(findUnusedIntegrationInterfaces([{ ...esb, name: 'ESB' }], containers, edges).map((c) => [c.element_id, c.name])).toEqual([['if-file', 'ESB · Container if-file']]);
  });

  it('a flow via the platform itself does not clear its interfaces', () => {
    const edges = [relationship('r1', 'uses', 'sys-a', 'sys-b', { via: 'sys-esb' })];
    expect(findUnusedIntegrationInterfaces([esb], [container('if-api', 'sys-esb')], edges).map((c) => c.element_id)).toEqual(['if-api']);
  });

  it('never flags a module of an ordinary platform', () => {
    expect(findUnusedIntegrationInterfaces([system('sap')], [container('pm', 'sap')], [])).toEqual([]);
  });
});

describe('findSystemsSupportingEssentialFunctionWithoutTechnicalOwner (Prompt 7k item 5)', () => {
  it('flags a system supporting an essentialFunction capability with no technical owner', () => {
    const systems = [system('sys-1')];
    const capabilities = [{ ...capability('cap-1'), attributes: { essentialFunction: true } }];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    expect(findSystemsSupportingEssentialFunctionWithoutTechnicalOwner(systems, capabilities, supports, [])).toEqual(systems);
  });

  it('does not flag it once a technical owner exists', () => {
    const systems = [system('sys-1')];
    const capabilities = [{ ...capability('cap-1'), attributes: { essentialFunction: true } }];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    const owns = [relationship('r2', 'owns', 'actor-1', 'sys-1', { role: 'technical' })];
    expect(findSystemsSupportingEssentialFunctionWithoutTechnicalOwner(systems, capabilities, supports, owns)).toEqual([]);
  });

  it('a business-role owns edge does not count as a technical owner', () => {
    const systems = [system('sys-1')];
    const capabilities = [{ ...capability('cap-1'), attributes: { essentialFunction: true } }];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    const owns = [relationship('r2', 'owns', 'actor-1', 'sys-1', { role: 'business' })];
    expect(findSystemsSupportingEssentialFunctionWithoutTechnicalOwner(systems, capabilities, supports, owns).map((s) => s.element_id)).toEqual(['sys-1']);
  });

  it('a system supporting a non-essential capability is never flagged, even with no technical owner', () => {
    const systems = [system('sys-1')];
    const capabilities = [capability('cap-1')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1')];
    expect(findSystemsSupportingEssentialFunctionWithoutTechnicalOwner(systems, capabilities, supports, [])).toEqual([]);
  });

  it('is empty with no capabilities marked essentialFunction at all', () => {
    const systems = [system('sys-1')];
    expect(findSystemsSupportingEssentialFunctionWithoutTechnicalOwner(systems, [capability('cap-1')], [], [])).toEqual([]);
  });

  it('a module supporting an essential-function capability directly (not via its platform) is flagged too', () => {
    const sap = system('sap');
    const fi = container('fi', 'sap');
    const capabilities = [{ ...capability('cap-1'), attributes: { essentialFunction: true } }];
    const supports = [relationship('r1', 'supports', 'fi', 'cap-1')];
    expect(findSystemsSupportingEssentialFunctionWithoutTechnicalOwner([sap, fi], capabilities, supports, []).map((e) => e.element_id)).toEqual(['fi']);
  });
});

describe('findBoundaryCrossingsMissingClassification (Prompt 7k item 5)', () => {
  const itOt = new Map([
    ['sys-it', system('sys-it', { domain: 'it' })],
    ['sys-ot', system('sys-ot', { domain: 'ot' })],
  ]);

  it('flags a flows_to crossing with a verb but no data classification', () => {
    const edges = [relationship('r1', 'flows_to', 'sys-it', 'sys-ot', { description: 'sends readings to' })];
    expect(findBoundaryCrossingsMissingClassification(edges, itOt).map((c) => c.relationshipId)).toEqual(['r1']);
  });

  it('does not flag a crossing missing only its verb — that is item 3\'s own wider finding, not this one', () => {
    const edges = [relationship('r1', 'flows_to', 'sys-it', 'sys-ot', { dataClassification: 'official' })];
    expect(findBoundaryCrossingsMissingClassification(edges, itOt)).toEqual([]);
  });

  it('does not flag a fully-classified crossing', () => {
    const edges = [relationship('r1', 'flows_to', 'sys-it', 'sys-ot', { description: 'sends readings to', dataClassification: 'official' })];
    expect(findBoundaryCrossingsMissingClassification(edges, itOt)).toEqual([]);
  });

  it('a uses crossing is never flagged — uses has no dataClassification attribute to be missing', () => {
    const edges = [relationship('r1', 'uses', 'sys-it', 'sys-ot')];
    expect(findBoundaryCrossingsMissingClassification(edges, itOt)).toEqual([]);
  });
});

describe('findCriticalSystemsPastOrNearSupportEnd (Prompt 7k item 5)', () => {
  const now = new Date('2026-06-15T00:00:00Z');

  it('flags a critical system whose supportEndsAt falls within STALE_AFTER_MONTHS (12)', () => {
    const systems = [system('sys-1', { criticality: 'critical', supportEndsAt: '2027-01-01' })];
    expect(findCriticalSystemsPastOrNearSupportEnd(systems, now).map((s) => s.element_id)).toEqual(['sys-1']);
  });

  it('flags a critical system already past vendor support end (more exposed, not less)', () => {
    const systems = [system('sys-1', { criticality: 'critical', supportEndsAt: '2026-01-01' })];
    expect(findCriticalSystemsPastOrNearSupportEnd(systems, now).map((s) => s.element_id)).toEqual(['sys-1']);
  });

  it('does not flag a non-critical system with the same near supportEndsAt', () => {
    const systems = [system('sys-1', { criticality: 'medium', supportEndsAt: '2027-01-01' })];
    expect(findCriticalSystemsPastOrNearSupportEnd(systems, now)).toEqual([]);
  });

  it('does not flag a critical system whose supportEndsAt is well beyond the 12-month horizon', () => {
    const systems = [system('sys-1', { criticality: 'critical', supportEndsAt: '2030-01-01' })];
    expect(findCriticalSystemsPastOrNearSupportEnd(systems, now)).toEqual([]);
  });

  it('does not flag a critical system with no supportEndsAt at all, even with a near plannedEnd', () => {
    const systems = [system('sys-1', { criticality: 'critical', plannedEnd: '2027-01-01' })];
    expect(findCriticalSystemsPastOrNearSupportEnd(systems, now)).toEqual([]);
  });
});

describe('findExternalInterfacesMissingClassification (S1 item 11a)', () => {
  it('flags a flows_to edge between an internal and an external system with no data classification', () => {
    const elementsById = new Map([
      ['sys-int', system('sys-int')],
      ['sys-ext', system('sys-ext', { isExternal: true })],
    ]);
    const edges = [relationship('r1', 'flows_to', 'sys-int', 'sys-ext')];
    expect(findExternalInterfacesMissingClassification(edges, elementsById)).toEqual([{ relationshipId: 'r1', relationshipType: 'flows_to', fromElementId: 'sys-int', toElementId: 'sys-ext', fromName: 'System sys-int', toName: 'System sys-ext' }]);
  });

  it('a system with only externalOrganisation set (not isExternal) still counts as the external side', () => {
    const elementsById = new Map([
      ['sys-int', system('sys-int')],
      ['sys-ext', system('sys-ext', { externalOrganisation: 'Acme Supplier' })],
    ]);
    const edges = [relationship('r1', 'flows_to', 'sys-int', 'sys-ext')];
    expect(findExternalInterfacesMissingClassification(edges, elementsById)).toHaveLength(1);
  });

  it('is not flagged once a data classification is recorded', () => {
    const elementsById = new Map([
      ['sys-int', system('sys-int')],
      ['sys-ext', system('sys-ext', { isExternal: true })],
    ]);
    const edges = [relationship('r1', 'flows_to', 'sys-int', 'sys-ext', { dataClassification: 'official' })];
    expect(findExternalInterfacesMissingClassification(edges, elementsById)).toEqual([]);
  });

  it('never flagged when both endpoints are internal', () => {
    const elementsById = new Map([
      ['sys-a', system('sys-a')],
      ['sys-b', system('sys-b')],
    ]);
    const edges = [relationship('r1', 'flows_to', 'sys-a', 'sys-b')];
    expect(findExternalInterfacesMissingClassification(edges, elementsById)).toEqual([]);
  });

  it('never flagged when both endpoints are external — a crossing needs exactly one side external', () => {
    const elementsById = new Map([
      ['sys-a', system('sys-a', { isExternal: true })],
      ['sys-b', system('sys-b', { isExternal: true })],
    ]);
    const edges = [relationship('r1', 'flows_to', 'sys-a', 'sys-b')];
    expect(findExternalInterfacesMissingClassification(edges, elementsById)).toEqual([]);
  });

  it('an actor endpoint is never counted as the external side of this finding — it has its own separate finding', () => {
    const elementsById = new Map([
      ['sys-int', system('sys-int')],
      ['act-1', actor('act-1', { isExternal: true, subtype: 'organisation' })],
    ]);
    const edges = [relationship('r1', 'uses', 'act-1', 'sys-int', { description: 'submits returns to' })];
    expect(findExternalInterfacesMissingClassification(edges, elementsById)).toEqual([]);
  });

  it('a uses edge is never flagged — UsesAttributes carries no dataClassification field to be missing', () => {
    const elementsById = new Map([
      ['sys-int', system('sys-int')],
      ['sys-ext', system('sys-ext', { isExternal: true })],
    ]);
    const edges = [relationship('r1', 'uses', 'sys-int', 'sys-ext', { description: 'polls' })];
    expect(findExternalInterfacesMissingClassification(edges, elementsById)).toEqual([]);
  });
});

describe('findExternalOrganisationAccess (S1 item 11a)', () => {
  it('lists an external actor\'s own uses edge, naming its organisation and the system it reaches', () => {
    const elementsById = new Map([
      ['act-1', actor('act-1', { isExternal: true, subtype: 'organisation', externalOrganisation: 'Ofgem' })],
      ['sys-1', system('sys-1')],
    ]);
    const edges = [relationship('r1', 'uses', 'act-1', 'sys-1', { description: 'submits RIIO returns to' })];
    expect(findExternalOrganisationAccess(edges, elementsById)).toEqual([{ relationshipId: 'r1', actorId: 'act-1', organisation: 'Ofgem', systemId: 'sys-1', systemName: 'System sys-1' }]);
  });

  it('falls back to the actor\'s own name when externalOrganisation is unset', () => {
    const elementsById = new Map([
      ['act-1', actor('act-1', { isExternal: true })],
      ['sys-1', system('sys-1')],
    ]);
    const edges = [relationship('r1', 'uses', 'act-1', 'sys-1')];
    expect(findExternalOrganisationAccess(edges, elementsById)).toEqual([{ relationshipId: 'r1', actorId: 'act-1', organisation: 'Actor act-1', systemId: 'sys-1', systemName: 'System sys-1' }]);
  });

  it('never lists an internal actor\'s own uses edge', () => {
    const elementsById = new Map([
      ['act-1', actor('act-1', { isExternal: false })],
      ['sys-1', system('sys-1')],
    ]);
    const edges = [relationship('r1', 'uses', 'act-1', 'sys-1')];
    expect(findExternalOrganisationAccess(edges, elementsById)).toEqual([]);
  });

  it('never lists a system-to-system uses edge — only an actor\'s own', () => {
    const elementsById = new Map([
      ['sys-a', system('sys-a')],
      ['sys-b', system('sys-b')],
    ]);
    const edges = [relationship('r1', 'uses', 'sys-a', 'sys-b')];
    expect(findExternalOrganisationAccess(edges, elementsById)).toEqual([]);
  });

  it('never lists a flows_to edge, even from an external actor\'s own id — flows_to has no actor-endpoint rule at all', () => {
    const elementsById = new Map([
      ['act-1', actor('act-1', { isExternal: true })],
      ['sys-1', system('sys-1')],
    ]);
    const edges = [relationship('r1', 'flows_to', 'act-1', 'sys-1')];
    expect(findExternalOrganisationAccess(edges, elementsById)).toEqual([]);
  });

  it('lists two edges from the same external actor separately, not deduplicated', () => {
    const elementsById = new Map([
      ['act-1', actor('act-1', { isExternal: true, externalOrganisation: 'Ofgem' })],
      ['sys-1', system('sys-1')],
      ['sys-2', system('sys-2')],
    ]);
    const edges = [relationship('r1', 'uses', 'act-1', 'sys-1'), relationship('r2', 'uses', 'act-1', 'sys-2')];
    expect(findExternalOrganisationAccess(edges, elementsById)).toEqual([
      { relationshipId: 'r1', actorId: 'act-1', organisation: 'Ofgem', systemId: 'sys-1', systemName: 'System sys-1' },
      { relationshipId: 'r2', actorId: 'act-1', organisation: 'Ofgem', systemId: 'sys-2', systemName: 'System sys-2' },
    ]);
  });
});

describe('findCapabilitiesWithNoSupporters (per-item-actions prompt)', () => {
  it('flags a level-1 capability with zero supports edges anywhere', () => {
    const capabilities = [capability('cap-1')];
    expect(findCapabilitiesWithNoSupporters(capabilities, capabilities, [], [])).toEqual([capability('cap-1')]);
  });

  it('does not flag a level-1 capability with a direct supporter', () => {
    const capabilities = [capability('cap-1')];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-1', { role: 'secondary' })];
    expect(findCapabilitiesWithNoSupporters(capabilities, capabilities, supports, [])).toEqual([]);
  });

  it('does not flag a level-1 capability whose child (not itself) is directly supported — subtree rollup, not a direct-edge check', () => {
    const root = capability('cap-root');
    const child = capability('cap-child', 'cap-root');
    const allCapabilities = [root, child];
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-child', { role: 'secondary' })];
    expect(findCapabilitiesWithNoSupporters([root], allCapabilities, supports, [])).toEqual([]);
  });

  it('flags a level-1 capability whose whole subtree has no supporter', () => {
    const root = capability('cap-root');
    const child = capability('cap-child', 'cap-root');
    const allCapabilities = [root, child];
    expect(findCapabilitiesWithNoSupporters([root], allCapabilities, [], [])).toEqual([root]);
  });

  it('only ever considers the level-1 capabilities passed in, not every capability in the model', () => {
    const root = capability('cap-root');
    const other = capability('cap-other');
    const supports = [relationship('r1', 'supports', 'sys-1', 'cap-other', { role: 'secondary' })];
    expect(findCapabilitiesWithNoSupporters([root], [root, other], supports, []).map((c) => c.element_id)).toEqual(['cap-root']);
  });
});

describe('findOutgoingWithoutRetiringChange (F11)', () => {
  it('flags Migrate and Eliminate with no open retiring change; ignores Tolerate, Invest and unset', () => {
    const elements = [
      system('migrate', { disposition: 'migrate', lifecycleStatus: 'active' }),
      system('eliminate', { disposition: 'eliminate', lifecycleStatus: 'active' }),
      system('tolerate', { disposition: 'tolerate', lifecycleStatus: 'active' }),
      system('unset', { lifecycleStatus: 'active' }),
    ];
    expect(findOutgoingWithoutRetiringChange(elements, new Set()).map((e) => e.element_id)).toEqual(['migrate', 'eliminate']);
  });

  it('clears once an open change retires it, or main already shows it retiring or retired', () => {
    const elements = [
      system('in-change', { disposition: 'migrate', lifecycleStatus: 'active' }),
      system('retiring', { disposition: 'eliminate', lifecycleStatus: 'retiring' }),
      system('retired', { disposition: 'eliminate', lifecycleStatus: 'retired' }),
    ];
    expect(findOutgoingWithoutRetiringChange(elements, new Set(['in-change']))).toEqual([]);
  });

  it('a module uses its own disposition, and its platform\'s lifecycle when it has none', () => {
    const platform = system('platform', { lifecycleStatus: 'retiring', disposition: 'invest' });
    const module: ElementsHeadRow = { element_id: 'module', element_type: 'container', name: 'module', parent_id: 'platform', attributes: { disposition: 'migrate', isExternal: false }, exists_delta_id: 'd-module' };
    const ownActive: ElementsHeadRow = { ...module, element_id: 'module-2', attributes: { disposition: 'migrate', lifecycleStatus: 'active', isExternal: false } };
    const byId = new Map([[platform.element_id, platform]]);
    expect(findOutgoingWithoutRetiringChange([platform, module, ownActive], new Set(), byId).map((e) => e.element_id)).toEqual(['module-2']);
  });
});

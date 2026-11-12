import { describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { findImpactProblems } from './changeImpactProblems';
import { emptyHead, type ElementRow, type RelationshipRow } from './deltas';

const NOW = new Date('2026-11-12T00:00:00Z');
const el = (elementType: ElementRow['elementType'], name: string, attributes: Record<string, string> = {}, parentId: string | null = null): ElementRow => ({ elementType, name, parentId, attributes, existsDeltaId: `c-${name}` });
const rel = (relationshipType: RelationshipRow['relationshipType'], from: string, to: string): RelationshipRow => ({ relationshipType, fromElementId: from, toElementId: to, attributes: {}, existsDeltaId: `r-${from}-${to}` });
const retract = (id: string, elementId: string): Delta => ({ kind: 'element.retract', id, elementId, elementType: 'system', previousDeltaId: 'x', sourceId: 's', confidence: 1 });
const edit = (id: string, elementId: string): Delta => ({ kind: 'element.update', id, elementId, elementType: 'system', attribute: 'name', value: 'n', previousDeltaId: 'x', sourceId: 's', confidence: 1 });

describe('findImpactProblems', () => {
  it('reports nothing for a healthy change', () => {
    const head = emptyHead();
    head.elements.set('a', el('system', 'A'));
    head.elements.set('cap', el('capability', 'Cap'));
    head.relationships.set('s', rel('supports', 'a', 'cap'));
    expect(findImpactProblems([edit('d1', 'a')], head, head, NOW)).toEqual({ capabilitiesLeftWithoutSystem: [], providerProblems: [] });
  });

  it('lists a capability left with no system, naming who supported it', () => {
    const asIs = emptyHead();
    asIs.elements.set('a', el('system', 'Alpha'));
    asIs.elements.set('cap', el('capability', 'Billing'));
    asIs.relationships.set('s', rel('supports', 'a', 'cap'));
    const toBe = emptyHead();
    toBe.elements.set('cap', el('capability', 'Billing'));
    const result = findImpactProblems([retract('d1', 'a')], asIs, toBe, NOW);
    expect(result.capabilitiesLeftWithoutSystem).toEqual([{ id: 'cap', name: 'Billing', formerSystems: [{ id: 'a', name: 'Alpha' }] }]);
  });

  it('flags a changed system whose provider is ending with no replacement, but not one with a replacement', () => {
    const toBe = emptyHead();
    toBe.elements.set('a', el('system', 'Alpha'));
    toBe.elements.set('p', el('system', 'Provider', { plannedEnd: '2027-01-15' }));
    toBe.relationships.set('u', rel('uses', 'a', 'p'));
    const deltas = [edit('d1', 'a')];
    expect(findImpactProblems(deltas, toBe, toBe, NOW).providerProblems).toEqual([{ kind: 'provider_ending', consumer: { id: 'a', name: 'Alpha' }, provider: { id: 'p', name: 'Provider' }, plannedEnd: '2027-01-15' }]);

    toBe.elements.set('r', el('system', 'Replacement'));
    toBe.relationships.set('rp', rel('replaces', 'r', 'p'));
    expect(findImpactProblems(deltas, toBe, toBe, NOW).providerProblems).toEqual([]);
  });

  it('ignores an ending provider of a system this change does not touch', () => {
    const head = emptyHead();
    head.elements.set('a', el('system', 'Alpha'));
    head.elements.set('b', el('system', 'Beta'));
    head.elements.set('p', el('system', 'Provider', { plannedEnd: '2027-01-15' }));
    head.relationships.set('u', rel('uses', 'a', 'p'));
    expect(findImpactProblems([edit('d1', 'b')], head, head, NOW).providerProblems).toEqual([]);
  });

  it('flags a provider the change removes while something still depends on it', () => {
    const asIs = emptyHead();
    asIs.elements.set('a', el('system', 'Alpha'));
    asIs.elements.set('p', el('system', 'Provider'));
    asIs.relationships.set('u', rel('flows_to', 'a', 'p'));
    const toBe = emptyHead();
    toBe.elements.set('a', el('system', 'Alpha'));
    expect(findImpactProblems([retract('d1', 'p')], asIs, toBe, NOW).providerProblems).toEqual([{ kind: 'provider_removed', consumer: { id: 'a', name: 'Alpha' }, provider: { id: 'p', name: 'Provider' } }]);
  });
});

import { describe, expect, it } from 'vitest';
import type { ElementType, RelationshipType } from '../../contracts/delta';
import { emptyHead, type Head } from '../../engine/deltas';
import { buildProjectBeforeAfter } from './projectBeforeAfterModel';

const NOW = new Date('2026-11-19T00:00:00Z');

function head(spec: { elements: [string, ElementType, string][]; edges: [string, RelationshipType, string, string, Record<string, string>?][] }): Head {
  const h = emptyHead();
  for (const [id, elementType, name] of spec.elements) h.elements.set(id, { elementType, name, parentId: null, attributes: {}, existsDeltaId: `d-${id}` });
  for (const [id, relationshipType, from, to, attributes] of spec.edges) h.relationships.set(id, { relationshipType, fromElementId: from, toElementId: to, attributes: attributes ?? {}, existsDeltaId: `d-${id}` });
  return h;
}

const base = {
  elements: [
    ['cap', 'capability', 'Billing'],
    ['old', 'system', 'Old Billing'],
    ['crm', 'system', 'CRM'],
    ['bank', 'system', 'Bank Feed'],
  ] as [string, ElementType, string][],
  edges: [
    ['s1', 'supports', 'old', 'cap'],
    ['f1', 'flows_to', 'old', 'crm', { description: 'sends invoices' }],
  ] as [string, RelationshipType, string, string, Record<string, string>?][],
};

describe('buildProjectBeforeAfter', () => {
  it('lists today’s supporters with their connected apps, and says when nothing supports a capability', () => {
    const today = head(base);
    const [capability] = buildProjectBeforeAfter(today, [], [{ id: 'cap', name: 'Billing' }], NOW);
    expect(capability?.today.systems.map((s) => s.name)).toEqual(['Old Billing']);
    expect(capability?.today.systems[0]?.connections.map((c) => [c.appName, c.label])).toEqual([['CRM', 'sends invoices ⇢']]);
    expect(capability?.after).toEqual([]);

    const [empty] = buildProjectBeforeAfter(head({ elements: [['cap', 'capability', 'Billing']], edges: [] }), [], [{ id: 'cap', name: 'Billing' }], NOW);
    expect(empty?.today.systems).toEqual([]);
  });

  it('after a change: a replacement is new, the replaced system ends, and rewired apps are marked', () => {
    const today = head(base);
    const toBe = head({
      elements: [...base.elements, ['new', 'system', 'New Billing']],
      edges: [
        ['s2', 'supports', 'new', 'cap'],
        ['f2', 'flows_to', 'new', 'crm', { description: 'sends invoices' }],
        ['f3', 'flows_to', 'bank', 'new', { description: 'pays into' }],
      ],
    });
    const [capability] = buildProjectBeforeAfter(today, [{ id: 'chg', title: 'Replace billing', head: toBe }], [{ id: 'cap', name: 'Billing' }], NOW);
    const after = capability?.after[0];
    expect(after?.title).toBe('After: Replace billing');
    expect(after?.systems.map((s) => [s.name, s.mark])).toEqual([['New Billing', 'new'], ['Old Billing', 'ends']]);
    expect(after?.systems[0]?.connections.map((c) => [c.appName, c.mark])).toEqual([['Bank Feed', 'new'], ['CRM', 'new']]);
  });

  it('marks a connection that disappears or appears on a system that stays', () => {
    const today = head(base);
    const toBe = head({
      elements: base.elements,
      edges: [
        ['s1', 'supports', 'old', 'cap'],
        ['f3', 'flows_to', 'bank', 'old', { description: 'pays into' }],
      ],
    });
    const [capability] = buildProjectBeforeAfter(today, [{ id: 'chg', title: 'Rewire', head: toBe }], [{ id: 'cap', name: 'Billing' }], NOW);
    const system = capability?.after[0]?.systems[0];
    expect(system?.mark).toBe('same');
    expect(system?.connections.map((c) => [c.appName, c.mark])).toEqual([['Bank Feed', 'new'], ['CRM', 'ends']]);
  });
});

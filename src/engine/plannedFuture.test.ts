import { describe, expect, it } from 'vitest';
import { emptyHead, type ElementRow, type Head, type RelationshipRow } from './deltas';
import { capabilitiesLeftWithoutSystem, liveHead, projectFutureHead, type PlannedChange } from './plannedFuture';

const TODAY = '2026-11-09';

function system(name: string, attributes: Record<string, string> = {}): ElementRow {
  return { elementType: 'system', name, parentId: null, attributes, existsDeltaId: `create-${name}` };
}
function container(name: string, parentId: string): ElementRow {
  return { elementType: 'container', name, parentId, attributes: {}, existsDeltaId: `create-${name}` };
}
function capability(name: string): ElementRow {
  return { elementType: 'capability', name, parentId: null, attributes: {}, existsDeltaId: `create-${name}` };
}
function supports(from: string, to: string): RelationshipRow {
  return { relationshipType: 'supports', fromElementId: from, toElementId: to, attributes: {}, existsDeltaId: `rel-${from}-${to}` };
}
function headOf(elements: Record<string, ElementRow>, relationships: Record<string, RelationshipRow> = {}): Head {
  const head = emptyHead();
  for (const [id, row] of Object.entries(elements)) head.elements.set(id, row);
  for (const [id, row] of Object.entries(relationships)) head.relationships.set(id, row);
  return head;
}

const today = () => headOf({ cap: capability('Billing'), old: system('Old Billing') }, { r1: supports('old', 'cap') });

/** A change that retires "old" and adds "new" supporting the same capability. */
function replaceChange(id: string, targetDate: string): PlannedChange {
  const asIs = today();
  const toBe = headOf({ cap: capability('Billing'), new: system('New Billing') }, { r2: supports('new', 'cap') });
  return { id, targetDate, asIs, toBe };
}

describe('projectFutureHead', () => {
  it('is today itself at or before today', () => {
    const head = today();
    expect(projectFutureHead(head, [replaceChange('c1', '2026-12-01')], TODAY, TODAY).head).toBe(head);
    expect(projectFutureHead(head, [replaceChange('c1', '2026-12-01')], '2026-01-01', TODAY).applied).toEqual([]);
  });

  it('lays on a change dated on or before the date, and leaves today untouched', () => {
    const head = today();
    const future = projectFutureHead(head, [replaceChange('c1', '2027-02-01')], '2027-02-01', TODAY);
    expect(future.applied).toEqual(['c1']);
    expect([...future.head.elements.keys()].sort()).toEqual(['cap', 'new']);
    expect([...future.head.relationships.keys()]).toEqual(['r2']);
    expect([...head.elements.keys()].sort()).toEqual(['cap', 'old']);
  });

  it('ignores a change dated after the date', () => {
    const future = projectFutureHead(today(), [replaceChange('c1', '2027-02-01')], '2027-01-31', TODAY);
    expect(future.applied).toEqual([]);
    expect([...future.head.elements.keys()].sort()).toEqual(['cap', 'old']);
  });

  it('applies changes in date order, whatever order they are given in', () => {
    const early = replaceChange('b', '2027-01-01');
    const late = replaceChange('a', '2027-03-01');
    expect(projectFutureHead(today(), [late, early], '2027-06-01', TODAY).applied).toEqual(['b', 'a']);
  });

  it('flags two applied changes that touch the same element', () => {
    const future = projectFutureHead(today(), [replaceChange('c1', '2027-01-01'), replaceChange('c2', '2027-02-01')], '2027-06-01', TODAY);
    expect(future.overlaps.map((o) => o.elementId)).toContain('cap');
    expect(future.overlaps.find((o) => o.elementId === 'cap')?.changeIds).toEqual(['c1', 'c2']);
  });

  it('removes a system whose planned end has passed, with its modules and relationships', () => {
    const head = headOf(
      { cap: capability('Billing'), old: system('Old Billing', { plannedEnd: '2027-01-01' }), mod: container('Module', 'old') },
      { r1: supports('old', 'cap'), r3: supports('mod', 'cap') },
    );
    const future = projectFutureHead(head, [], '2027-01-01', TODAY);
    expect([...future.head.elements.keys()]).toEqual(['cap']);
    expect(future.head.relationships.size).toBe(0);
    expect(projectFutureHead(head, [], '2026-12-31', TODAY).head.elements.has('old')).toBe(true);
  });

  it('hides a system until its introduced date', () => {
    const head = headOf({ later: system('Later', { introduced: '2027-06-01' }), now: system('Now') });
    expect([...projectFutureHead(head, [], '2027-05-31', TODAY).head.elements.keys()]).toEqual(['now']);
    expect([...projectFutureHead(head, [], '2027-06-01', TODAY).head.elements.keys()].sort()).toEqual(['later', 'now']);
  });
});

describe('capabilitiesLeftWithoutSystem', () => {
  it('lists a capability that loses its only system, and not one that gains a replacement', () => {
    const t = headOf({ cap: capability('Billing'), old: system('Old') }, { r1: supports('old', 'cap') });
    const lost = headOf({ cap: capability('Billing') });
    expect(capabilitiesLeftWithoutSystem(t, lost)).toEqual(['cap']);
    const replaced = headOf({ cap: capability('Billing'), new: system('New') }, { r2: supports('new', 'cap') });
    expect(capabilitiesLeftWithoutSystem(t, replaced)).toEqual([]);
  });

  it('does not list a capability that had no system today', () => {
    const t = headOf({ cap: capability('Billing') });
    expect(capabilitiesLeftWithoutSystem(t, t)).toEqual([]);
  });
});

describe('the live baseline for a future view', () => {
  const NOW = '2026-11-16';
  const head = () => headOf({
    cap: capability('Billing'),
    live: system('Live', { introduced: '2020-01-01' }),
    soon: system('Soon', { introduced: '2027-08-28' }),
    later: system('Later', { introduced: '2028-03-01' }),
    gone: system('Gone', { introduced: '2010-04-01', plannedEnd: '2025-04-28' }),
    ending: system('Ending', { plannedEnd: '2027-03-28' }),
  }, { a: supports('live', 'cap'), b: supports('soon', 'cap'), c: supports('gone', 'cap') });

  it('leaves out planned and already-retired systems and their links', () => {
    const live = liveHead(head(), NOW);
    expect([...live.elements.keys()].sort()).toEqual(['cap', 'ending', 'live']);
    expect([...live.relationships.keys()]).toEqual(['a']);
  });

  it('a planned system that starts by the date reads as added, one that does not is simply absent, one that ends reads as removed', () => {
    const baseline = liveHead(head(), NOW);
    const at = (asAt: string) => projectFutureHead(head(), [], asAt, NOW).head;
    const added = (asAt: string) => [...at(asAt).elements.keys()].filter((id) => !baseline.elements.has(id)).sort();
    const removed = (asAt: string) => [...baseline.elements.keys()].filter((id) => !at(asAt).elements.has(id)).sort();
    expect(added('2027-05-16')).toEqual([]);
    expect(removed('2027-05-16')).toEqual(['ending']);
    expect(added('2027-11-16')).toEqual(['soon']);
    expect(removed('2027-11-16')).toEqual(['ending']);
  });
});

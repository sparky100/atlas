import { describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { buildCopyPlan } from './copyModel';
import { cloneHead, emptyHead, fold, factMapKey } from './deltas';

const ctx = { authorId: 'author', createdAt: '2026-01-01T00:00:00.000Z' };
function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}-${String((n += 1)).padStart(4, '0')}`;
}

const SRC_A = 'src-a';
const SRC_B = 'src-b';

function sourceHead() {
  const deltas = [
    { kind: 'element.create', id: 'd1', elementId: 'sys', elementType: 'system', name: 'Billing', parentId: null, attributes: { lifecycleStatus: 'live', isExternal: false, description: 'Bills' }, sourceId: SRC_A, confidence: 0.9 },
    { kind: 'element.create', id: 'd2', elementId: 'cap', elementType: 'capability', name: 'Invoicing', parentId: null, attributes: {}, sourceId: SRC_A, confidence: 1 },
    { kind: 'element.create', id: 'd3', elementId: 'mod', elementType: 'container', name: 'Ledger', parentId: 'sys', attributes: { isExternal: false }, sourceId: SRC_A, confidence: 1 },
    { kind: 'relationship.create', id: 'd4', relationshipId: 'rel', relationshipType: 'supports', fromElementId: 'sys', toElementId: 'cap', attributes: { role: 'primary' }, sourceId: SRC_A, confidence: 1 },
    // A later edit from a different source: this fact's provenance differs from the element's $exists.
    { kind: 'element.update', id: 'd5', elementId: 'sys', elementType: 'system', attribute: 'description', value: 'Bills customers', previousDeltaId: 'd1', sourceId: SRC_B, sourceRef: 'row 4', effectiveDate: '2026-02-01', confidence: 0.5 },
  ] as unknown as Delta[];
  return fold(cloneHead(emptyHead()), deltas, ctx);
}

describe('buildCopyPlan', () => {
  const head = sourceHead();
  const sourceIdMap = new Map([
    [SRC_A, 'new-a'],
    [SRC_B, 'new-b'],
  ]);
  const plan = buildCopyPlan(head, sourceIdMap, counter('id'));
  const copied = fold(cloneHead(emptyHead()), plan.deltas, ctx);

  it('copies every element and relationship under brand-new ids', () => {
    expect(copied.elements.size).toBe(3);
    expect(copied.relationships.size).toBe(1);
    for (const id of copied.elements.keys()) expect(['sys', 'cap', 'mod']).not.toContain(id);
    for (const id of copied.relationships.keys()) expect(id).not.toBe('rel');
  });

  it('keeps names, types, attributes and the parent link (re-pointed at the new parent)', () => {
    const newSys = plan.elementIdMap.get('sys');
    const newMod = plan.elementIdMap.get('mod');
    expect(newSys && copied.elements.get(newSys)?.name).toBe('Billing');
    expect(newMod && copied.elements.get(newMod)?.parentId).toBe(newSys);
    expect(newSys && copied.elements.get(newSys)?.attributes.description).toBe('Bills customers');
  });

  it('re-points a relationship at the new endpoints', () => {
    const rel = [...copied.relationships.values()][0];
    expect(rel?.fromElementId).toBe(plan.elementIdMap.get('sys'));
    expect(rel?.toElementId).toBe(plan.elementIdMap.get('cap'));
    expect(rel?.attributes).toEqual({ role: 'primary' });
  });

  it('preserves each fact\'s own provenance, including one that differs from its element\'s create', () => {
    const newSys = plan.elementIdMap.get('sys') ?? '';
    const name = copied.facts.get(factMapKey(newSys, 'name'));
    expect(name).toMatchObject({ sourceId: 'new-a', confidence: 0.9 });
    const description = copied.facts.get(factMapKey(newSys, 'description'));
    expect(description).toMatchObject({ sourceId: 'new-b', sourceRef: 'row 4', effectiveDate: '2026-02-01', confidence: 0.5, value: 'Bills customers' });
  });

  it('names only sources the facts use, and never an old source id in the copy', () => {
    expect([...plan.sourceIds].sort()).toEqual([SRC_A, SRC_B]);
    for (const fact of copied.facts.values()) expect(['new-a', 'new-b']).toContain(fact.sourceId);
  });

  it('is deterministic for the same head and the same id minter', () => {
    const again = buildCopyPlan(head, sourceIdMap, counter('id'));
    expect(again.deltas).toEqual(plan.deltas);
  });

  it('puts a parent before its child', () => {
    const order = plan.deltas.filter((d) => d.kind === 'element.create').map((d) => (d as { elementId: string }).elementId);
    expect(order.indexOf(plan.elementIdMap.get('sys') ?? '')).toBeLessThan(order.indexOf(plan.elementIdMap.get('mod') ?? ''));
  });

  it('refuses a fact whose source has no new id rather than copying a dangling source', () => {
    expect(() => buildCopyPlan(head, new Map([[SRC_A, 'new-a']]), counter('id'))).toThrow(/no new id for source/);
  });
});

import { describe, expect, it } from 'vitest';
import { buildOrderBackfillDeltas, findOrderBackfillCandidates } from './backfillCapabilityOrder';
import type { ElementsHeadRow } from '../contracts/rows';

function element(overrides: Partial<ElementsHeadRow> & Pick<ElementsHeadRow, 'element_id' | 'name'>): ElementsHeadRow {
  return {
    element_type: 'capability',
    parent_id: null,
    attributes: {},
    exists_delta_id: `exists-${overrides.element_id}`,
    ...overrides,
  };
}

describe('findOrderBackfillCandidates (Sprint U4-1 C1 backfill)', () => {
  it('a capability with no order attribute at all is a candidate, numbered 1 when it has no ordered siblings', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Finance' })];
    expect(findOrderBackfillCandidates(capabilities)).toEqual([{ elementId: 'el-1', name: 'Finance', order: 1, previousDeltaId: 'exists-el-1' }]);
  });

  it('a capability that already has a numeric order is never a candidate', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Finance', attributes: { order: 10 } })];
    expect(findOrderBackfillCandidates(capabilities)).toEqual([]);
  });

  it('numbers order-less siblings starting one past the group\'s existing maximum, leaving already-ordered siblings untouched', () => {
    const capabilities = [
      element({ element_id: 'el-1', name: 'Finance', attributes: { order: 10 } }),
      element({ element_id: 'el-2', name: 'Procurement', attributes: { order: 20 } }),
      element({ element_id: 'el-3', name: 'Hand Added' }),
    ];
    expect(findOrderBackfillCandidates(capabilities)).toEqual([{ elementId: 'el-3', name: 'Hand Added', order: 21, previousDeltaId: 'exists-el-3' }]);
  });

  it('breaks ties among order-less siblings by name, then id, for a deterministic result', () => {
    const capabilities = [
      element({ element_id: 'el-b', name: 'Beta' }),
      element({ element_id: 'el-a', name: 'Alpha' }),
    ];
    const candidates = findOrderBackfillCandidates(capabilities);
    expect(candidates.map((c) => c.elementId)).toEqual(['el-a', 'el-b']);
    expect(candidates.map((c) => c.order)).toEqual([1, 2]);
  });

  it('groups by parent_id — a top-level group and a nested group are numbered independently', () => {
    const capabilities = [
      element({ element_id: 'root-1', name: 'Root', parent_id: null }),
      element({ element_id: 'child-1', name: 'Child', parent_id: 'root-1' }),
    ];
    const candidates = findOrderBackfillCandidates(capabilities);
    expect(candidates).toContainEqual({ elementId: 'root-1', name: 'Root', order: 1, previousDeltaId: 'exists-root-1' });
    expect(candidates).toContainEqual({ elementId: 'child-1', name: 'Child', order: 1, previousDeltaId: 'exists-child-1' });
  });

  it('an orphan (its parent_id does not resolve to any element here) still gets grouped and ordered by its raw parent_id', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Orphan', parent_id: 'missing-parent' })];
    expect(findOrderBackfillCandidates(capabilities)).toEqual([{ elementId: 'el-1', name: 'Orphan', order: 1, previousDeltaId: 'exists-el-1' }]);
  });

  it('returns nothing for an empty model', () => {
    expect(findOrderBackfillCandidates([])).toEqual([]);
  });

  it('returns nothing when every capability already has an order', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Finance', attributes: { order: 10 } }), element({ element_id: 'el-2', name: 'Procurement', attributes: { order: 20 } })];
    expect(findOrderBackfillCandidates(capabilities)).toEqual([]);
  });
});

describe('buildOrderBackfillDeltas (Sprint U4-1 C1 backfill)', () => {
  it('builds one element.update delta per candidate, sharing sourceId and confidence 1', () => {
    const candidates = [
      { elementId: 'el-1', name: 'A', order: 1, previousDeltaId: 'exists-el-1' },
      { elementId: 'el-2', name: 'B', order: 2, previousDeltaId: 'exists-el-2' },
    ];
    const deltas = buildOrderBackfillDeltas(candidates, 'manual-source-1');
    expect(deltas).toHaveLength(2);
    for (const [i, candidate] of candidates.entries()) {
      expect(deltas[i]).toMatchObject({
        kind: 'element.update',
        elementId: candidate.elementId,
        elementType: 'capability',
        attribute: 'order',
        value: candidate.order,
        previousDeltaId: candidate.previousDeltaId,
        sourceId: 'manual-source-1',
        confidence: 1,
      });
    }
  });

  it('returns nothing for an empty candidate list', () => {
    expect(buildOrderBackfillDeltas([], 'manual-source-1')).toEqual([]);
  });
});

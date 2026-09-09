import { describe, expect, it } from 'vitest';
import type { CapabilityMapItemRow } from './capabilityMapTemplates';
import { buildSyncDescriptionsDeltas, findSyncCandidates } from './syncDescriptionsFromMap';
import type { ElementsHeadRow, FactsRow } from '../contracts/rows';

function element(overrides: Partial<ElementsHeadRow> & Pick<ElementsHeadRow, 'element_id' | 'name'>): ElementsHeadRow {
  return {
    element_type: 'capability',
    parent_id: null,
    attributes: {},
    exists_delta_id: `exists-${overrides.element_id}`,
    ...overrides,
  };
}

function item(overrides: Partial<CapabilityMapItemRow> & Pick<CapabilityMapItemRow, 'id'>): CapabilityMapItemRow {
  return {
    map_id: 'map-1',
    code: '1',
    parent_code: null,
    name: 'Item',
    description: null,
    level: 1,
    item_order: 10,
    ...overrides,
  };
}

function descriptionFact(subjectId: string, deltaId: string): FactsRow {
  return { subject_type: 'element', subject_id: subjectId, attribute: 'description', value: 'old', delta_id: deltaId, source_id: 'src', source_ref: null, effective_date: null, confidence: 1, asserted_by: 'user-1', asserted_at: '2026-01-01T00:00:00Z' };
}

describe('findSyncCandidates (Bug A2 sync)', () => {
  it('a capability with a templateRef and no description is a candidate, using the map item description and the exists_delta_id as previousDeltaId', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Asset Management', attributes: { code: '1', templateRef: 'item-1' } })];
    const items = [item({ id: 'item-1', description: 'What this capability covers.' })];

    const candidates = findSyncCandidates(capabilities, items, []);
    expect(candidates).toEqual([{ elementId: 'el-1', name: 'Asset Management', description: 'What this capability covers.', previousDeltaId: 'exists-el-1' }]);
  });

  it('uses the existing description fact\'s delta_id as previousDeltaId when one exists (an explicit prior clear-to-empty), not exists_delta_id', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Asset Management', attributes: { code: '1', templateRef: 'item-1' } })];
    const items = [item({ id: 'item-1', description: 'What this capability covers.' })];
    const facts = [descriptionFact('el-1', 'update-delta-1')];

    const candidates = findSyncCandidates(capabilities, items, facts);
    expect(candidates[0]?.previousDeltaId).toBe('update-delta-1');
  });

  it('a capability with no templateRef (hand-added, never seeded) is never a candidate', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Hand-added', attributes: {} })];
    const items = [item({ id: 'item-1', description: 'Unused.' })];
    expect(findSyncCandidates(capabilities, items, [])).toEqual([]);
  });

  it('a capability that already has a real (non-empty, non-whitespace) description is never a candidate', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Asset Management', attributes: { code: '1', templateRef: 'item-1', description: 'Already written.' } })];
    const items = [item({ id: 'item-1', description: 'Map text.' })];
    expect(findSyncCandidates(capabilities, items, [])).toEqual([]);
  });

  it('a whitespace-only description is treated the same as empty — still a candidate', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Asset Management', attributes: { code: '1', templateRef: 'item-1', description: '   ' } })];
    const items = [item({ id: 'item-1', description: 'Map text.' })];
    expect(findSyncCandidates(capabilities, items, [])).toHaveLength(1);
  });

  it('a map item with no description of its own (null or whitespace) produces no candidate — nothing to sync', () => {
    const capabilities = [
      element({ element_id: 'el-1', name: 'A', attributes: { code: '1', templateRef: 'item-1' } }),
      element({ element_id: 'el-2', name: 'B', attributes: { code: '2', templateRef: 'item-2' } }),
    ];
    const items = [item({ id: 'item-1', description: null }), item({ id: 'item-2', description: '   ' })];
    expect(findSyncCandidates(capabilities, items, [])).toEqual([]);
  });

  it('a templateRef with no matching map item (the map changed since seeding) produces no candidate', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Orphaned', attributes: { code: '1', templateRef: 'gone' } })];
    expect(findSyncCandidates(capabilities, [], [])).toEqual([]);
  });

  it('an unrelated description fact for a different subject is ignored', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Asset Management', attributes: { code: '1', templateRef: 'item-1' } })];
    const items = [item({ id: 'item-1', description: 'Map text.' })];
    const facts = [descriptionFact('el-other', 'update-delta-other')];
    expect(findSyncCandidates(capabilities, items, facts)[0]?.previousDeltaId).toBe('exists-el-1');
  });
});

describe('buildSyncDescriptionsDeltas (Bug A2 sync)', () => {
  it('builds one element.update delta per candidate, sharing sourceId and confidence 1', () => {
    const candidates = [
      { elementId: 'el-1', name: 'A', description: 'Desc A', previousDeltaId: 'exists-el-1' },
      { elementId: 'el-2', name: 'B', description: 'Desc B', previousDeltaId: 'exists-el-2' },
    ];
    const deltas = buildSyncDescriptionsDeltas(candidates, 'template-source-1');
    expect(deltas).toHaveLength(2);
    for (const [i, candidate] of candidates.entries()) {
      const delta = deltas[i];
      expect(delta).toMatchObject({
        kind: 'element.update',
        elementId: candidate.elementId,
        elementType: 'capability',
        attribute: 'description',
        value: candidate.description,
        previousDeltaId: candidate.previousDeltaId,
        sourceId: 'template-source-1',
        confidence: 1,
      });
    }
  });

  it('returns nothing for an empty candidate list', () => {
    expect(buildSyncDescriptionsDeltas([], 'template-source-1')).toEqual([]);
  });
});

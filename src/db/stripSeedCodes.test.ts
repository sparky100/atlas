import { describe, expect, it } from 'vitest';
import type { CapabilityMapItemRow } from './capabilityMapTemplates';
import { buildStripSeedCodesDeltas, findStripCandidates } from './stripSeedCodes';
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

function codeFact(subjectId: string, deltaId: string): FactsRow {
  return { subject_type: 'element', subject_id: subjectId, attribute: 'code', value: '1', delta_id: deltaId, source_id: 'src', source_ref: null, effective_date: null, confidence: 1, asserted_by: 'user-1', asserted_at: '2026-01-01T00:00:00Z' };
}

describe('findStripCandidates (ADR-020 strip-seed-codes)', () => {
  it('a capability whose code still equals its template item\'s own code is a candidate, using the exists_delta_id as previousDeltaId', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Asset Management', attributes: { code: '1', templateRef: 'item-1' } })];
    const items = [item({ id: 'item-1', code: '1' })];

    const candidates = findStripCandidates(capabilities, items, []);
    expect(candidates).toEqual([{ elementId: 'el-1', name: 'Asset Management', previousDeltaId: 'exists-el-1' }]);
  });

  it('uses the existing code fact\'s delta_id as previousDeltaId when one exists, not exists_delta_id', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Asset Management', attributes: { code: '1', templateRef: 'item-1' } })];
    const items = [item({ id: 'item-1', code: '1' })];
    const facts = [codeFact('el-1', 'update-delta-1')];

    const candidates = findStripCandidates(capabilities, items, facts);
    expect(candidates[0]?.previousDeltaId).toBe('update-delta-1');
  });

  it('a capability with no templateRef (hand-added, never seeded) is never a candidate, even if it happens to share a code', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Hand-added', attributes: { code: '1' } })];
    const items = [item({ id: 'item-1', code: '1' })];
    expect(findStripCandidates(capabilities, items, [])).toEqual([]);
  });

  it('a capability with no code at all is never a candidate — nothing to strip', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Asset Management', attributes: { templateRef: 'item-1' } })];
    const items = [item({ id: 'item-1', code: '1' })];
    expect(findStripCandidates(capabilities, items, [])).toEqual([]);
  });

  it('a code that differs from the template\'s own — a real, independently-set organisation value — is never a candidate', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Asset Management', attributes: { code: 'AM-042', templateRef: 'item-1' } })];
    const items = [item({ id: 'item-1', code: '1' })];
    expect(findStripCandidates(capabilities, items, [])).toEqual([]);
  });

  it('a templateRef with no matching map item (the map changed since seeding) produces no candidate', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Orphaned', attributes: { code: '1', templateRef: 'gone' } })];
    expect(findStripCandidates(capabilities, [], [])).toEqual([]);
  });

  it('an unrelated code fact for a different subject is ignored', () => {
    const capabilities = [element({ element_id: 'el-1', name: 'Asset Management', attributes: { code: '1', templateRef: 'item-1' } })];
    const items = [item({ id: 'item-1', code: '1' })];
    const facts = [codeFact('el-other', 'update-delta-other')];
    expect(findStripCandidates(capabilities, items, facts)[0]?.previousDeltaId).toBe('exists-el-1');
  });
});

describe('buildStripSeedCodesDeltas (ADR-020 strip-seed-codes)', () => {
  it('builds one element.update delta per candidate, clearing code to null, sharing sourceId and confidence 1', () => {
    const candidates = [
      { elementId: 'el-1', name: 'A', previousDeltaId: 'exists-el-1' },
      { elementId: 'el-2', name: 'B', previousDeltaId: 'exists-el-2' },
    ];
    const deltas = buildStripSeedCodesDeltas(candidates, 'template-source-1');
    expect(deltas).toHaveLength(2);
    for (const [i, candidate] of candidates.entries()) {
      const delta = deltas[i];
      expect(delta).toMatchObject({
        kind: 'element.update',
        elementId: candidate.elementId,
        elementType: 'capability',
        attribute: 'code',
        value: null,
        previousDeltaId: candidate.previousDeltaId,
        sourceId: 'template-source-1',
        confidence: 1,
      });
    }
  });

  it('returns nothing for an empty candidate list', () => {
    expect(buildStripSeedCodesDeltas([], 'template-source-1')).toEqual([]);
  });
});

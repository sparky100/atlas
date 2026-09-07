import { describe, expect, it } from 'vitest';
import type { Delta } from '../../contracts/delta';
import { describeDelta } from './changeSummaryFormat';

describe('describeDelta', () => {
  it('describes each delta kind on one line', () => {
    const cases: { delta: Delta; expected: string }[] = [
      {
        delta: { kind: 'element.create', id: 'd', elementId: 'e', elementType: 'system', name: 'Housing Options', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 's', confidence: 1 },
        expected: 'Created — "Housing Options"',
      },
      { delta: { kind: 'element.update', id: 'd', elementId: 'e', elementType: 'system', attribute: 'vendor', value: 'Acme', previousDeltaId: 'p', sourceId: 's', confidence: 1 }, expected: 'vendor → Acme' },
      { delta: { kind: 'element.update', id: 'd', elementId: 'e', elementType: 'system', attribute: 'isExternal', value: true, previousDeltaId: 'p', sourceId: 's', confidence: 1 }, expected: 'isExternal → true' },
      { delta: { kind: 'element.retract', id: 'd', elementId: 'e', elementType: 'system', previousDeltaId: 'p', sourceId: 's', confidence: 1 }, expected: 'Retracted' },
      { delta: { kind: 'element.restore', id: 'd', elementId: 'e', elementType: 'system', previousDeltaId: 'p', sourceId: 's', confidence: 1 }, expected: 'Restored' },
      { delta: { kind: 'relationship.create', id: 'd', relationshipId: 'r', relationshipType: 'uses', fromElementId: 'a', toElementId: 'b', attributes: {}, sourceId: 's', confidence: 1 }, expected: 'Created (uses)' },
      { delta: { kind: 'relationship.retract', id: 'd', relationshipId: 'r', relationshipType: 'uses', previousDeltaId: 'p', sourceId: 's', confidence: 1 }, expected: 'Retracted' },
    ];
    for (const { delta, expected } of cases) {
      expect(describeDelta(delta)).toBe(expected);
    }
  });
});

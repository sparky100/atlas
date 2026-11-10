import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { CapabilityMapTree } from './layout';
import { buildWholeMap } from './wholeMap';

function el(id: string, name: string, type: 'capability' | 'system', attributes: Record<string, unknown> = {}): ElementsHeadRow {
  return { element_id: id, name, element_type: type, attributes } as unknown as ElementsHeadRow;
}
function supports(system: string, capability: string): RelationshipsHeadRow {
  return { relationship_id: `${system}-${capability}`, relationship_type: 'supports', from_element_id: system, to_element_id: capability, attributes: {} } as unknown as RelationshipsHeadRow;
}

const tree: CapabilityMapTree = {
  l1: [{ capability: el('d1', 'Network', 'capability'), l2: [{ capability: el('c1', 'Switching', 'capability'), l3: [] }, { capability: el('c2', 'Metering', 'capability'), l3: [] }] }],
  orphans: [],
};

describe('buildWholeMap', () => {
  it('tints only the capability with no supporting system, in words, and leaves the supported one plain', () => {
    const systems = new Map([['s1', el('s1', 'SCADA', 'system')]]);
    const map = buildWholeMap(tree, 'metric:supportingSystemCount', [supports('s1', 'c1')], systems, new Set());
    const [column] = map.columns;
    expect(column?.tiles.map((t) => [t.capability.name, t.tone, t.label])).toEqual([
      ['Switching', undefined, undefined],
      ['Metering', 'warn', 'no supporting systems'],
    ]);
    expect(map.problemCount).toBe(1);
    expect(map.legend).toEqual([{ tone: 'warn', label: 'no supporting systems' }]);
  });

  it('shows no legend and no tint when nothing is a problem', () => {
    const systems = new Map([['s1', el('s1', 'SCADA', 'system')]]);
    const map = buildWholeMap(tree, 'metric:supportingSystemCount', [supports('s1', 'c1'), supports('s1', 'c2')], systems, new Set());
    expect(map.problemCount).toBe(0);
    expect(map.legend).toEqual([]);
  });

  it('shows nothing at all when colouring is switched off', () => {
    const map = buildWholeMap(tree, 'none', [], new Map(), new Set());
    expect(map.problemCount).toBe(0);
  });
});

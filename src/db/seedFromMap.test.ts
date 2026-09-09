import { describe, expect, it } from 'vitest';
import type { ElementCreate } from '../contracts/delta';
import type { CapabilityMapItemRow } from './capabilityMapTemplates';
import { buildSeedDeltas } from './seedFromMap';

function item(overrides: Partial<CapabilityMapItemRow> & Pick<CapabilityMapItemRow, 'code' | 'name' | 'level' | 'parent_code'>): CapabilityMapItemRow {
  return {
    id: `item-${overrides.code}`,
    map_id: 'map-1',
    description: null,
    ...overrides,
  };
}

/** Every delta this flow ever builds is `element.create` — asserted once here so every test below can index into `.elementId`/`.attributes`/etc. without re-narrowing. */
function asCreates(deltas: ReturnType<typeof buildSeedDeltas>['deltas']): ElementCreate<'capability'>[] {
  return deltas.map((d) => {
    if (d.kind !== 'element.create') throw new Error('expected only element.create deltas');
    return d as ElementCreate<'capability'>;
  });
}

describe('buildSeedDeltas', () => {
  it('builds one element.create per item, root before child, with code/templateRef set', () => {
    const items = [item({ code: '1', name: 'Root', level: 1, parent_code: null }), item({ code: '1.1', name: 'Child', level: 2, parent_code: '1' })];
    let n = 0;
    const { deltas } = buildSeedDeltas(items, 'source-1', () => `id-${String(n++)}`);
    const creates = asCreates(deltas);

    expect(creates).toHaveLength(2);
    expect(creates[0]?.name).toBe('Root');
    expect(creates[0]?.parentId).toBeNull();
    expect(creates[0]?.attributes).toEqual({ code: '1', templateRef: 'item-1' });
    expect(creates[1]?.name).toBe('Child');
    expect(creates[1]?.parentId).toBe(creates[0]?.elementId);
    expect(creates[1]?.attributes).toEqual({ code: '1.1', templateRef: 'item-1.1' });
  });

  it('every delta shares the given sourceId and confidence 1 (template seeds are always fully confident)', () => {
    const items = [item({ code: '1', name: 'Root', level: 1, parent_code: null })];
    const { deltas } = buildSeedDeltas(items, 'source-xyz');
    expect(deltas[0]).toMatchObject({ sourceId: 'source-xyz', confidence: 1 });
  });

  it('Bug A2: copies a non-empty map item description onto attributes.description, with the same sourceId/confidence as the rest of the delta', () => {
    const items = [item({ code: '1', name: 'Root', level: 1, parent_code: null, description: 'What this capability covers.' })];
    const { deltas } = buildSeedDeltas(items, 'source-1');
    const creates = asCreates(deltas);
    expect(creates[0]?.attributes).toEqual({ code: '1', templateRef: 'item-1', description: 'What this capability covers.' });
    expect(creates[0]?.sourceId).toBe('source-1');
    expect(creates[0]?.confidence).toBe(1);
  });

  it("Bug A2: a null or all-whitespace description is omitted entirely, not written as an empty string", () => {
    const items = [
      item({ code: '1', name: 'Root', level: 1, parent_code: null, description: null }),
      item({ code: '1.1', name: 'Child', level: 2, parent_code: '1', description: '   ' }),
    ];
    const { deltas } = buildSeedDeltas(items, 'source-1');
    const creates = asCreates(deltas);
    for (const create of creates) {
      expect(create.attributes).not.toHaveProperty('description');
    }
  });

  it('links a three-level tree correctly regardless of input order', () => {
    const items = [
      item({ code: '1.1.1', name: 'Grandchild', level: 3, parent_code: '1.1' }),
      item({ code: '1', name: 'Root', level: 1, parent_code: null }),
      item({ code: '1.1', name: 'Child', level: 2, parent_code: '1' }),
    ];
    const { deltas } = buildSeedDeltas(items, 'source-1');
    const creates = asCreates(deltas);
    const byCode = new Map(creates.map((c) => [c.attributes.code, c]));

    const root = byCode.get('1');
    const child = byCode.get('1.1');
    const grandchild = byCode.get('1.1.1');
    expect(root?.parentId).toBeNull();
    expect(child?.parentId).toBe(root?.elementId);
    expect(grandchild?.parentId).toBe(child?.elementId);
  });

  it('rejects an item whose parent_code names no item in the given set', () => {
    const items = [item({ code: '1.1', name: 'Orphan', level: 2, parent_code: 'missing' })];
    expect(() => buildSeedDeltas(items, 'source-1')).toThrow(/names parent "missing"/);
  });

  it('builds one template_code alias per item, matching its minted elementId', () => {
    const items = [item({ code: '1', name: 'Root', level: 1, parent_code: null }), item({ code: '1.1', name: 'Child', level: 2, parent_code: '1' })];
    const { deltas, aliases } = buildSeedDeltas(items, 'source-1');
    const creates = asCreates(deltas);

    expect(aliases).toHaveLength(2);
    for (const alias of aliases) {
      const matching = creates.find((c) => c.elementId === alias.elementId);
      expect(matching?.attributes.code).toBe(alias.aliasValue);
    }
  });

  it('returns nothing for an empty item list', () => {
    expect(buildSeedDeltas([], 'source-1')).toEqual({ deltas: [], aliases: [] });
  });
});

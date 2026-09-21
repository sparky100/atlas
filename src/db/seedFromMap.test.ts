import { describe, expect, it } from 'vitest';
import type { ElementCreate } from '../contracts/delta';
import type { CapabilityMapItemRow, CapabilityMapValueStreamEnablesRow, CapabilityMapValueStreamItemRow } from './capabilityMapTemplates';
import { buildSeedDeltas } from './seedFromMap';

function item(overrides: Partial<CapabilityMapItemRow> & Pick<CapabilityMapItemRow, 'code' | 'name' | 'level' | 'parent_code'>): CapabilityMapItemRow {
  return {
    id: `item-${overrides.code}`,
    map_id: 'map-1',
    description: null,
    item_order: 10,
    ...overrides,
  };
}

function vsItem(overrides: Partial<CapabilityMapValueStreamItemRow> & Pick<CapabilityMapValueStreamItemRow, 'code' | 'name' | 'parent_code'>): CapabilityMapValueStreamItemRow {
  return { id: `vs-${overrides.code}`, map_id: 'map-1', description: null, item_order: 10, ...overrides };
}

function enablesRow(stage_code: string, capability_code: string): CapabilityMapValueStreamEnablesRow {
  return { map_id: 'map-1', stage_code, capability_code };
}

/** Every delta this flow ever builds is `element.create` — asserted once here so every test below can index into `.elementId`/`.attributes`/etc. without re-narrowing. */
function asCreates(deltas: ReturnType<typeof buildSeedDeltas>['deltas']): ElementCreate<'capability'>[] {
  return deltas.map((d) => {
    if (d.kind !== 'element.create') throw new Error('expected only element.create deltas');
    return d as ElementCreate<'capability'>;
  });
}

describe('buildSeedDeltas', () => {
  it('builds one element.create per item, root before child, with templateRef/order set and no code (ADR-020: never seed-populated)', () => {
    const items = [item({ code: '1', name: 'Root', level: 1, parent_code: null, item_order: 10 }), item({ code: '1.1', name: 'Child', level: 2, parent_code: '1', item_order: 20 })];
    let n = 0;
    const { deltas } = buildSeedDeltas(items, 'source-1', () => `id-${String(n++)}`);
    const creates = asCreates(deltas);

    expect(creates).toHaveLength(2);
    expect(creates[0]?.name).toBe('Root');
    expect(creates[0]?.parentId).toBeNull();
    expect(creates[0]?.attributes).toEqual({ templateRef: 'item-1', order: 10 });
    expect(creates[1]?.name).toBe('Child');
    expect(creates[1]?.parentId).toBe(creates[0]?.elementId);
    expect(creates[1]?.attributes).toEqual({ templateRef: 'item-1.1', order: 20 });
  });

  it('every delta shares the given sourceId and confidence 1 (template seeds are always fully confident)', () => {
    const items = [item({ code: '1', name: 'Root', level: 1, parent_code: null })];
    const { deltas } = buildSeedDeltas(items, 'source-xyz');
    expect(deltas[0]).toMatchObject({ sourceId: 'source-xyz', confidence: 1 });
  });

  it('Bug A2: copies a non-empty map item description onto attributes.description, with the same sourceId/confidence as the rest of the delta', () => {
    const items = [item({ code: '1', name: 'Root', level: 1, parent_code: null, description: 'What this capability covers.', item_order: 10 })];
    const { deltas } = buildSeedDeltas(items, 'source-1');
    const creates = asCreates(deltas);
    expect(creates[0]?.attributes).toEqual({ templateRef: 'item-1', description: 'What this capability covers.', order: 10 });
    expect(creates[0]?.sourceId).toBe('source-1');
    expect(creates[0]?.confidence).toBe(1);
  });

  it('Sprint U4-1 C1: carries the map item\'s own item_order onto attributes.order verbatim', () => {
    const items = [item({ code: '9', name: 'Core Capability', level: 1, parent_code: null, item_order: 1000 })];
    const { deltas } = buildSeedDeltas(items, 'source-1');
    const creates = asCreates(deltas);
    expect(creates[0]?.attributes.order).toBe(1000);
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
    const { deltas, aliases } = buildSeedDeltas(items, 'source-1');
    const creates = asCreates(deltas);
    // ADR-020: `attributes.code` is never set at seed time — the
    // `template_code` alias (`aliasValue` = the item's own code) is what
    // still identifies which created element came from which item.
    const elementIdByCode = new Map(aliases.map((a) => [a.aliasValue, a.elementId]));
    const byCode = new Map(creates.map((c) => [c.elementId, c]));

    const root = byCode.get(elementIdByCode.get('1') ?? '');
    const child = byCode.get(elementIdByCode.get('1.1') ?? '');
    const grandchild = byCode.get(elementIdByCode.get('1.1.1') ?? '');
    expect(root?.parentId).toBeNull();
    expect(child?.parentId).toBe(root?.elementId);
    expect(grandchild?.parentId).toBe(child?.elementId);
  });

  it('rejects an item whose parent_code names no item in the given set', () => {
    const items = [item({ code: '1.1', name: 'Orphan', level: 2, parent_code: 'missing' })];
    expect(() => buildSeedDeltas(items, 'source-1')).toThrow(/names parent "missing"/);
  });

  it('builds one template_code alias per item, matching its minted elementId, and carries no attributes.code (ADR-020)', () => {
    const items = [item({ code: '1', name: 'Root', level: 1, parent_code: null }), item({ code: '1.1', name: 'Child', level: 2, parent_code: '1' })];
    const { deltas, aliases } = buildSeedDeltas(items, 'source-1');
    const creates = asCreates(deltas);

    expect(aliases).toHaveLength(2);
    expect(new Set(aliases.map((a) => a.aliasValue))).toEqual(new Set(['1', '1.1']));
    for (const alias of aliases) {
      const matching = creates.find((c) => c.elementId === alias.elementId);
      expect(matching).toBeDefined();
      expect(matching?.attributes).not.toHaveProperty('code');
    }
  });

  it('returns nothing for an empty item list', () => {
    expect(buildSeedDeltas([], 'source-1')).toEqual({ deltas: [], aliases: [] });
  });
});

describe('buildSeedDeltas value streams (F6/ADR-023)', () => {
  it('creates value_stream elements, streams before stages, with templateRef/order and no code', () => {
    const items = [item({ code: '1', name: 'Root', level: 1, parent_code: null })];
    const streams = [
      vsItem({ code: 'vs1', name: 'Customer Outcomes', parent_code: null, item_order: 10 }),
      vsItem({ code: 'vs1.1', name: 'Getting Connected', parent_code: 'vs1', item_order: 10 }),
    ];
    const { deltas } = buildSeedDeltas(items, 'source-1', undefined, streams, []);
    const valueStreams = deltas.filter((d) => d.kind === 'element.create' && d.elementType === 'value_stream');
    expect(valueStreams).toHaveLength(2);
    expect(valueStreams[0]?.name).toBe('Customer Outcomes');
    expect(valueStreams[0]?.parentId).toBeNull();
    expect(valueStreams[1]?.name).toBe('Getting Connected');
    expect(valueStreams[1]?.parentId).toBe(valueStreams[0]?.elementId);
    expect(valueStreams[0]?.attributes).toEqual({ templateRef: 'vs-vs1', order: 10 });
    expect(valueStreams[0]?.attributes).not.toHaveProperty('code');
  });

  it('creates enables relationship.create deltas resolving capability and stage codes to minted ids', () => {
    const items = [item({ code: '1', name: 'Connections', level: 1, parent_code: null })];
    const streams = [
      vsItem({ code: 'vs1', name: 'Getting Connected', parent_code: null }),
      vsItem({ code: 'vs1.1', name: 'Connect', parent_code: 'vs1' }),
    ];
    const { deltas, aliases } = buildSeedDeltas(items, 'source-1', undefined, streams, [enablesRow('vs1.1', '1')]);
    const rel = deltas.find((d) => d.kind === 'relationship.create');
    if (!rel) throw new Error('expected a relationship.create delta');
    expect(rel.relationshipType).toBe('enables');
    const capabilityId = aliases.find((a) => a.aliasValue === '1')?.elementId;
    const stageId = aliases.find((a) => a.aliasValue === 'vs1.1')?.elementId;
    expect(rel.fromElementId).toBe(capabilityId);
    expect(rel.toElementId).toBe(stageId);
    expect(rel.attributes).toEqual({});
  });

  it('rejects an enables row naming an unknown capability or stage code', () => {
    const items = [item({ code: '1', name: 'Root', level: 1, parent_code: null })];
    const streams = [vsItem({ code: 'vs1', name: 'Stream', parent_code: null }), vsItem({ code: 'vs1.1', name: 'Stage', parent_code: 'vs1' })];
    expect(() => buildSeedDeltas(items, 'source-1', undefined, streams, [enablesRow('vs1.1', 'missing')])).toThrow(/capability_code "missing"/);
    expect(() => buildSeedDeltas(items, 'source-1', undefined, streams, [enablesRow('missing', '1')])).toThrow(/stage_code "missing"/);
  });

  it('rejects a stage whose parent_code names no value stream in the set', () => {
    const items = [item({ code: '1', name: 'Root', level: 1, parent_code: null })];
    const streams = [vsItem({ code: 'vs1.1', name: 'Orphan Stage', parent_code: 'missing' })];
    expect(() => buildSeedDeltas(items, 'source-1', undefined, streams, [])).toThrow(/names parent "missing"/);
  });
});

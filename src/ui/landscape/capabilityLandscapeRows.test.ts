import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { capabilitySubtreeIds, computeCapabilityLandscapeRows } from './capabilityLandscapeRows';

function capability(id: string, name: string, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

function system(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function actor(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'actor', name, parent_id: null, attributes: { subtype: 'team', isExternal: false }, exists_delta_id: `d-${id}` };
}

let nextOrdinal = 0;
function supports(fromId: string, toId: string, role: 'primary' | 'secondary'): RelationshipsHeadRow {
  nextOrdinal += 1;
  return { relationship_id: `r-${String(nextOrdinal)}`, relationship_type: 'supports', from_element_id: fromId, to_element_id: toId, attributes: { role }, exists_delta_id: `d-r-${String(nextOrdinal)}` };
}

function landscapeEdge(type: 'uses' | 'flows_to', fromId: string, toId: string): RelationshipsHeadRow {
  nextOrdinal += 1;
  return { relationship_id: `e-${String(nextOrdinal)}`, relationship_type: type, from_element_id: fromId, to_element_id: toId, attributes: {}, exists_delta_id: `d-e-${String(nextOrdinal)}` };
}

describe('capabilitySubtreeIds', () => {
  it('includes the root and every descendant, across more than one level', () => {
    const root = capability('root', 'Root');
    const child = capability('child', 'Child', 'root');
    const grandchild = capability('grandchild', 'Grandchild', 'child');
    const unrelated = capability('unrelated', 'Unrelated');
    const ids = capabilitySubtreeIds('root', [root, child, grandchild, unrelated]);
    expect(ids).toEqual(new Set(['root', 'child', 'grandchild']));
  });

  it('never includes a sibling or an unrelated capability', () => {
    const root = capability('root', 'Root');
    const sibling = capability('sibling', 'Sibling');
    const ids = capabilitySubtreeIds('root', [root, sibling]);
    expect(ids).toEqual(new Set(['root']));
  });

  it('is order-independent (CLAUDE.md rule 6: deterministic given the same inputs)', () => {
    const root = capability('root', 'Root');
    const child = capability('child', 'Child', 'root');
    const grandchild = capability('grandchild', 'Grandchild', 'child');
    const a = capabilitySubtreeIds('root', [root, child, grandchild]);
    const b = capabilitySubtreeIds('root', [grandchild, child, root]);
    expect(a).toEqual(b);
  });
});

describe('computeCapabilityLandscapeRows', () => {
  it('sections a direct-to-root primary edge as Primary, with no viaCapability', () => {
    const root = capability('root', 'Root');
    const sys = system('sys-1', 'Billing');
    const rows = computeCapabilityLandscapeRows('root', [supports('sys-1', 'root', 'primary')], new Map([['sys-1', sys]]), new Map([['root', root]]), [], new Map());
    expect(rows.primary).toHaveLength(1);
    expect(rows.secondary).toHaveLength(0);
    expect(rows.count).toBe(1);
    expect(rows.primary[0]?.viaCapability).toBeNull();
    expect(rows.primary[0]?.role).toBe('primary');
  });

  it('sections a direct-to-root secondary edge as Also-supports, with no viaCapability', () => {
    const root = capability('root', 'Root');
    const sys = system('sys-1', 'Billing');
    const rows = computeCapabilityLandscapeRows('root', [supports('sys-1', 'root', 'secondary')], new Map([['sys-1', sys]]), new Map([['root', root]]), [], new Map());
    expect(rows.secondary).toHaveLength(1);
    expect(rows.secondary[0]?.viaCapability).toBeNull();
  });

  it('names the child capability when the edge targets a descendant, not the root — "child capabilities\' systems included with the child named"', () => {
    const root = capability('root', 'Root');
    const child = capability('child', 'Child', 'root');
    const sys = system('sys-1', 'Billing');
    const rows = computeCapabilityLandscapeRows('root', [supports('sys-1', 'child', 'secondary')], new Map([['sys-1', sys]]), new Map([['root', root], ['child', child]]), [], new Map());
    expect(rows.secondary[0]?.viaCapability?.element_id).toBe('child');
  });

  it('a primary edge to a child still sections into Primary, still names the child', () => {
    const root = capability('root', 'Root');
    const child = capability('child', 'Child', 'root');
    const sys = system('sys-1', 'Billing');
    const rows = computeCapabilityLandscapeRows('root', [supports('sys-1', 'child', 'primary')], new Map([['sys-1', sys]]), new Map([['root', root], ['child', child]]), [], new Map());
    expect(rows.primary).toHaveLength(1);
    expect(rows.primary[0]?.viaCapability?.element_id).toBe('child');
  });

  it('one row per system: a system with edges into more than one capability in the subtree picks its primary edge over any secondary one', () => {
    const root = capability('root', 'Root');
    const child = capability('child', 'Child', 'root');
    const sys = system('sys-1', 'Billing');
    const edges = [supports('sys-1', 'root', 'secondary'), supports('sys-1', 'child', 'primary')];
    const rows = computeCapabilityLandscapeRows('root', edges, new Map([['sys-1', sys]]), new Map([['root', root], ['child', child]]), [], new Map());
    expect(rows.count).toBe(1);
    expect(rows.primary).toHaveLength(1);
    expect(rows.primary[0]?.viaCapability?.element_id).toBe('child');
  });

  it('when every edge in scope is secondary, a direct edge to the root wins over one to a child', () => {
    const root = capability('root', 'Root');
    const child = capability('child', 'Child', 'root');
    const sys = system('sys-1', 'Billing');
    const edges = [supports('sys-1', 'child', 'secondary'), supports('sys-1', 'root', 'secondary')];
    const rows = computeCapabilityLandscapeRows('root', edges, new Map([['sys-1', sys]]), new Map([['root', root], ['child', child]]), [], new Map());
    expect(rows.secondary).toHaveLength(1);
    expect(rows.secondary[0]?.viaCapability).toBeNull();
  });

  it('counts uses/used-by from the given edges, and omits the pair from neither being asked to render — the caller decides "only when non-zero"', () => {
    const root = capability('root', 'Root');
    const hub = system('hub', 'Hub');
    const other = system('other', 'Other');
    const edges = [supports('hub', 'root', 'primary'), supports('other', 'root', 'secondary')];
    const landscapeEdges = [landscapeEdge('uses', 'hub', 'other'), landscapeEdge('flows_to', 'other', 'hub')];
    const rows = computeCapabilityLandscapeRows('root', edges, new Map([['hub', hub], ['other', other]]), new Map([['root', root]]), landscapeEdges, new Map());
    expect(rows.primary[0]?.usesCount).toBe(1);
    expect(rows.primary[0]?.usedByCount).toBe(1);
  });

  it('resolves each row\'s own owner from the given ownersByElementId map, null when absent', () => {
    const root = capability('root', 'Root');
    const sys = system('sys-1', 'Billing');
    const owner = actor('act-1', 'Finance Team');
    const rows = computeCapabilityLandscapeRows('root', [supports('sys-1', 'root', 'primary')], new Map([['sys-1', sys]]), new Map([['root', root]]), [], new Map([['sys-1', owner]]));
    expect(rows.primary[0]?.owner?.element_id).toBe('act-1');
  });

  it('is deterministic: the same inputs, in a different array order, produce the same rows', () => {
    const root = capability('root', 'Root');
    const child = capability('child', 'Child', 'root');
    const systems = [system('sys-a', 'Alpha'), system('sys-b', 'Bravo'), system('sys-c', 'Charlie')];
    const edges = [supports('sys-a', 'root', 'primary'), supports('sys-b', 'child', 'secondary'), supports('sys-c', 'root', 'secondary')];
    const systemsById = new Map(systems.map((s) => [s.element_id, s]));
    const capabilitiesById = new Map([['root', root], ['child', child]]);
    const a = computeCapabilityLandscapeRows('root', edges, systemsById, capabilitiesById, [], new Map());
    const b = computeCapabilityLandscapeRows('root', [...edges].reverse(), systemsById, capabilitiesById, [], new Map());
    expect(b).toEqual(a);
  });

  it('produces no rows for an empty subtree, without erroring', () => {
    const root = capability('root', 'Root');
    const rows = computeCapabilityLandscapeRows('root', [], new Map(), new Map([['root', root]]), [], new Map());
    expect(rows.primary).toEqual([]);
    expect(rows.secondary).toEqual([]);
    expect(rows.count).toBe(0);
  });

  it('skips an edge whose system was never resolved (e.g. filtered out upstream), never throwing', () => {
    const root = capability('root', 'Root');
    const rows = computeCapabilityLandscapeRows('root', [supports('missing-sys', 'root', 'primary')], new Map(), new Map([['root', root]]), [], new Map());
    expect(rows.count).toBe(0);
  });

  it('sorts each section by system name then id', () => {
    const root = capability('root', 'Root');
    const systems = [system('sys-z', 'Zeta'), system('sys-a', 'Alpha')];
    const edges = [supports('sys-z', 'root', 'primary'), supports('sys-a', 'root', 'primary')];
    const rows = computeCapabilityLandscapeRows('root', edges, new Map(systems.map((s) => [s.element_id, s])), new Map([['root', root]]), [], new Map());
    expect(rows.primary.map((r) => r.system.element_id)).toEqual(['sys-a', 'sys-z']);
  });
});

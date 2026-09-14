import { describe, expect, it } from 'vitest';
import { capabilityLevel, capabilitySubtreeIds, l1AncestorOf, loadCapabilityAncestry } from './capabilityDepth';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';

function capability(id: string, parentId: string | null): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name: id, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

describe('capabilityLevel', () => {
  it('is 1 for a root capability (no parent)', () => {
    expect(capabilityLevel(null, null)).toBe(1);
  });

  it('is 2 for a capability whose parent is itself a root', () => {
    expect(capabilityLevel(capability('p', null), null)).toBe(2);
  });

  it('is 3 for a capability whose grandparent is a root', () => {
    expect(capabilityLevel(capability('p', 'gp'), capability('gp', null))).toBe(3);
  });

  it('is null when the parent has a parent but the grandparent was not supplied', () => {
    expect(capabilityLevel(capability('p', 'gp'), null)).toBeNull();
  });

  it('is null when nesting goes deeper than 3 levels', () => {
    expect(capabilityLevel(capability('p', 'gp'), capability('gp', 'ggp'))).toBeNull();
  });
});

describe('capabilitySubtreeIds', () => {
  it('includes the root and every descendant, across more than one level', () => {
    const root = capability('root', null);
    const child = capability('child', 'root');
    const grandchild = capability('grandchild', 'child');
    const unrelated = capability('unrelated', null);
    const ids = capabilitySubtreeIds('root', [root, child, grandchild, unrelated]);
    expect(ids).toEqual(new Set(['root', 'child', 'grandchild']));
  });

  it('never includes a sibling or an unrelated capability', () => {
    const root = capability('root', null);
    const sibling = capability('sibling', null);
    const ids = capabilitySubtreeIds('root', [root, sibling]);
    expect(ids).toEqual(new Set(['root']));
  });

  it('is order-independent (CLAUDE.md rule 6: deterministic given the same inputs)', () => {
    const root = capability('root', null);
    const child = capability('child', 'root');
    const grandchild = capability('grandchild', 'child');
    const a = capabilitySubtreeIds('root', [root, child, grandchild]);
    const b = capabilitySubtreeIds('root', [grandchild, child, root]);
    expect(a).toEqual(b);
  });
});

describe('l1AncestorOf', () => {
  it('is itself for a root capability', () => {
    const all = new Map([['root', capability('root', null)]]);
    expect(l1AncestorOf('root', all)).toEqual(capability('root', null));
  });

  it('is the parent for a level-2 capability', () => {
    const all = new Map([
      ['root', capability('root', null)],
      ['l2', capability('l2', 'root')],
    ]);
    expect(l1AncestorOf('l2', all)).toEqual(capability('root', null));
  });

  it('is the grandparent for a level-3 capability', () => {
    const all = new Map([
      ['root', capability('root', null)],
      ['l2', capability('l2', 'root')],
      ['l3', capability('l3', 'l2')],
    ]);
    expect(l1AncestorOf('l3', all)).toEqual(capability('root', null));
  });

  it('is null when the chain nests deeper than 3 levels', () => {
    const all = new Map([
      ['root', capability('root', null)],
      ['l2', capability('l2', 'root')],
      ['l3', capability('l3', 'l2')],
      ['l4', capability('l4', 'l3')],
    ]);
    expect(l1AncestorOf('l4', all)).toBeNull();
  });

  it('is null when the capability itself is not in the map', () => {
    expect(l1AncestorOf('ghost', new Map())).toBeNull();
  });

  it('is null when a link in the chain is missing from the map', () => {
    const all = new Map([['l2', capability('l2', 'root')]]);
    expect(l1AncestorOf('l2', all)).toBeNull();
  });
});

describe('loadCapabilityAncestry', () => {
  it('fetches nothing more when every leaf is already a root', async () => {
    const leaves = new Map([['root', capability('root', null)]]);
    const byIds = (): Promise<Map<UUID, ElementsHeadRow>> => {
      throw new Error('should not be called — nothing has a parent to fetch');
    };
    const all = await loadCapabilityAncestry(byIds, leaves);
    expect(all).toEqual(leaves);
  });

  it('fetches one round for a level-2 leaf (its parent)', async () => {
    const leaves = new Map([['l2', capability('l2', 'root')]]);
    const byIds = (ids: readonly UUID[]): Promise<Map<UUID, ElementsHeadRow>> => {
      expect(ids).toEqual(['root']);
      return Promise.resolve(new Map([['root', capability('root', null)]]));
    };
    const all = await loadCapabilityAncestry(byIds, leaves);
    expect(l1AncestorOf('l2', all)).toEqual(capability('root', null));
  });

  it('fetches two rounds for a level-3 leaf (parent, then grandparent), and stops there', async () => {
    const leaves = new Map([['l3', capability('l3', 'l2')]]);
    const calls: (readonly UUID[])[] = [];
    const byIds = (ids: readonly UUID[]): Promise<Map<UUID, ElementsHeadRow>> => {
      calls.push(ids);
      if (ids[0] === 'l2') return Promise.resolve(new Map([['l2', capability('l2', 'root')]]));
      return Promise.resolve(new Map([['root', capability('root', null)]]));
    };
    const all = await loadCapabilityAncestry(byIds, leaves);
    expect(calls).toEqual([['l2'], ['root']]);
    expect(l1AncestorOf('l3', all)).toEqual(capability('root', null));
  });

  it('de-duplicates parent ids shared by more than one leaf, fetching each id once', async () => {
    const leaves = new Map([
      ['a', capability('a', 'shared-parent')],
      ['b', capability('b', 'shared-parent')],
    ]);
    const byIds = (ids: readonly UUID[]): Promise<Map<UUID, ElementsHeadRow>> => {
      expect(ids).toEqual(['shared-parent']);
      return Promise.resolve(new Map([['shared-parent', capability('shared-parent', null)]]));
    };
    const all = await loadCapabilityAncestry(byIds, leaves);
    expect(l1AncestorOf('a', all)).toEqual(capability('shared-parent', null));
    expect(l1AncestorOf('b', all)).toEqual(capability('shared-parent', null));
  });
});

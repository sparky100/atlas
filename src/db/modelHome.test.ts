import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import { buildCapabilityTiles, commitsSincePreviousTag, computeExposureTone, groupPlannedReplacementsByCapability, type PlannedReplacement } from './modelHome';

function system(id: string, lifecycleStatus: string | undefined): ElementsHeadRow {
  return {
    element_id: id,
    element_type: 'system',
    name: `System ${id}`,
    parent_id: null,
    attributes: lifecycleStatus === undefined ? {} : { lifecycleStatus },
    exists_delta_id: `delta-${id}`,
  };
}

function supportsEdge(fromElementId: string, toElementId: string, attributes: Record<string, string> = {}): RelationshipsHeadRow {
  return {
    relationship_id: `${fromElementId}-supports-${toElementId}`,
    relationship_type: 'supports',
    from_element_id: fromElementId,
    to_element_id: toElementId,
    attributes,
    exists_delta_id: `delta-${fromElementId}-${toElementId}`,
  };
}

describe('computeExposureTone', () => {
  it('is ok when no supporting system is retiring or retired', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'active')]]);
    const edges = [supportsEdge('sys-1', 'cap-1')];

    expect(computeExposureTone(edges, systemsById)).toBe('ok');
  });

  it('is ok for a capability with no supporting systems at all', () => {
    expect(computeExposureTone([], new Map())).toBe('ok');
  });

  it('warns when a supporting system is retiring and no planned replacement was found', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'retiring')]]);
    const edges = [supportsEdge('sys-1', 'cap-1')];

    expect(computeExposureTone(edges, systemsById)).toBe('warn');
    expect(computeExposureTone(edges, systemsById, new Set())).toBe('warn');
  });

  it('warns when a supporting system is retired', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'retired')]]);
    const edges = [supportsEdge('sys-1', 'cap-1')];

    expect(computeExposureTone(edges, systemsById)).toBe('warn');
  });

  it('reads info ("replacement planned") when the exposed system has a planned replacement', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'retiring')]]);
    const edges = [supportsEdge('sys-1', 'cap-1')];

    expect(computeExposureTone(edges, systemsById, new Set(['sys-1']))).toBe('info');
  });

  it('warns, not info, when only some of several exposed systems have a planned replacement — never falsely calm', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', 'retiring')],
      ['sys-2', system('sys-2', 'retired')],
    ]);
    const edges = [supportsEdge('sys-1', 'cap-1'), supportsEdge('sys-2', 'cap-1')];

    // Only sys-1 has a planned replacement; sys-2 does not.
    expect(computeExposureTone(edges, systemsById, new Set(['sys-1']))).toBe('warn');
  });

  it('reads info when every exposed system for this capability has a planned replacement', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', 'retiring')],
      ['sys-2', system('sys-2', 'retired')],
    ]);
    const edges = [supportsEdge('sys-1', 'cap-1'), supportsEdge('sys-2', 'cap-1')];

    expect(computeExposureTone(edges, systemsById, new Set(['sys-1', 'sys-2']))).toBe('info');
  });

  it('a planned replacement for a different capability does not calm this one — callers must scope the set themselves', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'retiring')]]);
    const edges = [supportsEdge('sys-1', 'cap-1')];

    // A replacement id that doesn't match sys-1 at all.
    expect(computeExposureTone(edges, systemsById, new Set(['sys-unrelated']))).toBe('warn');
  });

  it('ignores an edge whose supporting system is missing from systemsById (e.g. an actor, not a system)', () => {
    expect(computeExposureTone([supportsEdge('actor-1', 'cap-1')], new Map())).toBe('ok');
  });

  it('ignores a system with no recorded lifecycleStatus at all', () => {
    const systemsById = new Map([['sys-1', system('sys-1', undefined)]]);
    expect(computeExposureTone([supportsEdge('sys-1', 'cap-1')], systemsById)).toBe('ok');
  });

  it('planned or active lifecycle status is not exposure', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', 'planned')],
      ['sys-2', system('sys-2', 'active')],
    ]);
    const edges = [supportsEdge('sys-1', 'cap-1'), supportsEdge('sys-2', 'cap-1')];
    expect(computeExposureTone(edges, systemsById)).toBe('ok');
  });
});

function capability(id: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name: `Capability ${id}`, parent_id: null, attributes: {}, exists_delta_id: `delta-${id}` };
}

describe('buildCapabilityTiles', () => {
  it('is neutral ("nothing recorded") for a capability with no supporting systems', () => {
    const caps = [capability('cap-1')];
    const tiles = buildCapabilityTiles(caps, caps, [], new Map(), [], new Set());
    expect(tiles).toEqual([
      {
        capability: capability('cap-1'),
        supportingSystems: [],
        exposedSystems: [],
        tone: 'neutral',
        supportedCapabilityCount: 0,
        totalCapabilityCount: 1,
        isOwned: false,
        fitForPurpose: null,
        poorFitCapabilities: [],
        poorFitAllReplacementPlanned: false,
      },
    ]);
  });

  it('is ok for a capability whose supporting systems are all active', () => {
    const sys = system('sys-1', 'active');
    const systemsById = new Map([['sys-1', sys]]);
    const caps = [capability('cap-1')];
    const tiles = buildCapabilityTiles(caps, caps, [supportsEdge('sys-1', 'cap-1')], systemsById, [], new Set());
    expect(tiles[0]).toMatchObject({ tone: 'ok', supportingSystems: [sys], exposedSystems: [] });
  });

  it('warns and names the exposed system when a supporting system is retiring with no planned replacement', () => {
    const sys = system('sys-1', 'retiring');
    const systemsById = new Map([['sys-1', sys]]);
    const caps = [capability('cap-1')];
    const tiles = buildCapabilityTiles(caps, caps, [supportsEdge('sys-1', 'cap-1')], systemsById, [], new Set());
    expect(tiles[0]).toMatchObject({ tone: 'warn', exposedSystems: [sys] });
  });

  it('reads info when a planned replacement for this exact capability is found', () => {
    const sys = system('sys-1', 'retiring');
    const systemsById = new Map([['sys-1', sys]]);
    const replacements: PlannedReplacement[] = [{ capabilityId: 'cap-1', exposedSystemId: 'sys-1', replacementSystemId: 'sys-2', branchId: 'branch-1' }];
    const caps = [capability('cap-1')];
    const tiles = buildCapabilityTiles(caps, caps, [supportsEdge('sys-1', 'cap-1')], systemsById, replacements, new Set());
    expect(tiles[0]?.tone).toBe('info');
  });

  it('scopes edges and tiles to each capability independently — one exposed, one healthy, one unrecorded', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', 'retiring')],
      ['sys-2', system('sys-2', 'active')],
    ]);
    const edges = [supportsEdge('sys-1', 'cap-exposed'), supportsEdge('sys-2', 'cap-healthy')];
    const caps = [capability('cap-exposed'), capability('cap-healthy'), capability('cap-unrecorded')];
    const tiles = buildCapabilityTiles(caps, caps, edges, systemsById, [], new Set());
    expect(tiles.map((t) => t.tone)).toEqual(['warn', 'ok', 'neutral']);
  });

  it('a planned replacement recorded for a different capability does not leak into this one', () => {
    const sys = system('sys-1', 'retiring');
    const systemsById = new Map([['sys-1', sys]]);
    const replacements: PlannedReplacement[] = [{ capabilityId: 'cap-other', exposedSystemId: 'sys-1', replacementSystemId: 'sys-2', branchId: 'branch-1' }];
    const caps = [capability('cap-1')];
    const tiles = buildCapabilityTiles(caps, caps, [supportsEdge('sys-1', 'cap-1')], systemsById, replacements, new Set());
    expect(tiles[0]?.tone).toBe('warn');
  });

  it('rolls a supporter of a descendant capability up into its level-1 ancestor tile', () => {
    const l1 = capability('cap-l1');
    const l2 = { ...capability('cap-l2'), parent_id: 'cap-l1' };
    const sys = system('sys-1', 'active');
    const systemsById = new Map([['sys-1', sys]]);
    const tiles = buildCapabilityTiles([l1], [l1, l2], [supportsEdge('sys-1', 'cap-l2')], systemsById, [], new Set());
    expect(tiles[0]).toMatchObject({ supportingSystems: [sys], supportedCapabilityCount: 1, totalCapabilityCount: 2 });
  });

  it('isOwned is true when the level-1 capability is self-owned', () => {
    const caps = [capability('cap-1')];
    const tiles = buildCapabilityTiles(caps, caps, [], new Map(), [], new Set(['cap-1']));
    expect(tiles[0]?.isOwned).toBe(true);
  });

  describe('poorFitCapabilities / poorFitAllReplacementPlanned (F6.1: fit visible to directors)', () => {
    it('flags a capability with a poor-rated primary supports edge', () => {
      const sys = system('sys-1', 'active');
      const systemsById = new Map([['sys-1', sys]]);
      const caps = [capability('cap-1')];
      const tiles = buildCapabilityTiles(caps, caps, [supportsEdge('sys-1', 'cap-1', { role: 'primary', fitForPurpose: 'poor' })], systemsById, [], new Set());
      expect(tiles[0]?.poorFitCapabilities.map((c) => c.element_id)).toEqual(['cap-1']);
      expect(tiles[0]?.poorFitAllReplacementPlanned).toBe(false);
    });

    it('flags a capability whose only rated supporter is secondary — unlike the Architect finding, which is primary-only', () => {
      const sys = system('sys-1', 'active');
      const systemsById = new Map([['sys-1', sys]]);
      const caps = [capability('cap-1')];
      const tiles = buildCapabilityTiles(caps, caps, [supportsEdge('sys-1', 'cap-1', { role: 'secondary', fitForPurpose: 'poor' })], systemsById, [], new Set());
      expect(tiles[0]?.poorFitCapabilities.map((c) => c.element_id)).toEqual(['cap-1']);
    });

    it('does not flag a capability whose fit is only good/adequate, or unrated', () => {
      const sys = system('sys-1', 'active');
      const systemsById = new Map([['sys-1', sys]]);
      const caps = [capability('cap-1'), capability('cap-2'), capability('cap-3')];
      const edges = [
        supportsEdge('sys-1', 'cap-1', { fitForPurpose: 'good' }),
        supportsEdge('sys-1', 'cap-2', { fitForPurpose: 'adequate' }),
        supportsEdge('sys-1', 'cap-3'),
      ];
      const tiles = buildCapabilityTiles(caps, caps, edges, systemsById, [], new Set());
      for (const tile of tiles) expect(tile.poorFitCapabilities).toEqual([]);
    });

    it('a mixed subtree flags only its own poor-rated descendant, not the whole subtree', () => {
      const l1 = capability('cap-l1');
      const l2Good = { ...capability('cap-l2-good'), parent_id: 'cap-l1' };
      const l2Poor = { ...capability('cap-l2-poor'), parent_id: 'cap-l1' };
      const systemsById = new Map([['sys-1', system('sys-1', 'active')]]);
      const edges = [supportsEdge('sys-1', 'cap-l2-good', { fitForPurpose: 'good' }), supportsEdge('sys-1', 'cap-l2-poor', { fitForPurpose: 'poor' })];
      const tiles = buildCapabilityTiles([l1], [l1, l2Good, l2Poor], edges, systemsById, [], new Set());
      expect(tiles[0]?.poorFitCapabilities.map((c) => c.element_id)).toEqual(['cap-l2-poor']);
    });

    it('poorFitAllReplacementPlanned is true only once every poor-fit edge has its own planned replacement recorded', () => {
      const systemsById = new Map([
        ['sys-1', system('sys-1', 'active')],
        ['sys-2', system('sys-2', 'active')],
      ]);
      const caps = [capability('cap-1')];
      const edges = [supportsEdge('sys-1', 'cap-1', { fitForPurpose: 'poor' }), supportsEdge('sys-2', 'cap-1', { fitForPurpose: 'poor' })];

      const onlyOneReplaced: PlannedReplacement[] = [{ capabilityId: 'cap-1', exposedSystemId: 'sys-1', replacementSystemId: 'sys-3', branchId: 'branch-1' }];
      const partial = buildCapabilityTiles(caps, caps, edges, systemsById, onlyOneReplaced, new Set());
      expect(partial[0]?.poorFitAllReplacementPlanned).toBe(false);

      const bothReplaced: PlannedReplacement[] = [
        { capabilityId: 'cap-1', exposedSystemId: 'sys-1', replacementSystemId: 'sys-3', branchId: 'branch-1' },
        { capabilityId: 'cap-1', exposedSystemId: 'sys-2', replacementSystemId: 'sys-4', branchId: 'branch-2' },
      ];
      const complete = buildCapabilityTiles(caps, caps, edges, systemsById, bothReplaced, new Set());
      expect(complete[0]?.poorFitAllReplacementPlanned).toBe(true);
    });

    it('poorFitAllReplacementPlanned is false, never true, when nothing is rated poor at all', () => {
      const caps = [capability('cap-1')];
      const tiles = buildCapabilityTiles(caps, caps, [], new Map(), [], new Set());
      expect(tiles[0]?.poorFitAllReplacementPlanned).toBe(false);
    });
  });
});

describe('commitsSincePreviousTag', () => {
  it('is the depth difference between the two tagged commits', () => {
    expect(commitsSincePreviousTag(42, 30)).toBe(12);
  });

  it('is zero when both tags point at the same commit', () => {
    expect(commitsSincePreviousTag(10, 10)).toBe(0);
  });

  it('is null when there is no previous tag to compare against', () => {
    expect(commitsSincePreviousTag(5, null)).toBeNull();
  });
});

describe('groupPlannedReplacementsByCapability', () => {
  it('groups exposed system ids by capability', () => {
    const replacements: PlannedReplacement[] = [
      { capabilityId: 'cap-1', exposedSystemId: 'sys-1', replacementSystemId: 'sys-2', branchId: 'branch-1' },
      { capabilityId: 'cap-1', exposedSystemId: 'sys-3', replacementSystemId: 'sys-4', branchId: 'branch-2' },
      { capabilityId: 'cap-2', exposedSystemId: 'sys-5', replacementSystemId: 'sys-6', branchId: 'branch-3' },
    ];
    const grouped = groupPlannedReplacementsByCapability(replacements);
    expect(grouped.get('cap-1')).toEqual(new Set(['sys-1', 'sys-3']));
    expect(grouped.get('cap-2')).toEqual(new Set(['sys-5']));
  });

  it('is empty for an empty input', () => {
    expect(groupPlannedReplacementsByCapability([]).size).toBe(0);
  });
});

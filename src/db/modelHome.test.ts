import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import { buildCapabilityTiles, commitsSincePreviousTag, computeExposureTone, type PlannedReplacement } from './modelHome';

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

function supportsEdge(fromElementId: string, toElementId: string): RelationshipsHeadRow {
  return {
    relationship_id: `${fromElementId}-supports-${toElementId}`,
    relationship_type: 'supports',
    from_element_id: fromElementId,
    to_element_id: toElementId,
    attributes: {},
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
    const tiles = buildCapabilityTiles([capability('cap-1')], [], new Map(), []);
    expect(tiles).toEqual([{ capability: capability('cap-1'), supportingSystems: [], exposedSystems: [], tone: 'neutral' }]);
  });

  it('is ok for a capability whose supporting systems are all active', () => {
    const sys = system('sys-1', 'active');
    const systemsById = new Map([['sys-1', sys]]);
    const tiles = buildCapabilityTiles([capability('cap-1')], [supportsEdge('sys-1', 'cap-1')], systemsById, []);
    expect(tiles[0]).toMatchObject({ tone: 'ok', supportingSystems: [sys], exposedSystems: [] });
  });

  it('warns and names the exposed system when a supporting system is retiring with no planned replacement', () => {
    const sys = system('sys-1', 'retiring');
    const systemsById = new Map([['sys-1', sys]]);
    const tiles = buildCapabilityTiles([capability('cap-1')], [supportsEdge('sys-1', 'cap-1')], systemsById, []);
    expect(tiles[0]).toMatchObject({ tone: 'warn', exposedSystems: [sys] });
  });

  it('reads info when a planned replacement for this exact capability is found', () => {
    const sys = system('sys-1', 'retiring');
    const systemsById = new Map([['sys-1', sys]]);
    const replacements: PlannedReplacement[] = [{ capabilityId: 'cap-1', exposedSystemId: 'sys-1', replacementSystemId: 'sys-2', branchId: 'branch-1' }];
    const tiles = buildCapabilityTiles([capability('cap-1')], [supportsEdge('sys-1', 'cap-1')], systemsById, replacements);
    expect(tiles[0]?.tone).toBe('info');
  });

  it('scopes edges and tiles to each capability independently — one exposed, one healthy, one unrecorded', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', 'retiring')],
      ['sys-2', system('sys-2', 'active')],
    ]);
    const edges = [supportsEdge('sys-1', 'cap-exposed'), supportsEdge('sys-2', 'cap-healthy')];
    const tiles = buildCapabilityTiles([capability('cap-exposed'), capability('cap-healthy'), capability('cap-unrecorded')], edges, systemsById, []);
    expect(tiles.map((t) => t.tone)).toEqual(['warn', 'ok', 'neutral']);
  });

  it('a planned replacement recorded for a different capability does not leak into this one', () => {
    const sys = system('sys-1', 'retiring');
    const systemsById = new Map([['sys-1', sys]]);
    const replacements: PlannedReplacement[] = [{ capabilityId: 'cap-other', exposedSystemId: 'sys-1', replacementSystemId: 'sys-2', branchId: 'branch-1' }];
    const tiles = buildCapabilityTiles([capability('cap-1')], [supportsEdge('sys-1', 'cap-1')], systemsById, replacements);
    expect(tiles[0]?.tone).toBe('warn');
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

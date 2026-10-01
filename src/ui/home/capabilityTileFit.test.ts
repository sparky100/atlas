import { describe, expect, it } from 'vitest';
import type { Importance } from '../../contracts/delta';
import type { CapabilityTileData } from '../../db/modelHome';
import { compareWeakTiles, formatPoorFitPillLabel, isCapabilityTileWeak, poorFitPillTone } from './capabilityTileFit';
import type { ElementsHeadRow } from '../../contracts/rows';

function capability(id: string, name = `Capability ${id}`): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: {}, exists_delta_id: `delta-${id}` };
}

function tile(id: string, name: string, importance: Importance | null, tone: CapabilityTileData['tone'] = 'warn'): CapabilityTileData {
  return {
    capability: capability(id, name),
    supportingSystems: [],
    exposedSystems: [],
    tone,
    supportedCapabilityCount: 0,
    totalCapabilityCount: 0,
    isOwned: false,
    fitForPurpose: null,
    poorFitCapabilities: [],
    poorFitAllReplacementPlanned: false,
    importance,
  };
}

describe('isCapabilityTileWeak (F6.1: display rule only, fit stays out of tone per ADR-023)', () => {
  it('is weak when tone alone is not ok, even with no poor-fit capability', () => {
    expect(isCapabilityTileWeak({ tone: 'warn', poorFitCapabilities: [] })).toBe(true);
  });

  it('is weak when a capability rolls up to poor fit, even though tone is ok', () => {
    expect(isCapabilityTileWeak({ tone: 'ok', poorFitCapabilities: [capability('cap-1')] })).toBe(true);
  });

  it('is not weak when tone is ok and nothing is rated poor (good/adequate/unrated all read as healthy)', () => {
    expect(isCapabilityTileWeak({ tone: 'ok', poorFitCapabilities: [] })).toBe(false);
  });

  it('is weak when both tone and fit flag it (a mixed domain)', () => {
    expect(isCapabilityTileWeak({ tone: 'neutral', poorFitCapabilities: [capability('cap-1')] })).toBe(true);
  });
});

describe('formatPoorFitPillLabel', () => {
  it('singular for exactly one capability', () => {
    expect(formatPoorFitPillLabel(1, false)).toBe('poor fit: 1 capability');
  });

  it('plural for more than one', () => {
    expect(formatPoorFitPillLabel(2, false)).toBe('poor fit: 2 capabilities');
  });

  it('appends "replacement planned" once every poor-fit edge has one', () => {
    expect(formatPoorFitPillLabel(2, true)).toBe('poor fit: 2 capabilities · replacement planned');
  });
});

describe('poorFitPillTone', () => {
  it('is danger while any poor-fit edge still needs a decision', () => {
    expect(poorFitPillTone(false)).toBe('danger');
  });

  it('is info once every poor-fit edge already has a planned replacement', () => {
    expect(poorFitPillTone(true)).toBe('info');
  });
});

describe('compareWeakTiles (Director home: importance high→low, unset last, then fit/exposure severity, then name)', () => {
  it('sorts mixed importance high, then medium, then low', () => {
    const low = tile('a', 'Low one', 'low');
    const high = tile('b', 'High one', 'high');
    const medium = tile('c', 'Medium one', 'medium');
    expect([low, high, medium].sort(compareWeakTiles)).toEqual([high, medium, low]);
  });

  it('sorts an unset importance after every rated level, never as low', () => {
    const low = tile('a', 'Low one', 'low');
    const unset = tile('b', 'Unset one', null);
    expect([unset, low].sort(compareWeakTiles)).toEqual([low, unset]);
  });

  it('breaks an importance tie by fit/exposure severity: warn, then neutral, then info, then ok', () => {
    const warnTile = tile('a', 'Warn', 'high', 'warn');
    const neutralTile = tile('b', 'Neutral', 'high', 'neutral');
    const infoTile = tile('c', 'Info', 'high', 'info');
    const okTile = tile('d', 'Ok', 'high', 'ok');
    expect([okTile, infoTile, neutralTile, warnTile].sort(compareWeakTiles)).toEqual([warnTile, neutralTile, infoTile, okTile]);
  });

  it('breaks an importance-and-tone tie by name', () => {
    const zebra = tile('a', 'Zebra', 'high', 'warn');
    const apple = tile('b', 'Apple', 'high', 'warn');
    expect([zebra, apple].sort(compareWeakTiles)).toEqual([apple, zebra]);
  });

  it('two unset, tone-tied tiles still resolve by name — unset never collapses every tie', () => {
    const zebra = tile('a', 'Zebra', null, 'warn');
    const apple = tile('b', 'Apple', null, 'warn');
    expect([zebra, apple].sort(compareWeakTiles)).toEqual([apple, zebra]);
  });
});

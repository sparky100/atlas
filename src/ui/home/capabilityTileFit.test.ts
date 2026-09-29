import { describe, expect, it } from 'vitest';
import { formatPoorFitPillLabel, isCapabilityTileWeak, poorFitPillTone } from './capabilityTileFit';
import type { ElementsHeadRow } from '../../contracts/rows';

function capability(id: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name: `Capability ${id}`, parent_id: null, attributes: {}, exists_delta_id: `delta-${id}` };
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

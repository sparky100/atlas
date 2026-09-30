import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, Json } from '../../contracts/rows';
import { RUN_COST_BAND_ORDER, compareRunCostBands, countRunCostBands, highestRunCostBand } from './runCostBand';

function element(id: string, elementType: 'system' | 'container', annualRunCost?: string): ElementsHeadRow {
  const attrs: Record<string, Json> = { isExternal: false };
  if (annualRunCost !== undefined) attrs.annualRunCost = annualRunCost;
  return { element_id: id, element_type: elementType, name: id, parent_id: null, attributes: attrs, exists_delta_id: `d-${id}` };
}

describe('RUN_COST_BAND_ORDER / compareRunCostBands', () => {
  it('orders every band ascending by cost, none_included lowest, over_5m highest', () => {
    expect(RUN_COST_BAND_ORDER.none_included).toBeLessThan(RUN_COST_BAND_ORDER.under_50k);
    expect(RUN_COST_BAND_ORDER.under_50k).toBeLessThan(RUN_COST_BAND_ORDER['50k_250k']);
    expect(RUN_COST_BAND_ORDER['50k_250k']).toBeLessThan(RUN_COST_BAND_ORDER['250k_1m']);
    expect(RUN_COST_BAND_ORDER['250k_1m']).toBeLessThan(RUN_COST_BAND_ORDER['1m_5m']);
    expect(RUN_COST_BAND_ORDER['1m_5m']).toBeLessThan(RUN_COST_BAND_ORDER.over_5m);
  });

  it('compareRunCostBands sorts a shuffled list back into band order', () => {
    const shuffled = ['over_5m', 'none_included', '250k_1m', 'under_50k', 'over_5m', '1m_5m', '50k_250k'] as const;
    const sorted = [...shuffled].sort(compareRunCostBands);
    expect(sorted).toEqual(['none_included', 'under_50k', '50k_250k', '250k_1m', '1m_5m', 'over_5m', 'over_5m']);
  });

  it('is symmetric: compareRunCostBands(a, b) === -compareRunCostBands(b, a)', () => {
    expect(compareRunCostBands('under_50k', 'over_5m')).toBe(-compareRunCostBands('over_5m', 'under_50k'));
    expect(compareRunCostBands('50k_250k', '50k_250k')).toBe(0);
  });
});

describe('highestRunCostBand', () => {
  it('returns the highest band among a set of systems/containers', () => {
    const elements = [element('sys-1', 'system', 'under_50k'), element('sys-2', 'system', 'over_5m'), element('cont-1', 'container', '50k_250k')];
    expect(highestRunCostBand(elements)).toBe('over_5m');
  });

  it('ignores unset members when taking the highest — an unset element never counts as none_included or as the lowest band', () => {
    const elements = [element('sys-1', 'system'), element('sys-2', 'system', 'under_50k')];
    expect(highestRunCostBand(elements)).toBe('under_50k');
  });

  it('returns null when every element in the set is unset', () => {
    expect(highestRunCostBand([element('sys-1', 'system'), element('sys-2', 'system')])).toBeNull();
  });

  it('returns null for an empty set', () => {
    expect(highestRunCostBand([])).toBeNull();
  });

  it('ignores a stored value that is not a real band (defensive against corrupted/legacy data)', () => {
    expect(highestRunCostBand([element('sys-1', 'system', 'not_a_real_band')])).toBeNull();
  });
});

describe('countRunCostBands', () => {
  it('counts each element into the band it recorded, and reports how many recorded none at all', () => {
    const elements = [
      element('sys-1', 'system', 'under_50k'),
      element('sys-2', 'system', 'under_50k'),
      element('sys-3', 'system', 'over_5m'),
      element('cont-1', 'container'),
      element('cont-2', 'container'),
    ];
    const result = countRunCostBands(elements);
    expect(result.counts).toEqual({ none_included: 0, under_50k: 2, '50k_250k': 0, '250k_1m': 0, '1m_5m': 0, over_5m: 1 });
    expect(result.notEntered).toBe(2);
  });

  it('never sums or averages bands — the result is per-band counts, not a single combined figure', () => {
    const result = countRunCostBands([element('sys-1', 'system', 'under_50k'), element('sys-2', 'system', 'over_5m')]);
    expect(result).not.toHaveProperty('total');
    expect(result).not.toHaveProperty('average');
    expect(Object.keys(result.counts).sort()).toEqual(['1m_5m', '250k_1m', '50k_250k', 'none_included', 'over_5m', 'under_50k']);
  });

  it('a recorded none_included is counted separately from an unset (not entered) element — the two are never conflated', () => {
    const result = countRunCostBands([element('sys-1', 'system', 'none_included'), element('sys-2', 'system')]);
    expect(result.counts.none_included).toBe(1);
    expect(result.notEntered).toBe(1);
  });

  it('returns every band at zero and notEntered 0 for an empty set', () => {
    const result = countRunCostBands([]);
    expect(result.counts).toEqual({ none_included: 0, under_50k: 0, '50k_250k': 0, '250k_1m': 0, '1m_5m': 0, over_5m: 0 });
    expect(result.notEntered).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import type { AnnualRunCost } from '../../contracts/delta';
import { ANNUAL_RUN_COST_ORDER, annualRunCostLabel, annualRunCostRank, compareAnnualRunCost, countAnnualRunCosts, highestAnnualRunCost } from './annualRunCost';

describe('band ordering', () => {
  it('orders the six bands cheapest → most expensive, none_included first and over_5m last', () => {
    expect(ANNUAL_RUN_COST_ORDER).toEqual(['none_included', 'under_50k', '50k_250k', '250k_1m', '1m_5m', 'over_5m']);
    expect(annualRunCostRank('none_included')).toBe(0);
    expect(annualRunCostRank('over_5m')).toBe(5);
  });

  it('compares ascending, so a plain sort puts the cheapest band first', () => {
    const shuffled: AnnualRunCost[] = ['over_5m', 'under_50k', 'none_included', '1m_5m'];
    expect([...shuffled].sort(compareAnnualRunCost)).toEqual(['none_included', 'under_50k', '1m_5m', 'over_5m']);
    expect(compareAnnualRunCost('under_50k', '50k_250k')).toBeLessThan(0);
    expect(compareAnnualRunCost('over_5m', '250k_1m')).toBeGreaterThan(0);
    expect(compareAnnualRunCost('50k_250k', '50k_250k')).toBe(0);
  });

  it('gives every band its display label — keys stored, labels in code', () => {
    expect(annualRunCostLabel('none_included')).toBe('None / included');
    expect(annualRunCostLabel('under_50k')).toBe('Under £50k');
    expect(annualRunCostLabel('50k_250k')).toBe('£50k–£250k');
    expect(annualRunCostLabel('250k_1m')).toBe('£250k–£1m');
    expect(annualRunCostLabel('1m_5m')).toBe('£1m–£5m');
    expect(annualRunCostLabel('over_5m')).toBe('Over £5m');
  });
});

describe('highestAnnualRunCost', () => {
  it('takes the most expensive band among a set, ignoring unset members but reporting how many', () => {
    expect(highestAnnualRunCost(['under_50k', '1m_5m', '250k_1m'])).toEqual({ band: '1m_5m', notEntered: 0 });
    expect(highestAnnualRunCost(['over_5m', undefined, 'none_included', null])).toEqual({ band: 'over_5m', notEntered: 2 });
    expect(highestAnnualRunCost([undefined, null])).toEqual({ band: null, notEntered: 2 });
    expect(highestAnnualRunCost([])).toEqual({ band: null, notEntered: 0 });
  });

  it('reports a lone recorded none_included as that band, never as "unset"', () => {
    expect(highestAnnualRunCost(['none_included'])).toEqual({ band: 'none_included', notEntered: 0 });
    expect(highestAnnualRunCost([undefined])).toEqual({ band: null, notEntered: 1 });
  });

  it('treats an all-unset set as nothing recorded — not as none_included and not as a zero cost', () => {
    const result = highestAnnualRunCost([undefined, null, undefined]);
    expect(result.band).toBeNull();
    expect(result.notEntered).toBe(3);
    expect(result.band).not.toBe('none_included');
  });
});

describe('countAnnualRunCosts', () => {
  it('counts each member in exactly one bucket, with every band present even when zero', () => {
    const { counts, notEntered } = countAnnualRunCosts(['under_50k', 'under_50k', 'over_5m', undefined, null]);
    expect(counts).toEqual({
      none_included: 0,
      under_50k: 2,
      '50k_250k': 0,
      '250k_1m': 0,
      '1m_5m': 0,
      over_5m: 1,
    });
    expect(notEntered).toBe(2);
  });

  it('keeps not-entered separate from the recorded none_included band', () => {
    const { counts, notEntered } = countAnnualRunCosts(['none_included', undefined]);
    expect(counts.none_included).toBe(1);
    expect(notEntered).toBe(1);
    expect(countAnnualRunCosts([])).toEqual({
      counts: { none_included: 0, under_50k: 0, '50k_250k': 0, '250k_1m': 0, '1m_5m': 0, over_5m: 0 },
      notEntered: 0,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { computePortfolioSignals, missingPortfolioInputs, type PortfolioSignalInput } from './portfolioSignals';

function input(overrides: Partial<PortfolioSignalInput> = {}): PortfolioSignalInput {
  return { cost: null, fit: null, criticality: null, lifecycleExposed: null, overlapCapabilityNames: [], disposition: null, ...overrides };
}

function keys(input: PortfolioSignalInput): string[] {
  return computePortfolioSignals(input).map((s) => s.key);
}

describe('costly_poor_fit', () => {
  it('fires for a high-cost, poor-fit system', () => {
    expect(keys(input({ cost: '1m_5m', fit: 'poor' }))).toContain('costly_poor_fit');
  });

  it('fires for a high-cost, adequate-fit system too', () => {
    expect(keys(input({ cost: '1m_5m', fit: 'adequate' }))).toContain('costly_poor_fit');
  });

  it('does not fire for a high-cost, good-fit system', () => {
    expect(keys(input({ cost: '1m_5m', fit: 'good' }))).not.toContain('costly_poor_fit');
  });

  it('does not fire when cost is not entered', () => {
    expect(keys(input({ cost: null, fit: 'poor' }))).not.toContain('costly_poor_fit');
  });

  it('does not fire when fit is unrated', () => {
    expect(keys(input({ cost: '1m_5m', fit: null }))).not.toContain('costly_poor_fit');
  });
});

describe('costly_low_criticality', () => {
  it('fires for a high-cost, low-criticality system', () => {
    expect(keys(input({ cost: '1m_5m', criticality: 'low' }))).toContain('costly_low_criticality');
  });

  it('does not fire for a high-cost, medium-criticality system', () => {
    expect(keys(input({ cost: '1m_5m', criticality: 'medium' }))).not.toContain('costly_low_criticality');
  });

  it('does not fire when criticality is unrecorded', () => {
    expect(keys(input({ cost: '1m_5m', criticality: null }))).not.toContain('costly_low_criticality');
  });
});

describe('costly_exposed', () => {
  it('fires for a high-cost, lifecycle-exposed system', () => {
    expect(keys(input({ cost: '1m_5m', lifecycleExposed: true }))).toContain('costly_exposed');
  });

  it('does not fire for a high-cost system known not to be exposed', () => {
    expect(keys(input({ cost: '1m_5m', lifecycleExposed: false }))).not.toContain('costly_exposed');
  });

  it('does not fire when exposure is unknown — never read as "not exposed"', () => {
    expect(keys(input({ cost: '1m_5m', lifecycleExposed: null }))).not.toContain('costly_exposed');
  });
});

describe('costly_overlap', () => {
  it('fires for a high-cost system with an overlapping capability', () => {
    expect(keys(input({ cost: '1m_5m', overlapCapabilityNames: ['Finance'] }))).toContain('costly_overlap');
  });

  it('does not fire for a high-cost system with no overlap', () => {
    expect(keys(input({ cost: '1m_5m', overlapCapabilityNames: [] }))).not.toContain('costly_overlap');
  });

  it('does not fire when cost is not entered, even with an overlap', () => {
    expect(keys(input({ cost: null, overlapCapabilityNames: ['Finance'] }))).not.toContain('costly_overlap');
  });

  it('names the overlapping capabilities in its reason', () => {
    const signal = computePortfolioSignals(input({ cost: '1m_5m', overlapCapabilityNames: ['Finance', 'Billing'] })).find((s) => s.key === 'costly_overlap');
    expect(signal?.reason).toContain('Finance');
    expect(signal?.reason).toContain('Billing');
  });
});

describe('cheap_poor_fit', () => {
  it('fires for an under-50k, poor-fit system', () => {
    expect(keys(input({ cost: 'under_50k', fit: 'poor' }))).toContain('cheap_poor_fit');
  });

  it('fires for a none_included, poor-fit system', () => {
    expect(keys(input({ cost: 'none_included', fit: 'poor' }))).toContain('cheap_poor_fit');
  });

  it('does not fire for an adequate-fit system even if cheap', () => {
    expect(keys(input({ cost: 'under_50k', fit: 'adequate' }))).not.toContain('cheap_poor_fit');
  });

  it('does not fire when cost is not entered — never treated as cheap', () => {
    expect(keys(input({ cost: null, fit: 'poor' }))).not.toContain('cheap_poor_fit');
  });

  it('does not fire for a mid-band cost', () => {
    expect(keys(input({ cost: '50k_250k', fit: 'poor' }))).not.toContain('cheap_poor_fit');
  });
});

describe('justified', () => {
  it('fires for a high-cost, excellent-fit, critical system — the task\'s own motivating example', () => {
    expect(keys(input({ cost: '1m_5m', fit: 'excellent', criticality: 'critical' }))).toContain('justified');
  });

  it('fires for a high-cost, good-fit, high-criticality system', () => {
    expect(keys(input({ cost: '1m_5m', fit: 'good', criticality: 'high' }))).toContain('justified');
  });

  it('does not fire for a high-cost, good-fit, medium-criticality system', () => {
    expect(keys(input({ cost: '1m_5m', fit: 'good', criticality: 'medium' }))).not.toContain('justified');
  });

  it('is marked calm, not a warning', () => {
    const signal = computePortfolioSignals(input({ cost: '1m_5m', fit: 'excellent', criticality: 'critical' })).find((s) => s.key === 'justified');
    expect(signal?.calm).toBe(true);
  });

  it('is costly-and-critical-but-poor-fit instead: justified never fires, costly_poor_fit does', () => {
    const result = keys(input({ cost: '1m_5m', fit: 'poor', criticality: 'critical' }));
    expect(result).not.toContain('justified');
    expect(result).toContain('costly_poor_fit');
  });
});

describe('missingPortfolioInputs', () => {
  it('lists every missing input', () => {
    expect(missingPortfolioInputs(input())).toEqual(['run cost', 'fit', 'criticality', 'lifecycle exposure']);
  });

  it('lists nothing when every input is present', () => {
    expect(missingPortfolioInputs(input({ cost: '1m_5m', fit: 'good', criticality: 'high', lifecycleExposed: false }))).toEqual([]);
  });

  it('lists only the specific inputs that are missing', () => {
    expect(missingPortfolioInputs(input({ cost: '1m_5m', fit: 'good' }))).toEqual(['criticality', 'lifecycle exposure']);
  });
});

describe('disposition signals (F11)', () => {
  it('invest_poor_fit fires for Invest on a poor-fit system, and never when either input is missing', () => {
    expect(keys(input({ disposition: 'invest', fit: 'poor' }))).toContain('invest_poor_fit');
    expect(keys(input({ disposition: 'invest', fit: 'adequate' }))).not.toContain('invest_poor_fit');
    expect(keys(input({ disposition: 'invest', fit: null }))).not.toContain('invest_poor_fit');
    expect(keys(input({ disposition: null, fit: 'poor' }))).not.toContain('invest_poor_fit');
  });

  it('tolerate_costly_poor_fit fires for Tolerate with high cost and a poor or adequate fit, never on a missing input', () => {
    expect(keys(input({ disposition: 'tolerate', cost: '1m_5m', fit: 'adequate' }))).toContain('tolerate_costly_poor_fit');
    expect(keys(input({ disposition: 'tolerate', cost: '1m_5m', fit: 'good' }))).not.toContain('tolerate_costly_poor_fit');
    expect(keys(input({ disposition: 'tolerate', cost: 'under_50k', fit: 'poor' }))).not.toContain('tolerate_costly_poor_fit');
    expect(keys(input({ disposition: 'tolerate', cost: null, fit: 'poor' }))).not.toContain('tolerate_costly_poor_fit');
  });
});

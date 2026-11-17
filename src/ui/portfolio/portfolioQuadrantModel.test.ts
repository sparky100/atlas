import { describe, expect, it } from 'vitest';
import { buildQuadrant, dotSizeOf, quadrantOf, techHealthOf, type QuadrantItem } from './portfolioQuadrantModel';

function item(overrides: Partial<QuadrantItem> = {}): QuadrantItem {
  return { id: 'a', name: 'A', fit: 'good', lifecycle: 'active', exposed: false, cost: '50k_250k', disposition: null, ...overrides };
}

describe('techHealthOf', () => {
  it('reads active and planned as healthy', () => {
    expect(techHealthOf('active', false)).toBe('healthy');
    expect(techHealthOf('planned', null)).toBe('healthy');
  });
  it('reads retiring, or exposed past an end date, as at risk', () => {
    expect(techHealthOf('retiring', false)).toBe('at_risk');
    expect(techHealthOf('active', true)).toBe('at_risk');
  });
  it('does not guess when no lifecycle is recorded', () => {
    expect(techHealthOf(null, null)).toBeNull();
    expect(techHealthOf('retired', null)).toBeNull();
  });
});

describe('quadrantOf', () => {
  it('follows TIME: high fit + healthy invest, high fit + at risk migrate, lower fit + healthy tolerate, lower fit + at risk eliminate', () => {
    expect(quadrantOf('excellent', 'healthy')).toBe('invest');
    expect(quadrantOf('good', 'at_risk')).toBe('migrate');
    expect(quadrantOf('adequate', 'healthy')).toBe('tolerate');
    expect(quadrantOf('poor', 'at_risk')).toBe('eliminate');
  });
});

describe('buildQuadrant', () => {
  it('places each application in one box and orders biggest cost first', () => {
    const result = buildQuadrant([item({ id: 'small', name: 'Small', cost: 'under_50k' }), item({ id: 'big', name: 'Big', cost: '1m_5m' }), item({ id: 'bad', name: 'Bad', fit: 'poor', lifecycle: 'retiring' })]);
    expect(result.boxes.invest.map((i) => i.id)).toEqual(['big', 'small']);
    expect(result.boxes.eliminate.map((i) => i.id)).toEqual(['bad']);
    expect(result.placedCount).toBe(3);
    expect(result.notPlacedCount).toBe(0);
  });

  it('never places an application with no fit, no lifecycle, or already retired; it counts them by reason', () => {
    const result = buildQuadrant([item({ id: 'nofit', fit: null }), item({ id: 'nolife', lifecycle: null, exposed: null }), item({ id: 'gone', lifecycle: 'retired' })]);
    expect(result.placedCount).toBe(0);
    expect(result.notPlaced.fit.map((i) => i.id)).toEqual(['nofit']);
    expect(result.notPlaced.health.map((i) => i.id)).toEqual(['nolife']);
    expect(result.notPlaced.retired.map((i) => i.id)).toEqual(['gone']);
    expect(result.notPlacedCount).toBe(3);
  });

  it('is the same for the same input in any order', () => {
    const a = [item({ id: '1', name: 'X' }), item({ id: '2', name: 'Y' }), item({ id: '3', name: 'Z', cost: 'over_5m' })];
    expect(buildQuadrant([...a].reverse())).toEqual(buildQuadrant(a));
  });
});

describe('dotSizeOf', () => {
  it('grows with cost and gives an unknown cost the smallest dot', () => {
    expect(dotSizeOf('over_5m')).toBeGreaterThan(dotSizeOf('1m_5m'));
    expect(dotSizeOf('under_50k')).toBeGreaterThan(dotSizeOf(null));
    expect(dotSizeOf('none_included')).toBe(dotSizeOf(null));
  });
});

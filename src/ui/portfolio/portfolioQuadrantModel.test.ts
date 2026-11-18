import { describe, expect, it } from 'vitest';
import { buildQuadrant, quadrantOf, techHealthOf, type QuadrantItem } from './portfolioQuadrantModel';

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

describe('grid and worth a look', () => {
  it('has eight cells, fit by health, each counted once', () => {
    const result = buildQuadrant([item({ id: '1' }), item({ id: '2', fit: 'excellent' }), item({ id: '3', fit: 'poor', lifecycle: 'retiring' })]);
    expect(result.grid).toHaveLength(8);
    expect(result.grid.reduce((n, c) => n + c.items.length, 0)).toBe(3);
    const good = result.grid.find((c) => c.fit === 'good' && c.health === 'healthy');
    expect(good?.items.map((i) => i.id)).toEqual(['1']);
    expect(good?.quadrant).toBe('invest');
  });

  it('reports the highest cost band, never a sum, and counts what is not entered and has no planned action', () => {
    const result = buildQuadrant([item({ id: '1', cost: 'under_50k' }), item({ id: '2', cost: '1m_5m', disposition: 'invest' }), item({ id: '3', cost: null })]);
    const cell = result.grid.find((c) => c.fit === 'good' && c.health === 'healthy');
    expect(cell?.highestCost).toBe('1m_5m');
    expect(cell?.costNotEntered).toBe(1);
    expect(cell?.noPlannedAction).toBe(2);
    expect(result.grid.find((c) => c.fit === 'poor' && c.health === 'at_risk')?.highestCost).toBeNull();
  });

  it('lists at-risk or poor-fit applications, biggest cost first, and leaves out healthy ones that fit', () => {
    const result = buildQuadrant([
      item({ id: 'fine', name: 'Fine', cost: 'over_5m' }),
      item({ id: 'risk', name: 'Risk', lifecycle: 'retiring', cost: '250k_1m' }),
      item({ id: 'poor', name: 'Poor', fit: 'poor', cost: '1m_5m' }),
      item({ id: 'both', name: 'Both', fit: 'poor', exposed: true, cost: null }),
    ]);
    expect(result.worthALook.map((r) => r.item.id)).toEqual(['poor', 'risk', 'both']);
    expect(result.worthALook[2]).toMatchObject({ atRisk: true, poorFit: true });
  });
});

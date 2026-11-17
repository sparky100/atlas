import { describe, expect, it } from 'vitest';
import type { GoalCapabilityRow, GoalRow } from '../../contracts/goals';
import { capabilityIdsForGoal, countGoalsWithoutCapability, countText, goalTitlesServedBy, goalsForCapability, linkableCapabilities, orderGoals, summariseGoals } from './goalModel';

const goal = (id: string, title: string, status: 'active' | 'retired' = 'active'): GoalRow => ({ id, org_id: 'o', model_id: 'm', title, statement: 's', why_now: '', status, created_by: 'u', created_at: '', retired_by: null, retired_at: null });
const link = (goal_id: string, capability_id: string): GoalCapabilityRow => ({ goal_id, capability_id, created_by: 'u', created_at: '' });
const caps = [{ element_id: 'c1', name: 'Metering' }, { element_id: 'c2', name: 'Billing' }, { element_id: 'c3', name: 'Asset Care' }];
const edges = [{ from_element_id: 's1', to_element_id: 'c1' }, { from_element_id: 's2', to_element_id: 'c1' }, { from_element_id: 's1', to_element_id: 'c1' }];

describe('summariseGoals', () => {
  it('lists linked capabilities A to Z with supporter counts, and counts the unsupported', () => {
    const [s] = summariseGoals([goal('g1', 'Goal')], [link('g1', 'c1'), link('g1', 'c2')], caps, edges);
    expect(s?.capabilities).toEqual([{ capabilityId: 'c2', name: 'Billing', supporters: 0 }, { capabilityId: 'c1', name: 'Metering', supporters: 2 }]);
    expect(s?.unsupported).toBe(1);
    expect(s?.missing).toBe(0);
  });
  it('counts a link whose capability is gone instead of hiding it', () => {
    const [s] = summariseGoals([goal('g1', 'Goal')], [link('g1', 'gone')], caps, edges);
    expect(s?.capabilities).toEqual([]);
    expect(s?.missing).toBe(1);
  });
  it("ignores another goal's links", () => {
    const [s] = summariseGoals([goal('g1', 'Goal')], [link('g2', 'c1')], caps, edges);
    expect(s?.capabilities).toEqual([]);
  });
});

describe('orderGoals', () => {
  it('puts active first, each group A to Z', () => {
    expect(orderGoals([goal('1', 'B', 'retired'), goal('2', 'Z'), goal('3', 'A'), goal('4', 'A', 'retired')]).map((g) => g.id)).toEqual(['3', '2', '4', '1']);
  });
});

describe('linkableCapabilities', () => {
  it('leaves out the ones already linked', () => {
    expect(linkableCapabilities(caps, new Set(['c1']))).toEqual([{ id: 'c3', name: 'Asset Care' }, { id: 'c2', name: 'Billing' }]);
  });
});

describe('goalsForCapability', () => {
  it('returns active goals only, A to Z', () => {
    const goals = [goal('g1', 'Zed'), goal('g2', 'Alpha'), goal('g3', 'Gone', 'retired')];
    const links = [link('g1', 'c1'), link('g2', 'c1'), link('g3', 'c1'), link('g1', 'c2')];
    expect(goalsForCapability('c1', goals, links).map((g) => g.id)).toEqual(['g2', 'g1']);
  });
});

describe('countText', () => {
  it('pluralises', () => {
    expect(countText(1, 'capability', 'capabilities')).toBe('1 capability');
    expect(countText(0, 'capability', 'capabilities')).toBe('0 capabilities');
  });
});

describe('capabilityIdsForGoal', () => {
  it("returns only that goal's capabilities", () => {
    expect([...capabilityIdsForGoal('g1', [link('g1', 'c1'), link('g2', 'c2'), link('g1', 'c3')])].sort()).toEqual(['c1', 'c3']);
  });
});

describe('countGoalsWithoutCapability', () => {
  it('counts active goals with no link, and ignores retired ones', () => {
    const goals = [goal('g1', 'A'), goal('g2', 'B'), goal('g3', 'C', 'retired')];
    expect(countGoalsWithoutCapability(goals, [link('g1', 'c1')])).toBe(1);
    expect(countGoalsWithoutCapability(goals, [])).toBe(2);
    expect(countGoalsWithoutCapability([], [])).toBe(0);
  });
});

describe('goalTitlesServedBy', () => {
  it('lists each active goal once, A to Z, for any of the capabilities', () => {
    const goals = [goal('g1', 'Zed'), goal('g2', 'Alpha'), goal('g3', 'Gone', 'retired')];
    const links = [link('g1', 'c1'), link('g1', 'c2'), link('g2', 'c2'), link('g3', 'c1')];
    expect(goalTitlesServedBy(['c1', 'c2'], goals, links)).toEqual(['Alpha', 'Zed']);
    expect(goalTitlesServedBy(['c9'], goals, links)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { GOAL_LIMITS, checkGoalInput, type GoalCapabilityRow, type GoalRow } from './goals';

describe('checkGoalInput', () => {
  it('trims and accepts a plain goal', () => {
    expect(checkGoalInput({ title: '  Cut connection time ', statement: ' New customers are connected within ten days. ', whyNow: '' })).toEqual({
      ok: true,
      value: { title: 'Cut connection time', statement: 'New customers are connected within ten days.', whyNow: '' },
    });
  });
  it('refuses an empty title or statement', () => {
    expect(checkGoalInput({ title: ' ', statement: 'x', whyNow: '' })).toEqual({ ok: false, problem: 'title-empty' });
    expect(checkGoalInput({ title: 'x', statement: '  ', whyNow: '' })).toEqual({ ok: false, problem: 'statement-empty' });
  });
  it('refuses text over the stored limits', () => {
    expect(checkGoalInput({ title: 'x'.repeat(GOAL_LIMITS.title + 1), statement: 'x', whyNow: '' })).toEqual({ ok: false, problem: 'title-too-long' });
    expect(checkGoalInput({ title: 'x', statement: 'x'.repeat(GOAL_LIMITS.statement + 1), whyNow: '' })).toEqual({ ok: false, problem: 'statement-too-long' });
    expect(checkGoalInput({ title: 'x', statement: 'x', whyNow: 'x'.repeat(GOAL_LIMITS.whyNow + 1) })).toEqual({ ok: false, problem: 'why-now-too-long' });
  });
});

describe('row round trip', () => {
  it('survives JSON as stored', () => {
    const goal: GoalRow = { id: 'g1', org_id: 'o', model_id: 'm', title: 'T', statement: 'S', why_now: 'W', status: 'retired', created_by: 'u', created_at: '2026-11-17T00:00:00Z', retired_by: 'u', retired_at: '2026-11-18T00:00:00Z' };
    const link: GoalCapabilityRow = { goal_id: 'g1', capability_id: 'c1', created_by: 'u', created_at: '2026-11-17T00:00:00Z' };
    expect(JSON.parse(JSON.stringify(goal))).toEqual(goal);
    expect(JSON.parse(JSON.stringify(link))).toEqual(link);
  });
});

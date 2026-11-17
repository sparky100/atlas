import { describe, expect, it } from 'vitest';
import { PRINCIPLE_LIMITS, checkPrincipleInput, isValidStanceReason, principleStanceLabel, type DecisionPrincipleRow, type PrincipleRow } from './principles';

describe('checkPrincipleInput', () => {
  it('trims and accepts a plain principle', () => {
    const result = checkPrincipleInput({ title: '  Buy before build ', statement: ' Look at what we run first. ', why: '' });
    expect(result).toEqual({ ok: true, value: { title: 'Buy before build', statement: 'Look at what we run first.', why: '' } });
  });
  it('refuses an empty title or statement', () => {
    expect(checkPrincipleInput({ title: ' ', statement: 'x', why: '' })).toEqual({ ok: false, problem: 'title-empty' });
    expect(checkPrincipleInput({ title: 'x', statement: '  ', why: '' })).toEqual({ ok: false, problem: 'statement-empty' });
  });
  it('refuses text over the stored limits', () => {
    expect(checkPrincipleInput({ title: 'x'.repeat(PRINCIPLE_LIMITS.title + 1), statement: 'x', why: '' })).toEqual({ ok: false, problem: 'title-too-long' });
    expect(checkPrincipleInput({ title: 'x', statement: 'x'.repeat(PRINCIPLE_LIMITS.statement + 1), why: '' })).toEqual({ ok: false, problem: 'statement-too-long' });
    expect(checkPrincipleInput({ title: 'x', statement: 'x', why: 'x'.repeat(PRINCIPLE_LIMITS.why + 1) })).toEqual({ ok: false, problem: 'why-too-long' });
  });
});

describe('isValidStanceReason', () => {
  it('lets "follows" go without a reason but needs one for a departure', () => {
    expect(isValidStanceReason('follows', '')).toBe(true);
    expect(isValidStanceReason('departs', '')).toBe(false);
    expect(isValidStanceReason('departs', '   ')).toBe(false);
    expect(isValidStanceReason('departs', 'The vendor product does not fit.')).toBe(true);
  });
  it('refuses a reason over the limit', () => {
    expect(isValidStanceReason('follows', 'x'.repeat(PRINCIPLE_LIMITS.reason + 1))).toBe(false);
  });
});

describe('row round trip', () => {
  it('survives JSON as stored', () => {
    const principle: PrincipleRow = { id: 'p1', org_id: 'o', model_id: 'm', title: 'T', statement: 'S', why: 'W', status: 'retired', created_by: 'u', created_at: '2026-11-17T00:00:00Z', retired_by: 'u', retired_at: '2026-11-18T00:00:00Z' };
    const link: DecisionPrincipleRow = { decision_id: 'd1', principle_id: 'p1', stance: 'departs', reason: 'Because.', created_by: 'u', created_at: '2026-11-17T00:00:00Z' };
    expect(JSON.parse(JSON.stringify(principle))).toEqual(principle);
    expect(JSON.parse(JSON.stringify(link))).toEqual(link);
  });
  it('names the stances in plain words', () => {
    expect(principleStanceLabel('follows')).toBe('Follows');
    expect(principleStanceLabel('departs')).toBe('Departs from');
  });
});

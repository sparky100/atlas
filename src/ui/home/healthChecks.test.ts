import { describe, expect, it } from 'vitest';
import type { HealthFindingSeverity } from '../components/HealthFinding/HealthFinding';
import { checksClearLabel, partitionHealthChecks, type HealthCheck } from './healthChecks';

function check(key: string, count: number, severity: HealthFindingSeverity = 'medium'): HealthCheck {
  return { key, count, summary: `${String(count)} things`, items: [], severity };
}

describe('partitionHealthChecks', () => {
  it('splits zero-count checks from real ones, preserving order within each group', () => {
    const checks = [check('a', 0), check('b', 3), check('c', 0), check('d', 1)];
    const { active, clear } = partitionHealthChecks(checks);
    expect(active.map((c) => c.key)).toEqual(['b', 'd']);
    expect(clear.map((c) => c.key)).toEqual(['a', 'c']);
  });

  it('puts every check in `clear` when all are zero', () => {
    const checks = [check('a', 0), check('b', 0)];
    const { active, clear } = partitionHealthChecks(checks);
    expect(active).toHaveLength(0);
    expect(clear).toHaveLength(2);
  });

  it('puts every check in `active` when none are zero', () => {
    const checks = [check('a', 1), check('b', 2)];
    const { active, clear } = partitionHealthChecks(checks);
    expect(active).toHaveLength(2);
    expect(clear).toHaveLength(0);
  });

  it('orders active checks high, then medium, then informational, regardless of input order', () => {
    const checks = [check('a', 1, 'informational'), check('b', 1, 'high'), check('c', 1, 'medium')];
    const { active } = partitionHealthChecks(checks);
    expect(active.map((c) => c.key)).toEqual(['b', 'c', 'a']);
  });

  it('keeps input order for checks in the same severity tier (stable sort)', () => {
    const checks = [check('a', 1, 'high'), check('b', 1, 'medium'), check('c', 1, 'high'), check('d', 1, 'medium')];
    const { active } = partitionHealthChecks(checks);
    expect(active.map((c) => c.key)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('leaves `clear` in original order regardless of severity', () => {
    const checks = [check('a', 0, 'informational'), check('b', 0, 'high')];
    const { clear } = partitionHealthChecks(checks);
    expect(clear.map((c) => c.key)).toEqual(['a', 'b']);
  });
});

describe('checksClearLabel', () => {
  it('singular for exactly one', () => {
    expect(checksClearLabel(1)).toBe('1 check clear');
  });

  it('plural otherwise, including zero', () => {
    expect(checksClearLabel(0)).toBe('0 checks clear');
    expect(checksClearLabel(9)).toBe('9 checks clear');
  });
});

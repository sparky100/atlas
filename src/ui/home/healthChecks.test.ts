import { describe, expect, it } from 'vitest';
import { checksClearLabel, partitionHealthChecks, type HealthCheck } from './healthChecks';

function check(key: string, count: number): HealthCheck {
  return { key, count, summary: `${String(count)} things`, items: [] };
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

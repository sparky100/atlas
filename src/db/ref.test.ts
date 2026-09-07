import { describe, expect, it } from 'vitest';
import { parseRefParam, refLabelOf, refParamOf } from './ref';

describe('parseRefParam', () => {
  it('parses main, absent, and empty as main', () => {
    expect(parseRefParam('main')).toEqual({ kind: 'main' });
    expect(parseRefParam(undefined)).toEqual({ kind: 'main' });
    expect(parseRefParam(null)).toEqual({ kind: 'main' });
    expect(parseRefParam('')).toEqual({ kind: 'main' });
  });

  it('parses tag:{name}', () => {
    expect(parseRefParam('tag:v2026-Q2')).toEqual({ kind: 'tag', name: 'v2026-Q2' });
  });

  it('parses branch:{id} (Sprint C1 — routed on the branch id, no slug column exists)', () => {
    expect(parseRefParam('branch:11111111-1111-1111-1111-111111111111')).toEqual({ kind: 'branch', branchId: '11111111-1111-1111-1111-111111111111' });
  });

  it('falls back to main for commit: (real grammar, not yet reachable by any page)', () => {
    expect(parseRefParam('commit:abc')).toEqual({ kind: 'main' });
  });
});

describe('refParamOf / refLabelOf round-trip', () => {
  it('main', () => {
    const ref = parseRefParam('main');
    expect(refParamOf(ref)).toBe('main');
    expect(refLabelOf(ref)).toBe('main');
  });

  it('tag', () => {
    const ref = parseRefParam('tag:v2026-Q2');
    expect(refParamOf(ref)).toBe('tag:v2026-Q2');
    expect(refLabelOf(ref)).toBe('v2026-Q2');
  });

  it('branch: label is "Change: {title}" when given, else a short id fragment (§2.2)', () => {
    const ref = parseRefParam('branch:11111111-1111-1111-1111-111111111111');
    expect(refParamOf(ref)).toBe('branch:11111111-1111-1111-1111-111111111111');
    expect(refLabelOf(ref, 'Retire the legacy CRM')).toBe('Change: Retire the legacy CRM');
    expect(refLabelOf(ref)).toBe('Change: 11111111');
  });
});

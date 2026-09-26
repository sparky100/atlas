import { describe, expect, it } from 'vitest';
import { parseRefParam, refLabelOf, refParamOf, resolveRef } from './ref';

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

  it('parses commit:{id} (Sprint U4-1 B2 — the activity row link to a commit diff)', () => {
    expect(parseRefParam('commit:11111111-1111-1111-1111-111111111111')).toEqual({ kind: 'commit', commitId: '11111111-1111-1111-1111-111111111111' });
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

  it('commit: label is the commit\'s own title when given, else a short id fragment', () => {
    const ref = parseRefParam('commit:11111111-1111-1111-1111-111111111111');
    expect(refParamOf(ref)).toBe('commit:11111111-1111-1111-1111-111111111111');
    expect(refLabelOf(ref, 'Merge: Datasphere')).toBe('Merge: Datasphere');
    expect(refLabelOf(ref)).toBe('commit 11111111');
  });
});

describe('resolveRef', () => {
  it('throws (no network round trip) rather than sending an empty model_id filter — Sprint U4-2a item 2, the live 400 found on the Landscape route via a caller that hadn\'t resolved its own model yet', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- the guard fires before `supabase` is ever touched, so a real client isn't needed here.
    await expect(resolveRef(undefined as any, '', parseRefParam('main'))).rejects.toThrow(/resolveRef/);
  });
});

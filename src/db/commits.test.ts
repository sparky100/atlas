/**
 * Unit tests for commitToBranch's structural pre-checks (C1, C4, C14) —
 * the one part of src/db/commits.ts that needs no database. The rest
 * (C6-style validation via fold, the actual insert-then-CAS sequence) is
 * covered by src/db/commits.integration.test.ts, which needs a real
 * Supabase.
 */
import { describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import { shapeErrors } from './commits';

function createDelta(id: string, elementId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name: 'X', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'src', confidence: 1 };
}

function updateDelta(id: string, elementId: string, attribute: 'name' | 'vendor', value: string, previousDeltaId: string): Delta {
  return { kind: 'element.update', id, elementId, elementType: 'system', attribute, value, previousDeltaId, sourceId: 'src', confidence: 1 };
}

function envelope(overrides: Partial<CommitEnvelope>): CommitEnvelope {
  return {
    id: 'commit-1',
    branchId: 'branch-1',
    parentCommitId: 'head-0',
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'a change',
    body: null,
    deltas: [createDelta('d1', 'el-1')],
    ...overrides,
  };
}

describe('shapeErrors: C1 (non-merge commit needs at least one delta)', () => {
  it('accepts a manual commit with deltas', () => {
    expect(shapeErrors(envelope({}), 'head-0')).toEqual([]);
  });

  it('rejects a manual commit with zero deltas', () => {
    const errors = shapeErrors(envelope({ deltas: [] }), 'head-0');
    expect(errors.some((e) => e.includes('C1'))).toBe(true);
  });

  it('accepts a merge commit with zero deltas (a clean merge with nothing to resolve)', () => {
    const errors = shapeErrors(envelope({ kind: 'merge', mergedBranchHeadCommitId: 'other-head', deltas: [] }), 'head-0');
    expect(errors).toEqual([]);
  });
});

describe('shapeErrors: C14 (kind "merge" iff mergedBranchHeadCommitId is set)', () => {
  it('rejects kind "merge" with no mergedBranchHeadCommitId', () => {
    const errors = shapeErrors(envelope({ kind: 'merge', mergedBranchHeadCommitId: null }), 'head-0');
    expect(errors.some((e) => e.includes('C14'))).toBe(true);
  });

  it('rejects a non-merge kind with mergedBranchHeadCommitId set', () => {
    const errors = shapeErrors(envelope({ kind: 'manual', mergedBranchHeadCommitId: 'other-head' }), 'head-0');
    expect(errors.some((e) => e.includes('C14'))).toBe(true);
  });
});

describe('shapeErrors: envelope.parentCommitId must equal the expected head', () => {
  it('rejects a mismatch (the caller is about to commit against a head it never actually read)', () => {
    const errors = shapeErrors(envelope({ parentCommitId: 'head-0' }), 'head-1');
    expect(errors).toContain('envelope.parentCommitId must equal expectedHeadCommitId');
  });
});

describe('shapeErrors: C4 (at most one delta per fact key per commit)', () => {
  it('rejects two deltas targeting the same (subject, attribute)', () => {
    const errors = shapeErrors(envelope({ deltas: [createDelta('d1', 'el-1'), updateDelta('d2', 'el-1', 'name', 'A', 'd1'), updateDelta('d3', 'el-1', 'name', 'B', 'd2')] }), 'head-0');
    expect(errors.some((e) => e.includes('C4'))).toBe(true);
  });

  it('accepts two deltas targeting the same subject but different attributes', () => {
    const errors = shapeErrors(envelope({ deltas: [createDelta('d1', 'el-1'), updateDelta('d2', 'el-1', 'vendor', 'Acme', 'd1')] }), 'head-0');
    expect(errors).toEqual([]);
  });

  it('accepts the same attribute updated on two different subjects', () => {
    const errors = shapeErrors(
      envelope({ deltas: [createDelta('d1', 'el-1'), createDelta('d2', 'el-2'), updateDelta('d3', 'el-1', 'name', 'A', 'd1'), updateDelta('d4', 'el-2', 'name', 'B', 'd2')] }),
      'head-0',
    );
    expect(errors).toEqual([]);
  });
});

describe('shapeErrors: multiple violations are all reported, not just the first', () => {
  it('reports both C1 and the parentCommitId mismatch together', () => {
    const errors = shapeErrors(envelope({ deltas: [], parentCommitId: 'head-0' }), 'head-1');
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

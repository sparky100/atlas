/**
 * Unit tests for src/engine/branch.ts: forking, as-is/to-be, listing a
 * branch's own deltas, mergeBase, and the per-fact-key three-way diff
 * (SPEC-data-model.md §7.1–§7.2).
 */
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import { EngineError } from './errors';
import type { CommitLoader, CommitNode } from './head';
import { asIs, forkBranchAt, jsonDeepEqual, listOwnDeltas, mergeBase, threeWayDiff, toBe } from './branch';

function makeCreate(id: UUID, elementId: UUID, name: string, attributes: Record<string, unknown> = { lifecycleStatus: 'active', isExternal: false }): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: attributes as never, sourceId: 'src', confidence: 1 };
}

function makeUpdate(id: UUID, elementId: UUID, attribute: string, value: unknown, previousDeltaId: UUID): Delta {
  return { kind: 'element.update', id, elementId, elementType: 'system', attribute: attribute as never, value: value as never, previousDeltaId, sourceId: 'src', confidence: 1 };
}

function commitNode(partial: Pick<CommitNode, 'id' | 'parent_commit_id' | 'depth' | 'deltas'> & Partial<CommitNode>): CommitNode {
  return {
    org_id: 'org',
    model_id: 'model',
    branch_id: 'unspecified',
    merged_branch_head_commit_id: null,
    kind: 'manual',
    message: '',
    author_id: 'author-1',
    head_hash: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

/**
 * genesis(main) --c1(main)-- c2(main)
 *        \-- branchC1(branch)
 * genesis creates 'el' with name='Original', lifecycleStatus='active'.
 * c1 (main) updates lifecycleStatus -> 'retiring'.
 * c2 (main) updates name -> 'Renamed by main'.
 * branchC1 (branch, forked at genesis) updates name -> 'Renamed by branch'
 * and sets vendor='Acme' (a field main never touches).
 */
function buildFixture() {
  const nodes = new Map<UUID, CommitNode>();
  const genesis = commitNode({
    id: 'genesis',
    parent_commit_id: null,
    depth: 0,
    kind: 'template_seed',
    branch_id: 'main',
    deltas: [makeCreate('d-create', 'el', 'Original')],
  });
  const c1 = commitNode({
    id: 'c1',
    parent_commit_id: 'genesis',
    depth: 1,
    branch_id: 'main',
    deltas: [makeUpdate('d-c1', 'el', 'lifecycleStatus', 'retiring', 'd-create')],
  });
  const c2 = commitNode({
    id: 'c2',
    parent_commit_id: 'c1',
    depth: 2,
    branch_id: 'main',
    deltas: [makeUpdate('d-c2', 'el', 'name', 'Renamed by main', 'd-create')],
  });
  const branchC1 = commitNode({
    id: 'branchC1',
    parent_commit_id: 'genesis',
    depth: 1,
    branch_id: 'branch',
    deltas: [makeUpdate('d-b1-name', 'el', 'name', 'Renamed by branch', 'd-create'), makeUpdate('d-b1-vendor', 'el', 'vendor', 'Acme', 'd-create')],
  });
  for (const c of [genesis, c1, c2, branchC1]) nodes.set(c.id, c);
  const loader: CommitLoader = (id) => nodes.get(id);
  return { loader, genesis, c1, c2, branchC1 };
}

describe('forkBranchAt', () => {
  it('starts with head equal to base, at the given commit', () => {
    const { loader, genesis } = buildFixture();
    const fork = forkBranchAt(genesis.id, loader);
    expect(fork).toEqual({ baseCommitId: genesis.id, headCommitId: genesis.id });
  });

  it('throws for an unknown commit', () => {
    const { loader } = buildFixture();
    expect(() => forkBranchAt('nope', loader)).toThrow(EngineError);
  });
});

describe('asIs / toBe', () => {
  it('asIs is the base commit state; toBe is the head commit state', () => {
    const { loader, genesis, branchC1 } = buildFixture();
    const fork = { baseCommitId: genesis.id, headCommitId: branchC1.id };
    expect(asIs(fork, loader).elements.get('el')?.name).toBe('Original');
    expect(toBe(fork, loader).elements.get('el')?.name).toBe('Renamed by branch');
    expect(toBe(fork, loader).elements.get('el')?.attributes.vendor).toBe('Acme');
  });
});

describe('listOwnDeltas', () => {
  it("returns exactly the branch's own deltas, not main's, in dependency order", () => {
    const { loader, genesis, branchC1 } = buildFixture();
    const fork = { baseCommitId: genesis.id, headCommitId: branchC1.id };
    const deltas = listOwnDeltas(fork, loader);
    expect(deltas.map((d) => d.id)).toEqual(['d-b1-name', 'd-b1-vendor']);
  });

  it('is empty for a branch that has not committed anything yet', () => {
    const { loader, genesis } = buildFixture();
    const fork = { baseCommitId: genesis.id, headCommitId: genesis.id };
    expect(listOwnDeltas(fork, loader)).toEqual([]);
  });
});

describe('mergeBase', () => {
  it('is the fork point when the branch has not refreshed, even after main has moved on', () => {
    const { loader, genesis, c2, branchC1 } = buildFixture();
    expect(mergeBase(branchC1.id, c2.id, loader)).toBe(genesis.id);
  });

  it('is the branch head itself when main has not moved since the fork', () => {
    const { loader, genesis, branchC1 } = buildFixture();
    expect(mergeBase(branchC1.id, genesis.id, loader)).toBe(genesis.id);
  });

  it('throws when there is truly no common ancestor', () => {
    const nodes = new Map<UUID, CommitNode>();
    const a = commitNode({ id: 'a', parent_commit_id: null, depth: 0, deltas: [] });
    const b = commitNode({ id: 'b', parent_commit_id: null, depth: 0, deltas: [] });
    nodes.set('a', a);
    nodes.set('b', b);
    const loader: CommitLoader = (id) => nodes.get(id);
    expect(() => mergeBase('a', 'b', loader)).toThrow(EngineError);
  });
});

describe('diffFacts / threeWayDiff (SPEC §7.2)', () => {
  it('classifies UNCHANGED, OURS, THEIRS, and FIELD_CONFLICT correctly', () => {
    const { loader, genesis, c2, branchC1 } = buildFixture();
    const diff = threeWayDiff(branchC1.id, c2.id, loader);
    expect(diff.mergeBaseCommitId).toBe(genesis.id);
    expect(diff.upToDateWithMain).toBe(false);

    const byAttribute = new Map(diff.fields.filter((f) => f.subjectId === 'el').map((f) => [f.attribute, f]));

    // Neither side touched isExternal.
    expect(byAttribute.get('isExternal')?.classification).toBe('UNCHANGED');
    // Main changed lifecycleStatus, branch didn't.
    expect(byAttribute.get('lifecycleStatus')?.classification).toBe('THEIRS');
    // Branch introduced vendor, main didn't.
    expect(byAttribute.get('vendor')?.classification).toBe('OURS');
    // Both changed name, to different values.
    expect(byAttribute.get('name')?.classification).toBe('FIELD_CONFLICT');
    expect(byAttribute.get('name')?.ours?.value).toBe('Renamed by branch');
    expect(byAttribute.get('name')?.theirs?.value).toBe('Renamed by main');
    expect(byAttribute.get('name')?.base?.value).toBe('Original');
  });

  it('classifies CONVERGED when both sides assert the same new value independently', () => {
    const nodes = new Map<UUID, CommitNode>();
    const genesis = commitNode({ id: 'g', parent_commit_id: null, depth: 0, branch_id: 'main', deltas: [makeCreate('d0', 'el', 'X')] });
    const main = commitNode({ id: 'm', parent_commit_id: 'g', depth: 1, branch_id: 'main', deltas: [makeUpdate('dm', 'el', 'name', 'Same New Name', 'd0')] });
    const branch = commitNode({ id: 'b', parent_commit_id: 'g', depth: 1, branch_id: 'branch', deltas: [makeUpdate('db', 'el', 'name', 'Same New Name', 'd0')] });
    for (const c of [genesis, main, branch]) nodes.set(c.id, c);
    const loader: CommitLoader = (id) => nodes.get(id);

    const diff = threeWayDiff('b', 'm', loader);
    const nameField = diff.fields.find((f) => f.subjectId === 'el' && f.attribute === 'name');
    expect(nameField?.classification).toBe('CONVERGED');
  });

  it('upToDateWithMain is true exactly when mergeBase equals the main head', () => {
    const { loader, genesis, branchC1 } = buildFixture();
    expect(threeWayDiff(branchC1.id, genesis.id, loader).upToDateWithMain).toBe(true);
  });
});

describe('jsonDeepEqual', () => {
  it('treats structurally identical objects as equal regardless of key order', () => {
    expect(jsonDeepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('treats differing values, differing array lengths, and mismatched types as unequal', () => {
    expect(jsonDeepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonDeepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(jsonDeepEqual('1', 1)).toBe(false);
    expect(jsonDeepEqual(null, undefined)).toBe(false);
  });

  it('treats deeply nested equal structures as equal', () => {
    expect(jsonDeepEqual({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBe(true);
  });
});

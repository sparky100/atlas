/**
 * Property tests for the commit-DAG-level fold, the canonical hash, and the
 * head == fold proof obligation (Sprint F1 step 4; SPEC-data-model.md
 * §6.1–§6.6, P-1/P-2/P-3). Builds small, structurally realistic commit
 * graphs by hand (genesis on main, a side branch, a merge back into main,
 * sometimes further commits after that) rather than generating arbitrary
 * random DAGs — the shapes here are exactly the ones `atlas.merge_branch`
 * will ever actually produce (SPEC §5.1), so this is what's worth proving
 * correct.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import { emptyHead, fold, type CommitContext, type Head } from './deltas';
import {
  ancestry,
  canonicalizeHead,
  exclusive,
  foldFromGenesis,
  headHash,
  topo,
  verifyHeadMatchesFold,
  type CommitLoader,
  type CommitNode,
} from './head';

const uuid = fc.uuid();

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('test harness bug: expected a value');
  return value;
}
const AUTHOR: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };

function makeCreate(id: UUID, elementId: UUID): Delta {
  return {
    kind: 'element.create',
    id,
    elementId,
    elementType: 'capability',
    name: elementId,
    parentId: null,
    attributes: {},
    sourceId: 'src',
    confidence: 1,
  };
}

interface Graph {
  loader: CommitLoader;
  nodes: Map<UUID, CommitNode>;
  genesisId: UUID;
  /** Main's own current head — the merge commit itself when `afterMergeCount === 0`, otherwise the last after-merge commit (kept exactly as every existing test here already expects it). */
  mergeId: UUID;
  /**
   * ADR-021 §5 item 1 (C19): the merge commit's own id, distinct from
   * `mergeId` above once `afterMergeCount > 0` — this is main's fold
   * *at the moment of the merge*, before any further main-only commits,
   * which is the one P-30 actually names ("`headHash(fold(mainMergeCommit))
   * == headHash(fold(branch.head))`" — main advancing afterwards changes
   * the left side without changing the right, so testing the equality has
   * to pin the merge commit exactly, not "main's current head").
   */
  mergeCommitId: UUID;
  sideHeadId: UUID;
  /** Construction order: genesis, then side commits, then the merge, then any after-merge commits — the one true dependency order for this specific shape, known because we built it, not derived generically. */
  commitsInDependencyOrder: UUID[];
  /** Every element id created anywhere in the graph, main and side alike. */
  allElementIds: UUID[];
}

/**
 * genesis (main, template_seed) --> merge (main, kind=merge, second parent = sideHead)
 *                \-- side1 -- side2 -- ... -- sideHead (a "change" branch)
 * Optionally followed by `afterMerge` more plain commits stacked on main
 * after the merge, each creating one more element.
 */
function buildGraph(sideCount: number, afterMergeCount: number, ids: UUID[]): Graph {
  const nodes = new Map<UUID, CommitNode>();
  let cursor = 0;
  const nextId = (): UUID => {
    const id = ids[cursor++];
    if (id === undefined) throw new Error(`test harness bug: idsArb's pool ran out at index ${String(cursor - 1)}`);
    return id;
  };

  const genesisId = nextId();
  const genesisElement = nextId();
  nodes.set(genesisId, {
    id: genesisId,
    org_id: 'org',
    model_id: 'model',
    branch_id: 'main',
    parent_commit_id: null,
    merged_branch_head_commit_id: null,
    kind: 'template_seed',
    title: 'genesis',
    body: null,
    author_id: AUTHOR.authorId,
    head_hash: null,
    depth: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    deltas: [makeCreate(nextId(), genesisElement)],
  });

  let sideParent = genesisId;
  let sideDepth = 1;
  const sideCommitIds: UUID[] = [];
  const allElementIds = [genesisElement];
  for (let i = 0; i < sideCount; i++) {
    const commitId = nextId();
    const elementId = nextId();
    allElementIds.push(elementId);
    nodes.set(commitId, {
      id: commitId,
      org_id: 'org',
      model_id: 'model',
      branch_id: 'side',
      parent_commit_id: sideParent === genesisId ? genesisId : sideParent,
      merged_branch_head_commit_id: null,
      kind: 'manual',
      title: `side ${String(i)}`,
      body: null,
      author_id: AUTHOR.authorId,
      head_hash: null,
      depth: sideDepth,
      created_at: `2026-01-01T00:0${String(sideDepth)}:00.000Z`,
      deltas: [makeCreate(nextId(), elementId)],
    });
    sideCommitIds.push(commitId);
    sideParent = commitId;
    sideDepth++;
  }
  const sideHeadId = sideCommitIds[sideCommitIds.length - 1] ?? genesisId;

  const mergeId = nextId();
  nodes.set(mergeId, {
    id: mergeId,
    org_id: 'org',
    model_id: 'model',
    branch_id: 'main',
    parent_commit_id: genesisId,
    merged_branch_head_commit_id: sideHeadId === genesisId ? null : sideHeadId,
    kind: sideHeadId === genesisId ? 'manual' : 'merge',
    title: 'merge',
    body: null,
    author_id: AUTHOR.authorId,
    head_hash: null,
    depth: 1,
    created_at: '2026-01-01T00:09:00.000Z',
    deltas: [],
  });

  let mainCursor = mergeId;
  let mainDepth = 2;
  const afterMergeCommitIds: UUID[] = [];
  for (let i = 0; i < afterMergeCount; i++) {
    const commitId = nextId();
    const elementId = nextId();
    allElementIds.push(elementId);
    nodes.set(commitId, {
      id: commitId,
      org_id: 'org',
      model_id: 'model',
      branch_id: 'main',
      parent_commit_id: mainCursor,
      merged_branch_head_commit_id: null,
      kind: 'manual',
      title: `after-merge ${String(i)}`,
      body: null,
      author_id: AUTHOR.authorId,
      head_hash: null,
      depth: mainDepth,
      created_at: `2026-01-01T00:1${String(mainDepth)}:00.000Z`,
      deltas: [makeCreate(nextId(), elementId)],
    });
    afterMergeCommitIds.push(commitId);
    mainCursor = commitId;
    mainDepth++;
  }

  return {
    loader: (id) => nodes.get(id),
    nodes,
    genesisId,
    mergeId: mainCursor,
    mergeCommitId: mergeId,
    sideHeadId,
    commitsInDependencyOrder: [genesisId, ...sideCommitIds, mergeId, ...afterMergeCommitIds],
    allElementIds,
  };
}

// Each of genesis/side/after-merge commits consumes 3 ids (its own id, its
// element's id, and its one delta's own id); merge consumes 1 (no delta).
// Worst case: 3 + 3*4(side) + 1 + 3*3(after-merge) = 25. Rounded well up so
// a future change to buildGraph doesn't quietly resurrect this bug.
const idsArb = fc.uniqueArray(uuid, { minLength: 40, maxLength: 40 });
const graphArb: fc.Arbitrary<Graph> = fc
  .tuple(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 3 }), idsArb)
  .map(([sideCount, afterMergeCount, ids]) => buildGraph(sideCount, afterMergeCount, ids));

interface RefreshGraph {
  loader: CommitLoader;
  genesisId: UUID;
  mainHeadId: UUID;
  sideHeadId: UUID;
  /** The refresh commit's own id: `parent = sideHeadId` (the branch's own head — "ours"), `mergedBranchHead = mainHeadId` ("theirs"), the shape `pushRefresh` produces (ADR-021 §1.1's table). */
  refreshId: UUID;
  /** genesis, then every main-advance commit, then every side commit, then the refresh commit — main and side are independent of each other here (neither is built from the other), so either construction order is a valid dependency order; this is simply the one used to build them. */
  commitsInDependencyOrder: UUID[];
}

/**
 * ADR-021 §5 item 1 (C19)'s other required shape: a genuinely
 * *non*-fast-forwardable merge — main advances on its own (`mainCount`
 * commits) independently of the branch (`sideCount` commits), both off
 * the same genesis, so neither head is an ancestor of the other. The
 * refresh commit (`parent = sideHeadId`, `mergedBranchHead = mainHeadId`)
 * therefore never satisfies C19's condition and must keep folding by the
 * unmodified replay path — every delta here is a plain, always-applicable
 * `element.create` (unique ids throughout), so this is exactly "a refresh
 * with no structural findings" (no retract/update that could conflict),
 * the case ADR-021 §5 item 1 says must "fold bit-for-bit as before".
 */
function buildRefreshGraph(mainCount: number, sideCount: number, ids: UUID[]): RefreshGraph {
  const nodes = new Map<UUID, CommitNode>();
  let cursor = 0;
  const nextId = (): UUID => {
    const id = ids[cursor++];
    if (id === undefined) throw new Error(`test harness bug: idsArb's pool ran out at index ${String(cursor - 1)}`);
    return id;
  };

  const genesisId = nextId();
  const genesisElement = nextId();
  nodes.set(genesisId, {
    id: genesisId,
    org_id: 'org',
    model_id: 'model',
    branch_id: 'main',
    parent_commit_id: null,
    merged_branch_head_commit_id: null,
    kind: 'template_seed',
    title: 'genesis',
    body: null,
    author_id: AUTHOR.authorId,
    head_hash: null,
    depth: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    deltas: [makeCreate(nextId(), genesisElement)],
  });

  function buildChain(branchId: string, count: number, depthPrefix: string): UUID[] {
    const commitIds: UUID[] = [];
    let parent = genesisId;
    let depth = 1;
    for (let i = 0; i < count; i++) {
      const commitId = nextId();
      const elementId = nextId();
      nodes.set(commitId, {
        id: commitId,
        org_id: 'org',
        model_id: 'model',
        branch_id: branchId,
        parent_commit_id: parent,
        merged_branch_head_commit_id: null,
        kind: 'manual',
        title: `${branchId} ${String(i)}`,
        body: null,
        author_id: AUTHOR.authorId,
        head_hash: null,
        depth,
        created_at: `2026-01-01T${depthPrefix}:${String(depth).padStart(2, '0')}:00.000Z`,
        deltas: [makeCreate(nextId(), elementId)],
      });
      commitIds.push(commitId);
      parent = commitId;
      depth++;
    }
    return commitIds;
  }

  const mainCommitIds = buildChain('main', mainCount, '00');
  const sideCommitIds = buildChain('side', sideCount, '01');
  const mainHeadId = mainCommitIds[mainCommitIds.length - 1] ?? genesisId;
  const sideHeadId = sideCommitIds[sideCommitIds.length - 1] ?? genesisId;

  const refreshId = nextId();
  nodes.set(refreshId, {
    id: refreshId,
    org_id: 'org',
    model_id: 'model',
    branch_id: 'side',
    parent_commit_id: sideHeadId,
    merged_branch_head_commit_id: mainHeadId === sideHeadId ? null : mainHeadId,
    kind: mainHeadId === sideHeadId ? 'manual' : 'merge',
    title: 'refresh',
    body: null,
    author_id: AUTHOR.authorId,
    head_hash: null,
    depth: sideCommitIds.length + 1,
    created_at: '2026-01-01T02:00:00.000Z',
    deltas: [],
  });

  return {
    loader: (id) => nodes.get(id),
    genesisId,
    mainHeadId,
    sideHeadId,
    refreshId,
    commitsInDependencyOrder: [genesisId, ...mainCommitIds, ...sideCommitIds, refreshId],
  };
}

// One id per commit's own id + its one delta's element-create pair (2), plus
// the refresh commit itself (1, no delta): 1(genesis) + 2 + 2*4(main) + 2*4(side) + 1 = 20. Rounded up.
const refreshIdsArb = fc.uniqueArray(uuid, { minLength: 30, maxLength: 30 });
const refreshGraphArb: fc.Arbitrary<RefreshGraph> = fc
  .tuple(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 4 }), refreshIdsArb)
  .map(([mainCount, sideCount, ids]) => buildRefreshGraph(mainCount, sideCount, ids));

describe('foldFromGenesis', () => {
  it('includes every element created anywhere in the graph, main and side alike', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const head = foldFromGenesis(graph.mergeId, graph.loader);
        for (const elementId of graph.allElementIds) {
          expect(head.elements.has(elementId)).toBe(true);
        }
        expect(head.elements.size).toBe(graph.allElementIds.length);
      }),
    );
  });

  it('is deterministic (P-1)', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        expect(headHash(foldFromGenesis(graph.mergeId, graph.loader))).toBe(headHash(foldFromGenesis(graph.mergeId, graph.loader)));
      }),
    );
  });

  it('matches a flat, independently-computed fold over (genesis, side commits in order, merge, after-merge commits in order)', () => {
    // Depth alone does NOT give a valid global order across a graph with a
    // merge in it — a merge commit's depth counts only its first-parent
    // chain (SPEC §3.4), so it can be numerically smaller than commits it
    // depends on through its second parent. `topo` is only ever used
    // (here and in foldFromGenesis) on one `exclusive(...)` chain at a
    // time, never globally — so this reference uses the order this test
    // built the graph in, which it knows independently to be correct,
    // rather than re-deriving it generically.
    fc.assert(
      fc.property(graphArb, (graph) => {
        let flat: Head = emptyHead();
        for (const id of graph.commitsInDependencyOrder) {
          const node = graph.nodes.get(id);
          if (!node) continue;
          flat = fold(flat, node.deltas, { authorId: node.author_id, createdAt: node.created_at });
        }
        expect(canonicalizeHead(foldFromGenesis(graph.mergeId, graph.loader))).toEqual(canonicalizeHead(flat));
      }),
    );
  });

  it('the resume-point optimisation gives exactly the same result as folding from genesis (P-2)', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const genesisHead = foldFromGenesis(graph.genesisId, graph.loader);
        const withResume = foldFromGenesis(graph.mergeId, graph.loader, { commitId: graph.genesisId, head: genesisHead });
        const fromScratch = foldFromGenesis(graph.mergeId, graph.loader);
        expect(headHash(withResume)).toBe(headHash(fromScratch));
      }),
    );
  });

  it('verifyHeadMatchesFold reports ok for a correctly computed head, and catches a tampered one', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const head = foldFromGenesis(graph.mergeId, graph.loader);
        const good = verifyHeadMatchesFold(head, graph.mergeId, graph.loader);
        expect(good.ok).toBe(true);
        expect(good.expectedHash).toBe(good.actualHash);

        const tampered = foldFromGenesis(graph.mergeId, graph.loader);
        tampered.elements.delete(must([...tampered.elements.keys()][0]));
        const bad = verifyHeadMatchesFold(tampered, graph.mergeId, graph.loader);
        expect(bad.ok).toBe(tampered.elements.size === head.elements.size); // only fails if we actually removed something
      }),
    );
  });
});

describe('foldFromGenesis: fast-forward fold (ADR-021 §2.1/§5 item 1, C19)', () => {
  it('P-30: for a main-merge commit (mergeBase(B) == main.head), headHash(fold(mainMergeCommit)) == headHash(fold(branch.head))', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        // Degenerate case (side never advanced past genesis): there is no
        // merge commit at all — `buildGraph` gives it `kind: 'manual'` and
        // `sideHeadId === genesisId`, which this property has nothing to
        // say about.
        fc.pre(graph.sideHeadId !== graph.genesisId);
        expect(headHash(foldFromGenesis(graph.mergeCommitId, graph.loader))).toBe(headHash(foldFromGenesis(graph.sideHeadId, graph.loader)));
      }),
    );
  });

  it('P-30: a refresh commit with no structural findings folds bit-for-bit as before — the fast-forward rule leaves the replay path unchanged', () => {
    fc.assert(
      fc.property(refreshGraphArb, (graph) => {
        // Independently-computed reference fold, the same technique the
        // `graphArb` suite's own "matches a flat, independently-computed
        // fold" test already uses — main and side are built independently
        // here, so replaying (main's commits, then side's, then the
        // refresh) in that order is one valid, and easily verified,
        // dependency order.
        let flat: Head = emptyHead();
        for (const id of graph.commitsInDependencyOrder) {
          const node = graph.loader(id);
          if (!node) continue;
          flat = fold(flat, node.deltas, { authorId: node.author_id, createdAt: node.created_at });
        }
        expect(canonicalizeHead(foldFromGenesis(graph.refreshId, graph.loader))).toEqual(canonicalizeHead(flat));
      }),
    );
  });

  it("a refresh commit's parent is never in the ancestry of its merged branch head unless the branch had no own commits — confirming the generator actually exercises the non-fast-forward path", () => {
    fc.assert(
      fc.property(refreshGraphArb, (graph) => {
        // Excluded, not a counterexample to the property: if the branch
        // never advanced past genesis (`sideCount === 0`), its own head
        // *is* genesis, which is trivially an ancestor of anything main
        // goes on to do — a real (if degenerate) fast-forward case in its
        // own right, just from the other direction. The property is about
        // a branch that has actually diverged.
        fc.pre(graph.sideHeadId !== graph.genesisId);
        fc.pre(graph.sideHeadId !== graph.mainHeadId);
        expect(ancestry(graph.mainHeadId, graph.loader).has(graph.sideHeadId)).toBe(false);
      }),
    );
  });

  it('P-2 extension: the resume-point optimisation agrees with a from-scratch fold for both merge shapes', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const genesisHead = foldFromGenesis(graph.genesisId, graph.loader);
        const withResume = foldFromGenesis(graph.mergeCommitId, graph.loader, { commitId: graph.genesisId, head: genesisHead });
        const fromScratch = foldFromGenesis(graph.mergeCommitId, graph.loader);
        expect(headHash(withResume)).toBe(headHash(fromScratch));
      }),
    );
    fc.assert(
      fc.property(refreshGraphArb, (graph) => {
        const genesisHead = foldFromGenesis(graph.genesisId, graph.loader);
        const withResume = foldFromGenesis(graph.refreshId, graph.loader, { commitId: graph.genesisId, head: genesisHead });
        const fromScratch = foldFromGenesis(graph.refreshId, graph.loader);
        expect(headHash(withResume)).toBe(headHash(fromScratch));
      }),
    );
  });

  it('verifyHeadMatchesFold holds for both merge shapes', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        expect(verifyHeadMatchesFold(foldFromGenesis(graph.mergeCommitId, graph.loader), graph.mergeCommitId, graph.loader).ok).toBe(true);
      }),
    );
    fc.assert(
      fc.property(refreshGraphArb, (graph) => {
        expect(verifyHeadMatchesFold(foldFromGenesis(graph.refreshId, graph.loader), graph.refreshId, graph.loader).ok).toBe(true);
      }),
    );
  });
});

describe('ancestry / exclusive / topo', () => {
  it('ancestry(null) is empty, and ancestry(id) always includes id itself', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        expect(ancestry(null, graph.loader).size).toBe(0);
        expect(ancestry(graph.mergeId, graph.loader).has(graph.mergeId)).toBe(true);
      }),
    );
  });

  it('exclusive(sideHead, genesis) is exactly the side branch commits (empty when the side branch never advanced past genesis)', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const ex = exclusive(graph.sideHeadId, graph.genesisId, graph.loader);
        if (graph.sideHeadId === graph.genesisId) {
          expect(ex.size).toBe(0);
        } else {
          expect(ex.has(graph.genesisId)).toBe(false);
          expect(ex.has(graph.sideHeadId)).toBe(true);
        }
      }),
    );
  });

  it('topo over any ancestry set places a commit after its first parent', () => {
    // Depth is monotonic along first-parent chains specifically (each step
    // is exactly +1), so this holds for any ancestry set. It does NOT
    // extend to merged_branch_head_commit_id in general — see the test
    // below and the comment on the "matches a flat fold" test above: a
    // merge commit's own depth only counts its first-parent chain, so
    // topo's ordering guarantee for the second-parent edge only holds
    // within one `exclusive(...)` chain, which is the only way `topo` is
    // ever actually used (here and in foldFromGenesis).
    fc.assert(
      fc.property(graphArb, (graph) => {
        const order = topo(ancestry(graph.mergeId, graph.loader), graph.loader);
        const position = new Map(order.map((id, i) => [id, i]));
        for (const id of order) {
          const node = graph.nodes.get(id);
          if (!node?.parent_commit_id) continue;
          expect(position.get(node.parent_commit_id)).toBeLessThan(must(position.get(id)));
        }
      }),
    );
  });

  it("topo over one exclusive(...) chain (topo's real usage) places every commit after its parent, merged-branch-head included", () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        fc.pre(graph.sideHeadId !== graph.genesisId);
        const order = topo(exclusive(graph.sideHeadId, graph.genesisId, graph.loader), graph.loader);
        const position = new Map(order.map((id, i) => [id, i]));
        for (const id of order) {
          const node = graph.nodes.get(id);
          if (!node) continue;
          if (node.parent_commit_id && position.has(node.parent_commit_id)) {
            expect(position.get(node.parent_commit_id)).toBeLessThan(must(position.get(id)));
          }
          if (node.merged_branch_head_commit_id && position.has(node.merged_branch_head_commit_id)) {
            expect(position.get(node.merged_branch_head_commit_id)).toBeLessThan(must(position.get(id)));
          }
        }
      }),
    );
  });
});

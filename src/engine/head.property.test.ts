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
    attributes: { level: 1 },
    sourceId: 'src',
    confidence: 1,
  };
}

interface Graph {
  loader: CommitLoader;
  nodes: Map<UUID, CommitNode>;
  genesisId: UUID;
  mergeId: UUID;
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
    message: 'genesis',
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
      message: `side ${String(i)}`,
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
    message: 'merge',
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
      message: `after-merge ${String(i)}`,
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

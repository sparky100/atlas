/**
 * Commit-DAG-level folding, the canonical hash, and the head == fold proof
 * obligation (SPEC-data-model.md §6.1, §6.4–§6.6). Builds on
 * src/engine/deltas.ts's single-commit `fold`; this module is the part that
 * walks `parent_commit_id` / `merged_branch_head_commit_id` across commits.
 *
 * Pure and synchronous, like deltas.ts: `CommitLoader` is a plain lookup
 * function. In production it's backed by whatever range of commits src/db
 * has already fetched from Postgres into memory (a later Sprint F1 step);
 * in tests it's backed by a plain Map.
 */

import { createHash } from 'node:crypto';
import type { Delta, UUID } from '../contracts/delta';
import type { CommitRow } from '../contracts/rows';
import type { ElementRow, FactRow, Head, RelationshipRow } from './deltas';
import { cloneHead, emptyHead, fold } from './deltas';
import { EngineError } from './errors';

/** A commit plus its own deltas (already ordered by `seq`) — everything `foldFromGenesis` needs about one commit. */
export interface CommitNode extends CommitRow {
  deltas: readonly Delta[];
}

/** Looks up a commit by id. Returns `undefined` only for a truly unknown id — never for "no more ancestors" (that's `parentCommitId === null`, not a missing node). */
export type CommitLoader = (commitId: UUID) => CommitNode | undefined;

/** `loader(id)`, throwing a clear `EngineError` instead of returning `undefined` for a truly unknown commit. Exported so branch.ts/merge.ts share the same lookup behaviour rather than re-deriving it. */
export function mustLoadCommit(id: UUID, loader: CommitLoader): CommitNode {
  const node = loader(id);
  if (!node) throw new EngineError(`unknown commit ${id}`);
  return node;
}
const load = mustLoadCommit;

// ---------------------------------------------------------------------------
// ancestry / exclusive / topo (SPEC §6.1)
// ---------------------------------------------------------------------------

/**
 * Every commit reachable from `commitId` via `parent_commit_id` and
 * `merged_branch_head_commit_id`, including `commitId` itself. `null` (no
 * commit — mirroring `foldFromGenesis(null)`'s empty landscape) has empty
 * ancestry: a merge commit's `parent_commit_id` can itself be null (it can
 * be a model's very first commit ever, main having no prior history to
 * fork from — SPEC-data-model.md §3.4, ADR-006), so callers computing
 * `exclusive` against a commit's parent need this to be total.
 */
export function ancestry(commitId: UUID | null, loader: CommitLoader): Set<UUID> {
  const seen = new Set<UUID>();
  if (commitId === null) return seen;
  const stack = [commitId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const node = load(id, loader);
    if (node.parent_commit_id) stack.push(node.parent_commit_id);
    if (node.merged_branch_head_commit_id) stack.push(node.merged_branch_head_commit_id);
  }
  return seen;
}

/** `ancestry(c2) \ ancestry(c1)`. */
export function exclusive(c2: UUID, c1: UUID | null, loader: CommitLoader): Set<UUID> {
  const a1 = ancestry(c1, loader);
  const a2 = ancestry(c2, loader);
  const result = new Set<UUID>();
  for (const id of a2) if (!a1.has(id)) result.add(id);
  return result;
}

/** Commits sorted so parents precede children, ties broken by `(depth, created_at, id)` (SPEC §6.1). */
export function topo(commitIds: Iterable<UUID>, loader: CommitLoader): UUID[] {
  return [...commitIds]
    .map((id) => load(id, loader))
    .sort((a, b) => a.depth - b.depth || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((node) => node.id);
}

// ---------------------------------------------------------------------------
// fold (SPEC §6.2, the outer recursion) and materialise's resume optimisation (§6.5)
// ---------------------------------------------------------------------------

export interface ResumePoint {
  commitId: UUID;
  head: Head;
}

/**
 * The full folded state at `commitId` (`null` = the empty landscape before
 * any commit). Recurses through `parent_commit_id`, and on a merge commit
 * also folds in `exclusive(mergedBranchHeadCommitId, parentCommitId)` from
 * the other side, topologically sorted, before applying the merge commit's
 * own (resolution) deltas.
 *
 * `resumePoint`, if given, short-circuits the recursion the moment it
 * reaches `resumePoint.commitId`, returning a clone of `resumePoint.head`
 * instead of continuing to genesis. Omitting it computes the full fold from
 * scratch (SPEC §6.2); supplying a retained prior head is the "replay only
 * what's changed" optimisation (SPEC §6.5's `materialise`) — one function
 * for both, so proving `head == fold(deltas)` (§6.6, P-2) is just "call
 * this twice, with and without a resume point that lies on the same
 * ancestry, and compare hashes."
 */
export function foldFromGenesis(commitId: UUID | null, loader: CommitLoader, resumePoint?: ResumePoint): Head {
  if (resumePoint?.commitId === commitId) return cloneHead(resumePoint.head);
  if (commitId === null) return emptyHead();

  const node = load(commitId, loader);
  const head = foldFromGenesis(node.parent_commit_id, loader, resumePoint);

  if (node.merged_branch_head_commit_id) {
    const otherSide = topo(exclusive(node.merged_branch_head_commit_id, node.parent_commit_id, loader), loader);
    for (const otherId of otherSide) {
      const otherNode = load(otherId, loader);
      fold(head, otherNode.deltas, { authorId: otherNode.author_id, createdAt: otherNode.created_at });
    }
  }

  fold(head, node.deltas, { authorId: node.author_id, createdAt: node.created_at });
  return head;
}

// ---------------------------------------------------------------------------
// Canonical hash (SPEC §6.4)
// ---------------------------------------------------------------------------

type CanonicalElement = [UUID, string, string, UUID | null, [string, unknown][], UUID];
type CanonicalRelationship = [UUID, string, UUID, UUID, [string, unknown][], UUID];
type CanonicalFact = [UUID, string, unknown, UUID];

export interface CanonicalHead {
  elements: CanonicalElement[];
  relationships: CanonicalRelationship[];
  facts: CanonicalFact[];
}

function sortedEntries(attributes: Record<string, unknown>): [string, unknown][] {
  return Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b));
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function elementToCanonical([id, row]: [UUID, ElementRow]): CanonicalElement {
  return [id, row.elementType, row.name, row.parentId, sortedEntries(row.attributes), row.existsDeltaId];
}

function relationshipToCanonical([id, row]: [UUID, RelationshipRow]): CanonicalRelationship {
  return [id, row.relationshipType, row.fromElementId, row.toElementId, sortedEntries(row.attributes), row.existsDeltaId];
}

function factToCanonical(fact: FactRow): CanonicalFact {
  return [fact.subjectId, fact.attribute, fact.value, fact.deltaId];
}

/**
 * The part of a `Head` that determines its identity: live elements,
 * relationships, and facts, each sorted into a deterministic order.
 * `retracted*`/`factHistory` are deliberately excluded — they're
 * bookkeeping `apply` needs, not part of the folded state itself (SPEC
 * §6.1's `Head` definition has no such fields, and the persisted `facts`
 * table never holds them either).
 */
export function canonicalizeHead(head: Head): CanonicalHead {
  return {
    elements: [...head.elements].sort(([a], [b]) => compareIds(a, b)).map(elementToCanonical),
    relationships: [...head.relationships].sort(([a], [b]) => compareIds(a, b)).map(relationshipToCanonical),
    facts: [...head.facts.values()]
      .sort((a, b) => compareIds(a.subjectId, b.subjectId) || compareIds(a.attribute, b.attribute))
      .map(factToCanonical),
  };
}

/** Deterministic JSON: sorted object keys (arrays keep their given order — `canonicalizeHead` already sorted those). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of the canonical head, hex-encoded (SPEC §6.4, S-15's `commits.head_hash`). */
export function headHash(head: Head): string {
  return createHash('sha256').update(stableStringify(canonicalizeHead(head)), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// The proof obligation (SPEC §6.6)
// ---------------------------------------------------------------------------

export interface VerifyResult {
  ok: boolean;
  expectedHash: string;
  actualHash: string;
}

/**
 * "head == fold(deltas)" as a checkable equation (SPEC §6.6): recomputes
 * the head at `atCommitId` from genesis and compares its hash against
 * `claimedHead`'s. This is what the nightly integrity job and tag creation
 * (§6.6, points 2–3) call in production, and what property test P-2
 * exercises directly with `foldFromGenesis`'s own resume-point output as
 * the "claimed" head.
 */
export function verifyHeadMatchesFold(claimedHead: Head, atCommitId: UUID | null, loader: CommitLoader): VerifyResult {
  const expected = foldFromGenesis(atCommitId, loader);
  const expectedHash = headHash(expected);
  const actualHash = headHash(claimedHead);
  return { ok: expectedHash === actualHash, expectedHash, actualHash };
}

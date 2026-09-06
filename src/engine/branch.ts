/**
 * Branch operations (SPEC-data-model.md §7.1–§7.2): forking a branch at a
 * commit, listing a branch's own deltas, and the per-fact-key three-way
 * comparison against main that src/engine/merge.ts's element-level
 * classification builds on.
 *
 * Pure and synchronous, like deltas.ts/head.ts. This module has no notion
 * of "which branch_id is main" — a real `branches` row's `kind` column is a
 * src/db concern — so every function here takes the relevant commit ids
 * explicitly (the branch's head, and main's current head) rather than a
 * branch id it would need to look up.
 */

import type { Delta, UUID } from '../contracts/delta';
import type { FactRow, Head } from './deltas';
import { EngineError } from './errors';
import { ancestry, exclusive, foldFromGenesis, mustLoadCommit, topo, type CommitLoader } from './head';

// ---------------------------------------------------------------------------
// Forking (SPEC §3.4: a new change branch's head_commit_id starts equal to
// base_commit_id, which must be on main — the RLS policy in
// 20260906071400_history.sql checks the same thing at insert time; this is
// its pure, engine-side equivalent, usable before anything is inserted.)
// ---------------------------------------------------------------------------

export interface BranchFork {
  baseCommitId: UUID;
  headCommitId: UUID;
}

/**
 * The initial fork of a new change branch at `mainHeadCommitId`. Throws if
 * that commit doesn't exist; does not (cannot, without a `branches` table)
 * verify it's actually on main — that check stays with RLS/the caller.
 */
export function forkBranchAt(mainHeadCommitId: UUID, loader: CommitLoader): BranchFork {
  mustLoadCommit(mainHeadCommitId, loader); // throws EngineError if unknown
  return { baseCommitId: mainHeadCommitId, headCommitId: mainHeadCommitId };
}

/** The branch's as-is view: main's state at the moment it forked (UI-principles.md §6.2). */
export function asIs(branch: BranchFork, loader: CommitLoader): Head {
  return foldFromGenesis(branch.baseCommitId, loader);
}

/** The branch's to-be view: its own current state, base plus everything it's added (UI-principles.md §6.2). */
export function toBe(branch: BranchFork, loader: CommitLoader): Head {
  return foldFromGenesis(branch.headCommitId, loader);
}

/** Every delta the branch itself has introduced since its fork point, in dependency order — not main's. */
export function listOwnDeltas(branch: BranchFork, loader: CommitLoader): Delta[] {
  const ownCommitIds = topo(exclusive(branch.headCommitId, branch.baseCommitId, loader), loader);
  return ownCommitIds.flatMap((id) => [...mustLoadCommit(id, loader).deltas]);
}

// ---------------------------------------------------------------------------
// mergeBase (SPEC §7.1)
// ---------------------------------------------------------------------------

/** Main's own linear history, main's head back to genesis, following only `parent_commit_id` ("main's first-parent chain is linear", SPEC §7.1). */
function mainChain(mainHeadCommitId: UUID, loader: CommitLoader): Set<UUID> {
  const chain = new Set<UUID>();
  let cursor: UUID | null = mainHeadCommitId;
  while (cursor !== null) {
    chain.add(cursor);
    cursor = mustLoadCommit(cursor, loader).parent_commit_id;
  }
  return chain;
}

/**
 * The newest main commit in the branch's ancestry — where the branch's
 * history and main's diverge. `mergeBase(B) === mainHeadCommitId` is
 * ADR-006's "no refresh needed" precondition (SPEC §7.1).
 */
export function mergeBase(branchHeadCommitId: UUID, mainHeadCommitId: UUID, loader: CommitLoader): UUID {
  const chain = mainChain(mainHeadCommitId, loader);
  let best: UUID | null = null;
  let bestDepth = -1;
  for (const id of ancestry(branchHeadCommitId, loader)) {
    if (!chain.has(id)) continue;
    const depth = mustLoadCommit(id, loader).depth;
    if (depth > bestDepth) {
      bestDepth = depth;
      best = id;
    }
  }
  if (best === null) {
    throw new EngineError(`no common ancestor between branch head ${branchHeadCommitId} and main head ${mainHeadCommitId}`);
  }
  return best;
}

// ---------------------------------------------------------------------------
// Per-fact-key three-way comparison (SPEC §7.2)
// ---------------------------------------------------------------------------

export type FieldClassification = 'UNCHANGED' | 'OURS' | 'THEIRS' | 'CONVERGED' | 'FIELD_CONFLICT';

export interface FieldDiff {
  subjectId: UUID;
  attribute: string;
  classification: FieldClassification;
  base?: FactRow;
  ours?: FactRow;
  theirs?: FactRow;
}

/** Structural (not deep) equality over a jsonb-shaped value — exactly what SPEC §7.2's `vo == vt (deep equal)` needs. */
export function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonDeepEqual(v, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => k in b && jsonDeepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/**
 * Every fact key present in any of `base`/`ours`/`theirs`, classified per
 * SPEC §7.2. Compares on `deltaId`, not value — deliberately: a
 * re-assertion of the same value from a different (better) source is a
 * provenance change, carried across like any other change, not treated as
 * "unchanged".
 */
export function diffFacts(base: Head, ours: Head, theirs: Head): FieldDiff[] {
  const keys = new Set<string>([...base.facts.keys(), ...ours.facts.keys(), ...theirs.facts.keys()]);
  const results: FieldDiff[] = [];
  for (const key of keys) {
    const b = base.facts.get(key);
    const o = ours.facts.get(key);
    const t = theirs.facts.get(key);
    const subject = o ?? t ?? b;
    if (!subject) continue; // unreachable: key came from one of the three maps

    const oursChanged = o?.deltaId !== b?.deltaId;
    const theirsChanged = t?.deltaId !== b?.deltaId;

    let classification: FieldClassification;
    if (!oursChanged && !theirsChanged) classification = 'UNCHANGED';
    else if (oursChanged && !theirsChanged) classification = 'OURS';
    else if (!oursChanged && theirsChanged) classification = 'THEIRS';
    else if (jsonDeepEqual(o?.value, t?.value)) classification = 'CONVERGED';
    else classification = 'FIELD_CONFLICT';

    results.push({
      subjectId: subject.subjectId,
      attribute: subject.attribute,
      classification,
      ...(b !== undefined ? { base: b } : {}),
      ...(o !== undefined ? { ours: o } : {}),
      ...(t !== undefined ? { theirs: t } : {}),
    });
  }
  return results;
}

export interface ThreeWayDiff {
  mergeBaseCommitId: UUID;
  base: Head;
  ours: Head;
  theirs: Head;
  fields: FieldDiff[];
  /** `mergeBaseCommitId === mainHeadCommitId` — ADR-006's "no refresh needed" (SPEC §7.1). */
  upToDateWithMain: boolean;
}

/** The full three-way diff of a branch against main's current head — everything src/engine/merge.ts's classification needs, computed once. */
export function threeWayDiff(branchHeadCommitId: UUID, mainHeadCommitId: UUID, loader: CommitLoader): ThreeWayDiff {
  const mergeBaseCommitId = mergeBase(branchHeadCommitId, mainHeadCommitId, loader);
  const base = foldFromGenesis(mergeBaseCommitId, loader);
  const ours = foldFromGenesis(branchHeadCommitId, loader);
  const theirs = foldFromGenesis(mainHeadCommitId, loader);
  return { mergeBaseCommitId, base, ours, theirs, fields: diffFacts(base, ours, theirs), upToDateWithMain: mergeBaseCommitId === mainHeadCommitId };
}

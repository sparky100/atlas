/**
 * F5's own "markers for changes that add or retire" and "replacement
 * arrows" (docs/prompts/atlas-prompt-pack.md). Derived directly from a
 * merged change's own deltas — the same low-level `listOwnDeltas`/
 * `foldFromGenesis` pair `src/db/changeSummary.ts` already uses for the
 * change page, not that module's own already-summarized output: a
 * `relationship.retract` delta carries only its own `relationshipId`
 * (relationships are immutable — "to re-point, retract and create," SPEC),
 * never the endpoints it used to have, so recovering "which system, which
 * capability" needs the as-is head's own row, not a display string
 * already flattened into "supports A → B" text.
 *
 * "Replacement" here comes from two equivalent sources, both looked for in
 * the one change's own deltas:
 *  - the `replaces` edge itself (`useElementRetire.ts` writes it
 *    replacement-from -> retiring-to, ADR-001), which names the swap
 *    directly; and
 *  - a `supports` edge retracted from an old system into a capability, with
 *    a `supports` edge created from a *different* system into that *same*
 *    capability (UI-principles decision 4, "planned replacement requires a
 *    retract delta in the same approved change").
 * A retire-with-replacement records both, so a `replaces` edge for a pairing
 * takes precedence and the supports re-derivation is skipped for it —
 * otherwise the same swap would get one arrow per transferred capability
 * (the common shape is every supports edge retracted from the old system and
 * recreated from the new one in the one change).
 * Nothing beyond those two is inferred — a retract with no matching create
 * for the same capability is a bare removal (no marker of its own here; the
 * retiring system's own "retire" marker already covers it), never guessed at
 * as a replacement.
 *
 * F5 follow-up ("committed directly on main"): the whole branch path only
 * reads `kind: 'change'` branches that carry a `target_date`
 * (`isRoadmapEligibleBranch`), so lifecycle facts committed straight onto
 * `main` — `useElementRetire.ts` runs on whatever branch the element page
 * has selected, main included — never reached the roadmap. `loadMainCommittedRoadmapEventsForModel`
 * closes that gap: it derives the two signals that reconstruct cleanly from
 * a single folded head (a `lifecycleStatus -> "retiring"` update and a
 * `replaces` edge, which names the swap directly) from main's *own* commits
 * — its linear chain minus merge commits, which only carry branch deltas the
 * branch path already surfaced — and synthesises one roadmap-eligible
 * pseudo-branch per event dated at the retiring element's own `plannedEnd`
 * (the same date the lifecycle bar already ends at, `roadmapLifecycleRows.ts`).
 * Deliberately not derived there: a main-committed supports transfer (its
 * retract endpoints only resolve against the head at the moment of the
 * retract, not a single folded head — the branch path can do that because
 * each branch fork pins its own as-is head) and `add` markers for elements
 * created on main.
 */
import type { Delta, UUID } from '../contracts/delta';
import { listOwnDeltas, type BranchFork } from '../engine/branch';
import type { Head } from '../engine/deltas';
import { foldFromGenesis, mustLoadCommit, type CommitLoader } from '../engine/head';
import { buildCommitLoader } from './commitLoader';
import type { Client } from './client';
import type { BranchRow } from './types';
import { isSystemLikeType } from '../contracts/elementKinds';

export interface RoadmapAddMarker {
  kind: 'add';
  elementId: UUID;
  elementName: string;
}

export interface RoadmapRetireMarker {
  kind: 'retire';
  elementId: UUID;
  elementName: string;
}

export interface RoadmapReplacementArrow {
  kind: 'replace';
  /** The pairing's capability when the arrow came from a supports-edge transfer; absent when it came from a `replaces` edge, which names systems but no capability. */
  capabilityId?: UUID;
  capabilityName?: string;
  fromSystemId: UUID;
  fromSystemName: string;
  toSystemId: UUID;
  toSystemName: string;
}

export type RoadmapChangeEvent = RoadmapAddMarker | RoadmapRetireMarker | RoadmapReplacementArrow;

function elementNameOf(head: Head, fallbackHead: Head, elementId: UUID): string {
  return (head.elements.get(elementId) ?? fallbackHead.elements.get(elementId))?.name ?? elementId;
}

/**
 * @param ownDeltas This change's own deltas (`listOwnDeltas`'s dependency order) — every delta the branch itself contributed, never main's.
 * @param asIsHead Folded at the branch's base commit — resolves what a retract used to point at.
 * @param toBeHead Folded at the branch's head commit — resolves what a create points at, and every element's current name.
 */
export function deriveRoadmapChangeEvents(ownDeltas: readonly Delta[], asIsHead: Head, toBeHead: Head): RoadmapChangeEvent[] {
  const events: RoadmapChangeEvent[] = [];

  // Capability id -> the one system this change's own deltas retracted from it / created into it.
  const supportsRetractedFrom = new Map<UUID, UUID>();
  const supportsCreatedTo = new Map<UUID, UUID>();
  // Every named replacement (a `replaces` edge: `from` is the replacement,
  // `to` the retiring element, per ADR-001's delta shape) — a plain list,
  // not a Map keyed by the retiring element: ADR-001 allows split (one
  // retiring element, several replacements, e.g. a monolith split two
  // ways), and a Map can hold only one value per key, so a second
  // `replaces` edge for the same retiring element silently overwrote the
  // first, dropping one of the two arrows.
  const replacedPairs: { toElementId: UUID; fromElementId: UUID }[] = [];

  for (const delta of ownDeltas) {
    // `system` or `container` (a platform module — "platforms and modules"
    // can carry `lifecycleStatus`/`plannedEnd` same as a system, per
    // `roadmapLifecycleRows.ts`'s own module comment) — a module being
    // added or retired is exactly as roadmap-meaningful as a system.
    if (delta.kind === 'element.create' && isSystemLikeType(delta.elementType)) {
      events.push({ kind: 'add', elementId: delta.elementId, elementName: delta.name });
      continue;
    }

    if (delta.kind === 'element.update' && isSystemLikeType(delta.elementType) && delta.attribute === 'lifecycleStatus' && delta.value === 'retiring') {
      events.push({ kind: 'retire', elementId: delta.elementId, elementName: elementNameOf(toBeHead, asIsHead, delta.elementId) });
      continue;
    }

    if (delta.kind === 'relationship.retract') {
      const rel = asIsHead.relationships.get(delta.relationshipId);
      if (rel?.relationshipType === 'supports') supportsRetractedFrom.set(rel.toElementId, rel.fromElementId);
      continue;
    }

    if (delta.kind === 'relationship.create' && delta.relationshipType === 'supports') {
      supportsCreatedTo.set(delta.toElementId, delta.fromElementId);
      continue;
    }

    if (delta.kind === 'relationship.create' && delta.relationshipType === 'replaces') {
      replacedPairs.push({ toElementId: delta.toElementId, fromElementId: delta.fromElementId });
    }
  }

  for (const { toElementId: oldSystemId, fromElementId: newSystemId } of replacedPairs) {
    if (newSystemId === oldSystemId) continue;
    events.push({
      kind: 'replace',
      fromSystemId: oldSystemId,
      fromSystemName: elementNameOf(asIsHead, toBeHead, oldSystemId),
      toSystemId: newSystemId,
      toSystemName: elementNameOf(toBeHead, asIsHead, newSystemId),
    });
  }

  for (const [capabilityId, oldSystemId] of supportsRetractedFrom) {
    const newSystemId = supportsCreatedTo.get(capabilityId);
    if (newSystemId === undefined || newSystemId === oldSystemId) continue;
    // A `replaces` edge already naming this exact pairing took precedence
    // above — don't also re-derive the same swap from the transferred
    // supports edges (a retire-with-replacement retracts every supports edge
    // from the old system and recreates it from the new one).
    if (replacedPairs.some((p) => p.toElementId === oldSystemId && p.fromElementId === newSystemId)) continue;
    events.push({
      kind: 'replace',
      capabilityId,
      capabilityName: elementNameOf(toBeHead, asIsHead, capabilityId),
      fromSystemId: oldSystemId,
      fromSystemName: elementNameOf(asIsHead, toBeHead, oldSystemId),
      toSystemId: newSystemId,
      toSystemName: elementNameOf(toBeHead, asIsHead, newSystemId),
    });
  }

  return events;
}

export interface RoadmapBranchEvents {
  branch: BranchRow;
  events: RoadmapChangeEvent[];
}

/**
 * `deriveRoadmapChangeEvents` for every eligible branch at once, sharing
 * one `buildCommitLoader` call the same way `loadChangeSummariesForModel`
 * does — batch, not N+1. `branches` is the caller's own already-filtered
 * set (F5's own inclusion rule: `intent in ('record','propose')`,
 * `status === 'merged'`, `target_date` not null — `explore`/`correct`
 * branches carry no roadmap-meaningful date at all, per
 * `branchIntent.ts`'s own `isDateRequiredForIntent`).
 *
 * Known gap, disclosed rather than silently handled (docs/prompts/atlas-prompt-pack.md's
 * own register): a branch created by partial acceptance (`split_from` set)
 * is processed as its own, separate entry here — SPEC-data-model.md §11's
 * "one logical change" roll-up (`resolveChangeLineage`, src/db/branches.ts)
 * isn't applied yet, so a split branch's events can appear as a second
 * roadmap entry alongside its original rather than merged into one.
 */
export async function loadRoadmapChangeEventsForModel(supabase: Client, modelId: UUID, branches: readonly BranchRow[], sharedLoader?: CommitLoader): Promise<RoadmapBranchEvents[]> {
  const results: RoadmapBranchEvents[] = [];
  if (branches.length === 0) return results;

  const loader = sharedLoader ?? (await buildCommitLoader(supabase, modelId));
  for (const branch of branches) {
    if (!branch.base_commit_id || !branch.head_commit_id) continue;

    const fork: BranchFork = { baseCommitId: branch.base_commit_id, headCommitId: branch.head_commit_id };
    const ownDeltas = listOwnDeltas(fork, loader);
    if (ownDeltas.length === 0) {
      results.push({ branch, events: [] });
      continue;
    }

    // Same "one bad branch shouldn't blank the whole roadmap" stance
    // `loadChangeSummariesForModel` already takes for the identical fold.
    try {
      const toBeHead = foldFromGenesis(branch.head_commit_id, loader);
      const asIsHead = foldFromGenesis(branch.base_commit_id, loader);
      results.push({ branch, events: deriveRoadmapChangeEvents(ownDeltas, asIsHead, toBeHead) });
    } catch {
      continue;
    }
  }
  return results;
}

/** Every delta main contributed itself: walk main's linear first-parent chain (`branch.ts`'s own `mainChain` shape), keeping only commits whose `branch_id` is main and that are not merge commits (`merged_branch_head_commit_id === null` — C14) — a merge commit's deltas are the merged branch's own, which the branch path above already surfaced. Oldest-first, matching `listOwnDeltas`'s dependency order. */
export function listMainCommittedDeltas(loader: CommitLoader, mainBranch: Pick<BranchRow, 'id' | 'head_commit_id'>): Delta[] {
  const commitDeltas: Delta[][] = [];
  let cursor: UUID | null = mainBranch.head_commit_id;
  while (cursor !== null) {
    const node = mustLoadCommit(cursor, loader);
    if (node.branch_id === mainBranch.id && node.merged_branch_head_commit_id === null) commitDeltas.push([...node.deltas]);
    cursor = node.parent_commit_id;
  }
  return commitDeltas.reverse().flat();
}

/** A stand-in `branches` row for one main-committed event, dated at the retiring element's own `plannedEnd`. Not a real branch — the roadmap only ever reads `id` (its React key), `target_date` (marker position), and the eligibility fields — so a spread of main's own row keeps every other field truthful; `status: 'merged'` + `intent: 'record'` is exactly what `isRoadmapEligibleBranch` needs to show a landed fact under both as-is and to-be. */
function pseudoMainBranch(mainBranch: BranchRow, deltaId: string, targetDate: string): BranchRow {
  return { ...mainBranch, id: `main:${deltaId}`, intent: 'record', status: 'merged', target_date: targetDate };
}

/**
 * Derives roadmap events from main's own commits — a retirement's
 * `lifecycleStatus -> "retiring"` update and a `replaces` edge — and wraps
 * each in its own pseudo-branch dated at the retiring element's `plannedEnd`
 * from `head` (folded at main). Events already shown by an eligible change
 * branch (`alreadyShown`) are skipped, so a retirement recorded both on a
 * change branch and on main — or merged in via a merge commit — shows once,
 * never twice. An event whose element carries no `plannedEnd` is dropped:
 * with nothing to place it at, it stays off the timeline, the same "dateless
 * doesn't appear" stance `isRoadmapEligibleBranch` takes for branches.
 */
export function deriveMainCommittedChangeEvents(directMainDeltas: readonly Delta[], head: Head, alreadyShown: readonly RoadmapBranchEvents[], mainBranch: BranchRow): RoadmapBranchEvents[] {
  const results: RoadmapBranchEvents[] = [];
  const shownRetires = new Set(alreadyShown.flatMap(({ events }) => events.filter((e) => e.kind === 'retire').map((e) => e.elementId)));
  const shownReplacePairs = new Set(alreadyShown.flatMap(({ events }) => events.filter((e) => e.kind === 'replace').map((e) => `${e.fromSystemId}|${e.toSystemId}`)));

  for (const delta of directMainDeltas) {
    if (delta.kind === 'element.update' && isSystemLikeType(delta.elementType) && delta.attribute === 'lifecycleStatus' && delta.value === 'retiring') {
      if (shownRetires.has(delta.elementId)) continue;
      const element = head.elements.get(delta.elementId);
      const plannedEnd = typeof element?.attributes.plannedEnd === 'string' ? element.attributes.plannedEnd : undefined;
      if (plannedEnd === undefined) continue;
      results.push({ branch: pseudoMainBranch(mainBranch, delta.id, plannedEnd), events: [{ kind: 'retire', elementId: delta.elementId, elementName: element?.name ?? delta.elementId }] });
      continue;
    }

    if (delta.kind === 'relationship.create' && delta.relationshipType === 'replaces') {
      const retiringId = delta.toElementId;
      const replacementId = delta.fromElementId;
      if (shownReplacePairs.has(`${retiringId}|${replacementId}`)) continue;
      const retiring = head.elements.get(retiringId);
      const plannedEnd = typeof retiring?.attributes.plannedEnd === 'string' ? retiring.attributes.plannedEnd : undefined;
      if (plannedEnd === undefined) continue;
      results.push({
        branch: pseudoMainBranch(mainBranch, delta.id, plannedEnd),
        events: [
          {
            kind: 'replace',
            fromSystemId: retiringId,
            fromSystemName: retiring?.name ?? retiringId,
            toSystemId: replacementId,
            toSystemName: head.elements.get(replacementId)?.name ?? replacementId,
          },
        ],
      });
    }
  }

  return results;
}

/**
 * `deriveMainCommittedChangeEvents` for main itself — one shared loader with
 * the change-branch path when the caller already built one (useRoadmap), so
 * the roadmap's two event sources never load the model twice.
 */
export async function loadMainCommittedRoadmapEventsForModel(supabase: Client, modelId: UUID, mainBranch: BranchRow, alreadyShown: readonly RoadmapBranchEvents[], sharedLoader?: CommitLoader): Promise<RoadmapBranchEvents[]> {
  const loader = sharedLoader ?? (await buildCommitLoader(supabase, modelId));
  const directMainDeltas = listMainCommittedDeltas(loader, mainBranch);
  if (directMainDeltas.length === 0) return [];
  try {
    const head = foldFromGenesis(mainBranch.head_commit_id, loader);
    return deriveMainCommittedChangeEvents(directMainDeltas, head, alreadyShown, mainBranch);
  } catch {
    return []; // same "one bad branch shouldn't blank the whole roadmap" stance the branch path takes
  }
}

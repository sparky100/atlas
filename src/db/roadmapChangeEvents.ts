/**
 * F5's own "markers for changes that add or retire" and "replacement
 * arrows" (docs/prompts/atlas-prompt-pack.md). Derived directly from a
 * merged change's own deltas — the same low-level `listOwnDeltas`/
 * `foldFromGenesis` pair `src/db/changeSummary.ts` already uses for the
 * change page, not that module's own already-summarized output.
 *
 * "Replacement" here (ADR-001 amendment) is a direct read of every
 * `replaces`-typed `relationship.create` delta the change's own deltas
 * contain — `fromElementId` is the replacement, `toElementId` is the
 * retiring element (`buildReplacesDelta.ts`'s own "B replaces A" = `from:
 * B, to: A` convention), one arrow per edge. This used to be a heuristic:
 * a `supports` edge retracted from an old system into a capability paired
 * with a `supports` edge created from a *different* system into that
 * *same* capability, both in the one change's own deltas — coincidental
 * by construction (two independent supports changes that happen to share
 * a capability were indistinguishable from a real replacement), and
 * deleted outright once a real `replaces` edge existed to read instead,
 * not kept as a fallback. A `replaces` edge carries no capability at all
 * — it is a direct system-to-system fact — so `RoadmapReplacementArrow`
 * no longer carries `capabilityId`/`capabilityName` either.
 */
import type { Delta, UUID } from '../contracts/delta';
import { listOwnDeltas, type BranchFork } from '../engine/branch';
import type { Head } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';
import { buildCommitLoader } from './commitLoader';
import type { Client } from './client';
import type { BranchRow } from './types';

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
 * @param asIsHead Folded at the branch's base commit — `elementNameOf`'s own fallback, for a name that only ever existed before this change.
 * @param toBeHead Folded at the branch's head commit — every element's current name, the primary lookup.
 */
export function deriveRoadmapChangeEvents(ownDeltas: readonly Delta[], asIsHead: Head, toBeHead: Head): RoadmapChangeEvent[] {
  const events: RoadmapChangeEvent[] = [];

  for (const delta of ownDeltas) {
    if (delta.kind === 'element.create' && delta.elementType === 'system') {
      events.push({ kind: 'add', elementId: delta.elementId, elementName: delta.name });
      continue;
    }

    if (delta.kind === 'element.update' && delta.elementType === 'system' && delta.attribute === 'lifecycleStatus' && delta.value === 'retiring') {
      events.push({ kind: 'retire', elementId: delta.elementId, elementName: elementNameOf(toBeHead, asIsHead, delta.elementId) });
      continue;
    }

    if (delta.kind === 'relationship.create' && delta.relationshipType === 'replaces') {
      events.push({
        kind: 'replace',
        fromSystemId: delta.fromElementId,
        fromSystemName: elementNameOf(toBeHead, asIsHead, delta.fromElementId),
        toSystemId: delta.toElementId,
        toSystemName: elementNameOf(toBeHead, asIsHead, delta.toElementId),
      });
    }
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
export async function loadRoadmapChangeEventsForModel(supabase: Client, modelId: UUID, branches: readonly BranchRow[]): Promise<RoadmapBranchEvents[]> {
  const results: RoadmapBranchEvents[] = [];
  if (branches.length === 0) return results;

  const loader = await buildCommitLoader(supabase, modelId);
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

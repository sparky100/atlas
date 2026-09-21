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
 * "Replacement" here is exactly `useElementRetire.ts`'s own shape
 * (UI-principles decision 4, "planned replacement requires a retract
 * delta in the same approved change"): a `supports` edge retracted from
 * an old system into a capability, and a `supports` edge created from a
 * *different* system into that *same* capability, both in the one
 * change's own deltas. Nothing beyond that pairing is inferred — a
 * retract with no matching create for the same capability is a bare
 * removal (no marker of its own here; the retiring system's own "retire"
 * marker already covers it), never guessed at as a replacement.
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
  capabilityId: UUID;
  capabilityName: string;
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

  for (const delta of ownDeltas) {
    // `system` or `container` (a platform module — "platforms and modules"
    // can carry `lifecycleStatus`/`plannedEnd` same as a system, per
    // `roadmapLifecycleRows.ts`'s own module comment) — a module being
    // added or retired is exactly as roadmap-meaningful as a system.
    if (delta.kind === 'element.create' && (delta.elementType === 'system' || delta.elementType === 'container')) {
      events.push({ kind: 'add', elementId: delta.elementId, elementName: delta.name });
      continue;
    }

    if (delta.kind === 'element.update' && (delta.elementType === 'system' || delta.elementType === 'container') && delta.attribute === 'lifecycleStatus' && delta.value === 'retiring') {
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
    }
  }

  for (const [capabilityId, oldSystemId] of supportsRetractedFrom) {
    const newSystemId = supportsCreatedTo.get(capabilityId);
    if (newSystemId === undefined || newSystemId === oldSystemId) continue;
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

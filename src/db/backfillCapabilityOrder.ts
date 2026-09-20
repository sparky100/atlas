/**
 * One-off backfill (Sprint U4-1 C1, tightened after review): every
 * capability gets an explicit `attributes.order` at creation now
 * (`src/ui/capabilityMap/useCapabilityCreate.ts`), but that's only true
 * going forward — a capability hand-added before this change, or seeded
 * from a starter map before the map content itself carried `order`
 * (Sprint U4-1 C1's own content pass), has no `order` at all. Without one
 * it sorts to the end of its siblings (`layout.ts`'s `compareCapabilities`)
 * — `useCapabilityReorder.ts`'s swap now assigns one on the fly the moment
 * such a capability is actually moved (S1 item 13), but this function is
 * the deliberate, model-wide alternative: one owner click
 * (`BackfillCapabilityOrderAction.tsx`) writes a real order for every such
 * capability in the model, in a single commit, rather than waiting for
 * each one to be touched individually.
 *
 * Grouping and numbering: siblings share a raw `parent_id` (even an
 * unresolved one — an orphan still has *some* `parent_id` value, and
 * giving it an order costs nothing and helps if its parent chain is ever
 * fixed). Within a group, a member that already has an order keeps it
 * untouched and only contributes to the group's running maximum; members
 * without one are sorted by name then id (a simpler, local tiebreak than
 * `layout.ts`'s own code-aware `compareCapabilities` — reasonable here
 * since these are exactly the capabilities that predate C1's `code`-and-
 * `order`-carrying content pass, or were never seeded at all, so there's
 * no existing "correct" relative order to preserve) and given sequential
 * values starting one past that maximum, so an already-ordered sibling's
 * position never moves and two backfilled siblings land in a stable,
 * deterministic order relative to each other.
 *
 * Provenance: the caller's own manual source (`getOrCreateManualSource`)
 * — the same source `useCapabilityReorder.ts`'s swaps use, since this is
 * the same kind of fact (a structural convenience value, not sourced from
 * any external reference).
 *
 * Real user session required, not service-role, same as
 * `syncDescriptionsFromMap.ts`'s own comment explains: `atlas.commit_deltas`
 * is `auth.uid()`-driven and has no grant to `service_role` at all
 * (ADR-015: only owner/architect commit directly to main; ADR-007: no
 * fact without provenance) — there is no way to write real model data
 * except as a real signed-in member, by design.
 */
import type { CommitEnvelope, Delta, UUID } from '../contracts/delta';
import type { ElementsHeadRow } from '../contracts/rows';
import type { Head } from '../engine/deltas';
import { attributesRecord } from '../ui/elements/attributesRecord';
import { getMainBranch } from './branches';
import { listCapabilitiesForMap } from './capabilityMap';
import type { Client } from './client';
import { commitToBranch } from './commits';
import { getModelById } from './models';
import { getOrCreateManualSource } from './sources';

export interface OrderBackfillCandidate {
  elementId: UUID;
  name: string;
  order: number;
  /** No fact has ever asserted `order` for this element (that's the point of backfilling it) — always the element's own `exists_delta_id`, never a later delta. */
  previousDeltaId: UUID;
}

function compareByNameThenId(a: ElementsHeadRow, b: ElementsHeadRow): number {
  return a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id);
}

/**
 * Pure grouping/numbering step, independently testable — mirrors
 * `findSyncCandidates` (`syncDescriptionsFromMap.ts`)'s shape: matching
 * logic separated from the I/O around it.
 */
export function findOrderBackfillCandidates(capabilities: readonly ElementsHeadRow[]): OrderBackfillCandidate[] {
  const groups = new Map<UUID | null, ElementsHeadRow[]>();
  for (const capability of capabilities) {
    const list = groups.get(capability.parent_id) ?? [];
    list.push(capability);
    groups.set(capability.parent_id, list);
  }

  const candidates: OrderBackfillCandidate[] = [];
  for (const members of groups.values()) {
    let maxOrder = 0;
    const unordered: ElementsHeadRow[] = [];
    for (const member of members) {
      const order = attributesRecord(member.attributes).order;
      if (typeof order === 'number') {
        if (order > maxOrder) maxOrder = order;
      } else {
        unordered.push(member);
      }
    }
    for (const member of unordered.sort(compareByNameThenId)) {
      maxOrder += 1;
      candidates.push({ elementId: member.element_id, name: member.name, order: maxOrder, previousDeltaId: member.exists_delta_id });
    }
  }
  return candidates;
}

/** One `element.update` delta per candidate, sharing `sourceId` and confidence 1 — same shape as `buildSyncDescriptionsDeltas`. */
export function buildOrderBackfillDeltas(candidates: readonly OrderBackfillCandidate[], sourceId: UUID): Delta[] {
  return candidates.map(
    (candidate): Delta => ({
      kind: 'element.update',
      id: crypto.randomUUID(),
      elementId: candidate.elementId,
      elementType: 'capability',
      attribute: 'order',
      value: candidate.order,
      previousDeltaId: candidate.previousDeltaId,
      sourceId,
      confidence: 1,
    }),
  );
}

export interface BackfillCapabilityOrderInput {
  modelId: UUID;
  userId: UUID;
}

// `kind` is the discriminant, not `backfilled`/`commitId` directly — same
// reasoning as `SyncDescriptionsResult`'s own comment (`backfilled: 0` vs.
// `backfilled: number` don't narrow cleanly on their own).
export type BackfillCapabilityOrderResult =
  | { ok: true; kind: 'nothing-to-backfill'; message: string }
  | { ok: true; kind: 'backfilled'; backfilled: number; commitId: UUID; branchId: UUID; newHead: Head }
  | { ok: false; message: string };

/**
 * Finds and writes every missing `order` for `modelId`'s capabilities, in
 * one commit on main. `kind: 'nothing-to-backfill'` (no commit written)
 * is not an error — a model with no capabilities predating Sprint U4-1
 * C1's create-time assignment hits this every time, including any model
 * created after this sprint.
 */
export async function backfillCapabilityOrder(supabase: Client, input: BackfillCapabilityOrderInput): Promise<BackfillCapabilityOrderResult> {
  const { modelId, userId } = input;

  const model = await getModelById(supabase, modelId);
  if (!model) return { ok: false, message: `model ${modelId} does not exist` };

  const main = await getMainBranch(supabase, modelId);
  if (!main) return { ok: false, message: `model ${modelId} has no main branch` };

  const capabilities = await listCapabilitiesForMap(supabase, main.head_commit_id);
  const candidates = findOrderBackfillCandidates(capabilities);
  if (candidates.length === 0) {
    return { ok: true, kind: 'nothing-to-backfill', message: 'every capability already has an order — nothing to backfill' };
  }

  const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId: model.org_id, modelId, userId });
  const deltas = buildOrderBackfillDeltas(candidates, source.id);
  const envelope: CommitEnvelope = {
    id: crypto.randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `Backfill order for ${String(candidates.length)} capabilit${candidates.length === 1 ? 'y' : 'ies'}`,
    body: 'One-off backfill (Sprint U4-1 C1): every capability now gets an explicit order at creation; this fills it in for capabilities that predate that change.',
    deltas,
  };

  const result = await commitToBranch(supabase, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, kind: 'backfilled', backfilled: candidates.length, commitId: result.commitId, branchId: main.id, newHead: result.newHead };
}

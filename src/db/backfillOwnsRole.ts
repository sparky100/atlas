/**
 * One-off backfill (Prompt 7k item 2): `owns.primary` (boolean) is
 * replaced by `owns.role` (`'business' | 'technical' | 'service'`) for
 * cardinality purposes (C17; the `relationships_head_one_owner_per_role`
 * backstop index, `20260911070000_owns_role.sql`) — but per this sprint's
 * own SPEC §6.8 addition, "data changes are commits, never row rewrites":
 * an existing `owns` edge keeps its `primary` value exactly as recorded
 * until a real commit changes it. Nothing hand-edits `deltas` or
 * `relationships_head` directly — that would leave a future
 * `rebuildHead`/`foldFromGenesis` replay (which re-derives the projection
 * from `deltas`, not from whatever the projection currently holds) to
 * silently regenerate the old `primary`-shaped attributes and undo the
 * fix, and would also leave `commits.head_hash` (computed once, at commit
 * time, never recomputed) permanently mismatched for every downstream
 * commit — a real commit sidesteps both problems entirely, the same way
 * every other fact in this product is ever changed.
 *
 * For every live `owns` edge with no `role` yet: one `relationship.update`
 * setting `role` (`primary: true` -> `'business'`, `primary: false` ->
 * `'technical'` — `'service'` is new in this sprint and was never
 * representable by the old boolean, so no existing edge ever backfills to
 * it), and one clearing `primary` (`value: null`), both in the same
 * commit. Idempotent: an edge that already has `role` (this script
 * already ran against this model, or the edge was created after this
 * sprint shipped) is skipped — running this twice on the same model is a
 * safe no-op the second time.
 *
 * Real user session required, not service-role — same reasoning
 * `backfillCapabilityOrder.ts`'s own comment gives (`atlas.commit_deltas`
 * is `auth.uid()`-driven, ADR-015/ADR-007).
 */
import type { CommitEnvelope, Delta, OwnsRole, UUID } from '../contracts/delta';
import type { FactsRow, RelationshipsHeadRow } from '../contracts/rows';
import { attributesRecord } from '../ui/elements/attributesRecord';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { commitToBranch } from './commits';
import { listAllOwnsEdges } from './healthFindings';
import { getModelById } from './models';
import { selectAll } from './selectAll';
import { getOrCreateManualSource } from './sources';

export interface OwnsRoleBackfillCandidate {
  relationshipId: UUID;
  role: 'business' | 'technical';
  /** The edge's own creation delta — `role` has never been asserted for this relationship before (the original create's `attributes` only ever had `primary`), so there is no prior fact for that specific key to anchor an update against; the relationship's own existence is the closest real anchor, the same fallback `RelationshipCreateDemotion`'s own doc comment (`useRelationshipCreate.ts`) uses when nothing has updated an attribute since creation. */
  existsDeltaId: UUID;
  /** The delta currently asserting `primary` for this edge (from a real `facts` lookup, not assumed to be the create — an edge whose `primary` was itself updated after creation has a later delta as the current one) — the clearing update's own `previousDeltaId`. Falls back to `existsDeltaId` when no fact row is found (defensive; every live owns edge with `primary` set should have one). */
  primaryDeltaId: UUID;
}

/** `true`/`false` -> the role the old boolean meant; `'service'` is new in this sprint and was never representable by `primary`, so backfilling never produces it. */
function roleForPrimary(primary: boolean): 'business' | 'technical' {
  return primary ? 'business' : 'technical';
}

/**
 * Pure candidate-selection step, independently testable — mirrors
 * `findOrderBackfillCandidates` (`backfillCapabilityOrder.ts`)'s shape:
 * matching logic separated from the I/O around it. `primaryFactDeltaId`
 * is keyed by `relationshipId`, built from a real `facts` query
 * (`backfillOwnsRole` below) — a `Map` rather than a second parallel
 * array so a caller can pass exactly the rows a targeted query returned,
 * with no ordering assumption between it and `edges`.
 */
export function findOwnsRoleBackfillCandidates(
  edges: readonly RelationshipsHeadRow[],
  primaryFactDeltaId: ReadonlyMap<UUID, UUID>,
): OwnsRoleBackfillCandidate[] {
  const candidates: OwnsRoleBackfillCandidate[] = [];
  for (const edge of edges) {
    const attrs = attributesRecord(edge.attributes);
    if (typeof attrs.role === 'string') continue; // already migrated — idempotent skip.
    if (typeof attrs.primary !== 'boolean') continue; // no primary to migrate from either (shouldn't happen for real owns data, but nothing to do here).
    candidates.push({
      relationshipId: edge.relationship_id,
      role: roleForPrimary(attrs.primary),
      existsDeltaId: edge.exists_delta_id,
      primaryDeltaId: primaryFactDeltaId.get(edge.relationship_id) ?? edge.exists_delta_id,
    });
  }
  return candidates;
}

/** Two `relationship.update` deltas per candidate (set `role`, clear `primary`), sharing `sourceId` and confidence 1 — same shape as `buildOrderBackfillDeltas`. */
export function buildOwnsRoleBackfillDeltas(candidates: readonly OwnsRoleBackfillCandidate[], sourceId: UUID): Delta[] {
  const deltas: Delta[] = [];
  for (const candidate of candidates) {
    deltas.push({
      kind: 'relationship.update',
      id: crypto.randomUUID(),
      relationshipId: candidate.relationshipId,
      relationshipType: 'owns',
      attribute: 'role',
      value: candidate.role satisfies OwnsRole,
      previousDeltaId: candidate.existsDeltaId,
      sourceId,
      confidence: 1,
    });
    deltas.push({
      kind: 'relationship.update',
      id: crypto.randomUUID(),
      relationshipId: candidate.relationshipId,
      relationshipType: 'owns',
      attribute: 'primary',
      value: null,
      previousDeltaId: candidate.primaryDeltaId,
      sourceId,
      confidence: 1,
    });
  }
  return deltas;
}

export interface BackfillOwnsRoleInput {
  modelId: UUID;
  userId: UUID;
}

export type BackfillOwnsRoleResult =
  | { ok: true; kind: 'nothing-to-backfill'; message: string }
  | { ok: true; kind: 'backfilled'; backfilled: number; commitId: UUID; candidates: OwnsRoleBackfillCandidate[] }
  | { ok: false; message: string };

/**
 * Finds and writes `role` for every `owns` edge in `modelId` still only
 * carrying `primary`, in one commit on main. `kind: 'nothing-to-backfill'`
 * (no commit written) is not an error — a model with no legacy `owns`
 * edges (created after this sprint, or with none at all) hits this every
 * time, same as `backfillCapabilityOrder`'s own equivalent case.
 */
export async function backfillOwnsRole(supabase: Client, input: BackfillOwnsRoleInput): Promise<BackfillOwnsRoleResult> {
  const { modelId, userId } = input;

  const model = await getModelById(supabase, modelId);
  if (!model) return { ok: false, message: `model ${modelId} does not exist` };

  const main = await getMainBranch(supabase, modelId);
  if (!main) return { ok: false, message: `model ${modelId} has no main branch` };

  const edges = await listAllOwnsEdges(supabase, main.head_commit_id);

  // The delta currently asserting `primary` for each edge — a real facts
  // lookup, not assumed to be the edge's own create (an edge whose
  // `primary` was itself updated after creation has a later delta as the
  // current one). Filtered by `attribute` (a fixed value, not a
  // caller-supplied list that grows with the model — CLAUDE.md rule 8
  // doesn't apply here the way an `.in()` on relationship ids would).
  // .eq('commit_id', ...).eq('attribute', 'primary') leaves subject_id
  // unique within this scope (facts' own primary key is (commit_id,
  // subject_id, attribute)) — a real order for selectAll's own pagination
  // requirement (SPEC §6.7), same shape listFactsForCommit (healthFindings.ts)
  // already uses.
  const primaryFactsQuery = supabase.from('facts').select('subject_id, delta_id', { count: 'exact' }).eq('commit_id', main.head_commit_id).eq('attribute', 'primary').order('subject_id');
  const primaryFacts = await selectAll<Pick<FactsRow, 'subject_id' | 'delta_id'>>(primaryFactsQuery);
  const primaryFactDeltaId = new Map<UUID, UUID>(primaryFacts.map((f) => [f.subject_id, f.delta_id]));

  const candidates = findOwnsRoleBackfillCandidates(edges, primaryFactDeltaId);
  if (candidates.length === 0) {
    return { ok: true, kind: 'nothing-to-backfill', message: 'every owns edge already has a role — nothing to backfill' };
  }

  const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId: model.org_id, modelId, userId });
  const deltas = buildOwnsRoleBackfillDeltas(candidates, source.id);
  const envelope: CommitEnvelope = {
    id: crypto.randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `Owner roles introduced — backfill role for ${String(candidates.length)} owns edge${candidates.length === 1 ? '' : 's'}`,
    body: 'One-off backfill (Prompt 7k item 2): owns.primary is replaced by owns.role; this sets role from each existing edge’s primary value and clears primary.',
    deltas,
  };

  const result = await commitToBranch(supabase, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, kind: 'backfilled', backfilled: candidates.length, commitId: result.commitId, candidates };
}

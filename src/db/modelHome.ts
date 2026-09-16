/**
 * Data queries for the two front doors (UI-principles §3). The director
 * door's Lifecycle Exposure rule (§3.1, `computeExposureTone`/
 * `loadPlannedReplacements`) and its "commits since previous tag" stamp
 * (`loadCommitDepths`) are built in full — see Handoff 7d
 * (`docs/HANDOFF-7d-director-door.md`). Still not built: §3.1's Coverage/
 * Staleness/Confidence toggles and the director's branch-scoped to-be
 * zoom, or the architect door's full three-column dashboard (validation
 * status per queue item, "behind main by N commits", mentions floating to
 * the top). Those stay real gaps, not faked — see each component's own
 * comment for exactly what's deferred and why.
 */
import type { UUID } from '../contracts/delta';
import type { CommitRow, DeltaRow, ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import { attributesRecord } from '../ui/elements/attributesRecord';
import { computeCapabilityRollup } from '../ui/capabilityMap/capabilityRollup';
import type { Client } from './client';
import { assertInFilterSize } from './inFilterLimit';
import { selectAll } from './selectAll';

/** A bare `commits` row projection, `id`/`depth` only — named (not an inline `selectAll<{...}>` literal) because a multi-field inline object-type generic's own `;` field separators confuse `headTableReads.test.ts`'s text-level statement scanner (SPEC §6.7's checker), which is a real limitation of that checker, not a reason to skip pagination. */
interface CommitIdRow {
  id: UUID;
}

interface CommitDepthRow {
  id: UUID;
  depth: number;
}

interface CommitBranchRow {
  id: UUID;
  branch_id: UUID;
}

interface DeltaSubjectRow {
  commit_id: UUID;
  subject_id: UUID;
}

export interface ModelCounts {
  capabilities: number;
  systems: number;
  openChanges: number;
}

/**
 * The director door's three headline counts. `openChanges` counts change
 * branches with a status that means "still in motion" — `draft` through
 * `approved`, matching UI-principles §3.1's "changes in flight" list
 * (`proposed | in_review | approved`) plus `draft` (not yet proposed, but
 * still an open piece of work, not a strange omission from a count that's
 * meant to answer "how much is happening right now").
 */
export async function loadModelCounts(supabase: Client, commitId: UUID, modelId: UUID): Promise<ModelCounts> {
  const [capabilitiesResult, systemsResult, changesResult] = await Promise.all([
    supabase.from('elements_head').select('element_id', { count: 'exact', head: true }).eq('commit_id', commitId).eq('element_type', 'capability'),
    supabase.from('elements_head').select('element_id', { count: 'exact', head: true }).eq('commit_id', commitId).eq('element_type', 'system'),
    supabase.from('branches').select('id', { count: 'exact', head: true }).eq('model_id', modelId).eq('kind', 'change').in('status', ['draft', 'proposed', 'in_review', 'approved']),
  ]);
  if (capabilitiesResult.error) throw new Error(`loadModelCounts: ${capabilitiesResult.error.message}`);
  if (systemsResult.error) throw new Error(`loadModelCounts: ${systemsResult.error.message}`);
  if (changesResult.error) throw new Error(`loadModelCounts: ${changesResult.error.message}`);
  return {
    capabilities: capabilitiesResult.count ?? 0,
    systems: systemsResult.count ?? 0,
    openChanges: changesResult.count ?? 0,
  };
}

/**
 * The most recent commits on `main` (architect door's "recent commits") —
 * newest first, capped at `limit`. A plain `.limit()` query, not
 * `selectAll` (SPEC §6.7's ceiling exists to stop a caller-scoped `.in()`
 * from growing with the model; this is a caller-chosen top-N with its own
 * fixed bound, the same shape `listOpenMergeRequestsForModel` and
 * `listTagsForModel` already use for a bounded "recent things" list).
 */
export async function listRecentCommits(supabase: Client, mainBranchId: UUID, limit = 10): Promise<CommitRow[]> {
  const { data, error } = await supabase.from('commits').select('*').eq('branch_id', mainBranchId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`listRecentCommits: ${error.message}`);
  return data as CommitRow[];
}

/**
 * Every delta of the given commits (Sprint U4-1 B2's activity row: which
 * elements a commit's own deltas name, via `describeEnvelope.ts`'s
 * `envelopeSubjects`, for "named subjects link to their pages"). Bounded by
 * `listRecentCommits`'s own fixed `limit`, not by model size — same shape
 * `loadCommitDepths`/`loadChangeTouchCounts` above already use for a
 * caller-scoped, fixed-size id list.
 */
export async function listDeltasForCommits(supabase: Client, commitIds: readonly UUID[]): Promise<DeltaRow[]> {
  if (commitIds.length === 0) return [];
  assertInFilterSize('listDeltasForCommits', 'commit_id', commitIds);
  const query = supabase.from('deltas').select('*', { count: 'exact' }).in('commit_id', commitIds as UUID[]).order('commit_id').order('seq');
  return selectAll<DeltaRow>(query);
}

export type ExposureTone = 'ok' | 'warn' | 'info';

/**
 * UI-principles §3.1's full Lifecycle Exposure rule, evaluated per
 * capability (Handoff 7d): `warn` when a supporting system is `retiring`/
 * `retired` and nothing planned replaces it; `info` ("replacement
 * planned") when every exposed supporting system does have one; `ok` when
 * nothing is exposed at all. `warn` wins over `info` when a capability has
 * more than one exposed system and only some of them have a planned
 * replacement — the same "never falsely calm" direction the original,
 * coarser U3b version of this function already committed to.
 *
 * `plannedReplacementSystemIds` is the set of this capability's own
 * exposed system ids that `loadPlannedReplacements` found a match for —
 * callers scope both `supportsEdges` and this set to one capability before
 * calling (see `useDirectorHome.ts`), so this function stays a pure,
 * capability-agnostic predicate over whatever it's handed, same shape as
 * before this rule existed.
 */
export function computeExposureTone(
  supportsEdges: readonly RelationshipsHeadRow[],
  /** Bug fix: despite the name, this must also carry any *container* that can appear as a `supports` edge's own `from_element_id` — a platform's own module supports a capability directly too (S1 item 20). An edge whose supporter isn't in this map is silently skipped, so a container-only supporter used to vanish here entirely (see `useDirectorHome.ts`'s own caller-side fix). */
  systemsById: ReadonlyMap<UUID, ElementsHeadRow>,
  plannedReplacementSystemIds: ReadonlySet<UUID> = new Set(),
): ExposureTone {
  let anyExposed = false;
  let anyExposedWithoutReplacement = false;
  for (const edge of supportsEdges) {
    const system = systemsById.get(edge.from_element_id);
    if (!system) continue;
    const lifecycleStatus = attributesRecord(system.attributes).lifecycleStatus;
    if (lifecycleStatus === 'retiring' || lifecycleStatus === 'retired') {
      anyExposed = true;
      if (!plannedReplacementSystemIds.has(system.element_id)) anyExposedWithoutReplacement = true;
    }
  }
  if (anyExposedWithoutReplacement) return 'warn';
  if (anyExposed) return 'info';
  return 'ok';
}

/** One `(capabilityId, exposedSystemId)` pair `loadPlannedReplacements` found evidence for — an `approved` change branch that both adds a new system supporting `capabilityId` and retracts `exposedSystemId`, within that branch's own delta history. */
export interface PlannedReplacement {
  capabilityId: UUID;
  exposedSystemId: UUID;
  replacementSystemId: UUID;
  branchId: UUID;
}

/**
 * UI-principles §3.1's "planned replacement" evidence: for every `approved`
 * change branch on this model (in delivery — merging is what marks a
 * change delivered, ADR-006), read that branch's *own* deltas (never
 * main's — a branch's own commits only, via `commits.branch_id`) and look
 * for a system it both creates and wires up to support a capability, where
 * the same branch also retracts some other system. That's the strongest
 * pairing signal the data model has: an `element.retract` delta carries no
 * explicit "this is what replaces it" reference of its own (SPEC §4), so
 * "same branch, same capability" is the evidence, not a stronger per-delta
 * link — documented coarseness, same spirit as `computeExposureTone`'s own
 * history of being coarse in the direction that never falsely calms a
 * capability that's still genuinely exposed (a branch's retraction and its
 * new supporting system don't have to be causally connected for this to
 * record a candidate; `computeExposureTone` only ever consults an entry
 * for a system that is *itself* a real, current supporter of that exact
 * capability, which is what keeps false positives narrow in practice).
 *
 * Bounded by the number of `approved` branches on one model at a time
 * (rare and short-lived by construction — SPEC §7.4's review flow), not by
 * model size, so the `.in('commit_id', ...)` list itself never risks
 * rule 8's URL-length hazard — but the `deltas`/`commits` reads still go
 * through `selectAll` regardless, since `max_rows` truncation (SPEC §6.7)
 * is a per-query-result-size risk independent of how the filter list was
 * built: even one branch can, in principle, carry more than `max_rows`
 * deltas.
 */
export async function loadPlannedReplacements(supabase: Client, modelId: UUID): Promise<PlannedReplacement[]> {
  const { data: branchRows, error: branchesError } = await supabase.from('branches').select('id').eq('model_id', modelId).eq('kind', 'change').eq('status', 'approved');
  if (branchesError) throw new Error(`loadPlannedReplacements: ${branchesError.message}`);
  const branches = branchRows as { id: UUID }[];
  if (branches.length === 0) return [];

  const replacements: PlannedReplacement[] = [];
  for (const branch of branches) {
    const commitRows = await selectAll<CommitIdRow>(supabase.from('commits').select('id', { count: 'exact' }).eq('branch_id', branch.id).order('id'));
    const commitIds = commitRows.map((c) => c.id);
    if (commitIds.length === 0) continue;
    assertInFilterSize('loadPlannedReplacements', 'commit_id', commitIds);

    const deltas = await selectAll<DeltaRow>(supabase.from('deltas').select('*', { count: 'exact' }).in('commit_id', commitIds).order('id'));

    const createdSystemIds = new Set(deltas.filter((d) => d.kind === 'element_create' && d.element_type === 'system').map((d) => d.subject_id));
    const retractedSystemIds = new Set(deltas.filter((d) => d.kind === 'element_retract' && d.element_type === 'system').map((d) => d.subject_id));
    if (retractedSystemIds.size === 0) continue;

    for (const delta of deltas) {
      if (delta.kind !== 'relationship_create' || delta.relationship_type !== 'supports') continue;
      const replacementSystemId = delta.from_element_id;
      const capabilityId = delta.to_element_id;
      if (!replacementSystemId || !capabilityId || !createdSystemIds.has(replacementSystemId)) continue;
      for (const exposedSystemId of retractedSystemIds) {
        replacements.push({ capabilityId, exposedSystemId, replacementSystemId, branchId: branch.id });
      }
    }
  }
  return replacements;
}

/**
 * One capability tile's worth of Handoff 7d's "Where are we weak" grid —
 * everything a tile needs to render, already resolved. `tone` is
 * `'neutral'` for a capability with zero supporting systems ("nothing
 * recorded", §3.1's Coverage gap, distinct from Lifecycle Exposure —
 * `computeExposureTone` is never called for that case, since it has
 * nothing to evaluate).
 *
 * Capability rollup (Sprint U4-2, "capability rollup", decided):
 * `supportingSystems`/`exposedSystems`/`tone` are all rolled up over the
 * capability's own subtree (itself plus every descendant), not just its
 * direct `supports` edges — see `buildCapabilityTiles`'s own comment.
 * `supportedCapabilityCount`/`totalCapabilityCount`/`isOwned` are the same
 * shared rollup's own fraction/owner fields, exposed here so the director
 * door's tile can show them the same way the capability map and
 * capability-scoped landscape do.
 */
export interface CapabilityTileData {
  capability: ElementsHeadRow;
  supportingSystems: ElementsHeadRow[];
  /** The subset of `supportingSystems` that's `retiring`/`retired` — empty unless `tone` is `warn` or `info`. */
  exposedSystems: ElementsHeadRow[];
  tone: ExposureTone | 'neutral';
  /** `src/ui/capabilityMap/capabilityRollup.ts`'s own `supportedCapabilityCount` — the "N/M supported" fraction's numerator across this level-1 capability's subtree. */
  supportedCapabilityCount: number;
  /** Same rollup's `totalCapabilityCount` — the fraction's denominator. */
  totalCapabilityCount: number;
  /** Same rollup's `isOwned` — this capability or any ancestor has an owner. */
  isOwned: boolean;
}

/**
 * Groups every level-1 capability with its own supporting systems and
 * resolves each one's tile tone — the pure core of the director door's
 * weakness grid, unit-testable without a database. `plannedReplacements`
 * is the whole model's list from `loadPlannedReplacements`; this function
 * does the per-capability filtering `computeExposureTone` itself expects
 * its caller to have already done.
 *
 * Capability rollup: `supportingSystems`/`exposedSystems`/the tone
 * computed from them are now rolled up across each level-1 capability's
 * own subtree (via `computeCapabilityRollup`, the same shared function the
 * capability map and capability-scoped landscape call), not just its
 * direct `supports` edges — a supporting system on an L2/L3 descendant
 * used to be invisible here even though the same edge already counted on
 * the capability map's own aggregate Chip. `computeExposureTone` itself is
 * untouched (this decision's own "exposure/lifecycle tone stay
 * worst-of-children, already built") — only the edge scope handed to it
 * widens, from the capability's own direct edges to its whole subtree's.
 */
/**
 * `PlannedReplacement[]` grouped by `capabilityId` — every exposed system
 * id it names a replacement candidate for, keyed by the capability that
 * candidate is evidence for. Extracted here once a second caller
 * (`src/db/healthFindings.ts`'s `findCapabilitiesWithPoorFitPrimarySupporter`)
 * needed the exact same "no planned replacement for this exposed system"
 * lookup `buildCapabilityTiles` already built inline for
 * `computeExposureTone`.
 */
export function groupPlannedReplacementsByCapability(plannedReplacements: readonly PlannedReplacement[]): Map<UUID, Set<UUID>> {
  const result = new Map<UUID, Set<UUID>>();
  for (const replacement of plannedReplacements) {
    const set = result.get(replacement.capabilityId) ?? new Set<UUID>();
    set.add(replacement.exposedSystemId);
    result.set(replacement.capabilityId, set);
  }
  return result;
}

export function buildCapabilityTiles(
  level1Capabilities: readonly ElementsHeadRow[],
  /** Every capability at this ref, every level — `computeCapabilityRollup`'s own subtree-walk input. */
  allCapabilities: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  /** Same "systems and container-supporters both" map `computeExposureTone` expects — see that function's own doc comment. */
  systemsById: ReadonlyMap<UUID, ElementsHeadRow>,
  plannedReplacements: readonly PlannedReplacement[],
  /** `src/db/healthFindings.ts`'s `computeSelfOwnedCapabilityIds` result — the rollup's own owner-coverage input. */
  selfOwnedIds: ReadonlySet<UUID>,
): CapabilityTileData[] {
  const capabilitiesById = new Map(allCapabilities.map((c) => [c.element_id, c]));
  const replacementsByCapability = groupPlannedReplacementsByCapability(plannedReplacements);

  return level1Capabilities.map((capability): CapabilityTileData => {
    const rollup = computeCapabilityRollup(capability, allCapabilities, capabilitiesById, supportsEdges, selfOwnedIds);
    const supportingSystems: ElementsHeadRow[] = [];
    for (const id of rollup.supportingSystemIds) {
      const system = systemsById.get(id);
      if (system) supportingSystems.push(system);
    }
    const exposedSystems = supportingSystems.filter((system) => {
      const lifecycleStatus = attributesRecord(system.attributes).lifecycleStatus;
      return lifecycleStatus === 'retiring' || lifecycleStatus === 'retired';
    });
    const tone: ExposureTone | 'neutral' =
      supportingSystems.length === 0 ? 'neutral' : computeExposureTone(rollup.subtreeSupportsEdges, systemsById, replacementsByCapability.get(capability.element_id) ?? new Set());
    return {
      capability,
      supportingSystems,
      exposedSystems,
      tone,
      supportedCapabilityCount: rollup.supportedCapabilityCount,
      totalCapabilityCount: rollup.totalCapabilityCount,
      isOwned: rollup.isOwned,
    };
  });
}

/**
 * Commits-since-previous-tag (Handoff 7d): the difference between two
 * commits' own `depth` (SPEC §3.4 — a monotonic count of a commit's
 * ancestry length on `main`, already stored, no diff walk needed). Callers
 * pass the newer tag's commit first. `null` when there is no previous tag
 * to compare against (the oldest tag on the model) — the pure half of the
 * stamp, so it's unit-testable without a database.
 */
export function commitsSincePreviousTag(newerDepth: number, olderDepth: number | null): number | null {
  return olderDepth === null ? null : newerDepth - olderDepth;
}

export async function loadCommitDepths(supabase: Client, commitIds: readonly UUID[]): Promise<Map<UUID, number>> {
  if (commitIds.length === 0) return new Map();
  assertInFilterSize('loadCommitDepths', 'id', commitIds);
  const rows = await selectAll<CommitDepthRow>(supabase.from('commits').select('id, depth', { count: 'exact' }).in('id', commitIds as UUID[]).order('id'));
  return new Map(rows.map((row) => [row.id, row.depth]));
}

/** All `supports` edges at `commitId`, regardless of which capability — used once by the thumbnail to compute both the exposure tone and (paired with `capabilities`) the tile list, rather than the per-capability-id `.in()` shape `listSupportsEdgesForCapabilities` needs for the full map view. */
export async function listAllSupportsEdges(supabase: Client, commitId: UUID): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select('relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id', { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('relationship_type', 'supports')
    .order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}

/**
 * Handoff 7d's "Touches" column: the count of distinct subjects (elements
 * or relationships) each branch's own deltas touch — a cheap count, not
 * the change page's own full `affectedCapabilities` resolution
 * (`src/db/changeSummary.ts`, which folds the branch's as-is/to-be heads
 * and is too expensive to run once per row in a list of many open
 * changes). Bounded the same way `loadPlannedReplacements` is: by how many
 * branches the caller passes and each one's own commit/delta count, not by
 * model size.
 */
export async function loadChangeTouchCounts(supabase: Client, branchIds: readonly UUID[]): Promise<Map<UUID, number>> {
  if (branchIds.length === 0) return new Map();
  assertInFilterSize('loadChangeTouchCounts', 'branch_id', branchIds);
  const commits = await selectAll<CommitBranchRow>(supabase.from('commits').select('id, branch_id', { count: 'exact' }).in('branch_id', branchIds as UUID[]).order('id'));
  if (commits.length === 0) return new Map();
  const branchIdByCommitId = new Map(commits.map((c) => [c.id, c.branch_id]));
  const commitIds = commits.map((c) => c.id);
  assertInFilterSize('loadChangeTouchCounts', 'commit_id', commitIds);

  const deltas = await selectAll<DeltaSubjectRow>(supabase.from('deltas').select('commit_id, subject_id', { count: 'exact' }).in('commit_id', commitIds).order('id'));

  const subjectsByBranch = new Map<UUID, Set<UUID>>();
  for (const delta of deltas) {
    const branchId = branchIdByCommitId.get(delta.commit_id);
    if (!branchId) continue;
    const subjects = subjectsByBranch.get(branchId) ?? new Set<UUID>();
    subjects.add(delta.subject_id);
    subjectsByBranch.set(branchId, subjects);
  }
  return new Map([...subjectsByBranch.entries()].map(([branchId, subjects]) => [branchId, subjects.size]));
}

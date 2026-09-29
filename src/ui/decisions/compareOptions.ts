import type { Criticality, FitForPurpose, LifecycleStatus, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { Client } from '../../db/client';
import { findBoundaryCrossings, computeSelfOwnedCapabilityIds } from '../../db/healthFindings';
import { buildCapabilityTiles, loadPlannedReplacements, type PlannedReplacement } from '../../db/modelHome';
import type { Head } from '../../engine/deltas';
import { serializeHeadProjection } from '../../engine/projection';
import { computeVersionDiff } from '../../engine/versionDiff';
import { oldestLifecycleStage, supportingSystemIds, worstCriticality, worstFitForPurpose } from '../capabilityMap/metrics';
import { valueStreamsReachedFrom } from '../valueStreams/impactTraversal';
import { computeStageRollup, computeStreamRollup, stagesOf, type ValueStreamTone } from '../valueStreams/valueStreamRollup';
import { loadHeadAtCommitCached } from '../query/cachedBranchProjection';
import { computeAlsoAffected, type AlsoAffectedElement } from './alsoAffected';
import { summarizeOptionChanges } from './optionChangeSummary';
import { buildWhatChangesRows, type WhatChangesOptionInput, type WhatChangesRow } from './whatChangesRows';

export interface CapabilityComparisonMetrics {
  coverage: number;
  oldestLifecycleStage: LifecycleStatus | null;
  criticality: Criticality | null;
  /** ADR-023's own fit-in-tone rule ("shown as text next to the tone, never folded into the tone") applies here too — this is the EXISTING `worstFitForPurpose` roll-up, re-run against this row's own `supportsEdges` exactly like coverage/criticality above, never a second calculation. */
  fit: FitForPurpose | null;
}

/** F6 (ADR-023): one row of the comparison table's own "Affected value streams" — the stream reached from the decision's own capabilities at this option's projection, and its real rollup tone there (the same tone the Value streams page itself would show for that stream at that commit — not scoped to only the decision's own capabilities, since a stream's tone is a fact about the whole stream). */
export interface ValueStreamComparisonRow {
  stream: ElementsHeadRow;
  tone: ValueStreamTone;
}

export interface OptionComparisonRow {
  /** `null` for the "Current (main)" baseline row every option is compared against — a real option is always a branch. */
  branchId: UUID | null;
  label: string;
  metricsByCapabilityId: Map<UUID, CapabilityComparisonMetrics>;
  /** Model-wide, never per-capability — `findBoundaryCrossings`' own shape (a `uses`/`flows_to` edge, not a capability fact). F1's own "cost" column has no data source yet and is absent here, not a blank cell (CLAUDE.md rule 7). */
  boundaryCrossingCount: number;
  affectedValueStreams: ValueStreamComparisonRow[];
}

/** The raw, per-row data `computeComparisonRow` builds along the way to its own `OptionComparisonRow` — kept around (rather than discarded once the row's own numbers are computed) because Part B's "What changes" table and "Also affected" section both need the underlying projection and delta, not just the summarised metrics. `head` is the engine's own folded `Head` (Map-based), the input `computeVersionDiff` needs — `elementsById`/`relationshipsHead` are its already-serialised row-shaped twin (`engine/projection.ts`'s `serializeHeadProjection`), which every other function in this file already reads. */
interface ComparisonRowRaw {
  head: Head;
  elementsById: Map<UUID, ElementsHeadRow>;
  relationshipsHead: RelationshipsHeadRow[];
  supportsEdges: RelationshipsHeadRow[];
  ownsEdges: RelationshipsHeadRow[];
}

/**
 * F3's own comparison table (PR5) — genuinely new orchestration, not a new
 * algorithm: each row folds one commit in memory via
 * `cachedBranchProjection.ts`'s `loadHeadAtCommitCached` (the same cached
 * in-memory fold `useLandscape.ts`/`useElementPage.ts` already use for a
 * branch ref), then re-runs `src/ui/capabilityMap/metrics.ts`'s own
 * functions and `findBoundaryCrossings` against that projected state — the
 * exact same functions every other capability-map/health-finding surface
 * already uses against the *live* head, just pointed at a different
 * commit. The `main` row and every option row go through this identical
 * path, so nothing here special-cases "the baseline" versus "an option" —
 * a real, if minor, inefficiency (the `main` row could read
 * `elements_head`/`relationships_head` directly instead of folding), left
 * as-is rather than special-cased here: E8 item (2) is about caching the
 * fold this comparison already does, not changing which rows fold.
 */
async function computeComparisonRow(
  supabase: Client,
  modelId: UUID,
  commitId: UUID,
  capabilityIds: readonly UUID[],
  branchId: UUID | null,
  label: string,
  plannedReplacements: readonly PlannedReplacement[],
): Promise<{ row: OptionComparisonRow; raw: ComparisonRowRaw }> {
  // `loadHeadAtCommitCached` (not `loadProjectionAtCommitCached`, which
  // just wraps this call and re-serialises) — Part B needs the folded
  // `Head` itself for `computeVersionDiff`, so this reads it once and
  // serialises locally rather than fetching the identical cached value
  // twice under two different function names.
  const head = await loadHeadAtCommitCached(supabase, modelId, commitId);
  const projection = serializeHeadProjection(head);
  const elementsById = new Map(projection.elementsHead.map((e) => [e.element_id, e]));
  const supportsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'supports');
  const ownsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'owns');

  const metricsByCapabilityId = new Map<UUID, CapabilityComparisonMetrics>();
  for (const capabilityId of capabilityIds) {
    metricsByCapabilityId.set(capabilityId, {
      coverage: supportingSystemIds(capabilityId, supportsEdges).length,
      oldestLifecycleStage: oldestLifecycleStage(capabilityId, supportsEdges, elementsById),
      criticality: worstCriticality(capabilityId, supportsEdges, elementsById),
      fit: worstFitForPurpose(capabilityId, supportsEdges),
    });
  }

  const boundaryCrossingCount = findBoundaryCrossings(projection.relationshipsHead, elementsById).length;

  // F6 (ADR-023): the impact hop's own extension of this row — same
  // functions the Value streams page/rollup use, re-run against this
  // option's own projection, the same "re-run the real functions at a
  // different commit" shape this file's own module comment already
  // describes for coverage/criticality/boundary crossings above.
  const enablesEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'enables');
  const affected = valueStreamsReachedFrom(capabilityIds, elementsById, enablesEdges);
  const affectedValueStreams: ValueStreamComparisonRow[] = [];
  if (affected.length > 0) {
    const allCapabilities = projection.elementsHead.filter((e) => e.element_type === 'capability');
    const allValueStreams = projection.elementsHead.filter((e) => e.element_type === 'value_stream');
    const systemsById = new Map(projection.elementsHead.filter((e) => e.element_type === 'system' || e.element_type === 'container').map((e) => [e.element_id, e]));
    const selfOwnedIds = computeSelfOwnedCapabilityIds(allCapabilities, supportsEdges, ownsEdges);
    // Every capability that enables *any* stage in this projection — the
    // set `computeStageRollup` actually needs tiles for, not every
    // capability in the model (`buildCapabilityTiles` is already generic
    // over which capabilities it's handed, ADR-023's own note).
    const enablingCapabilityIds = new Set(enablesEdges.map((edge) => edge.from_element_id));
    const enablingCapabilities = allCapabilities.filter((c) => enablingCapabilityIds.has(c.element_id));
    const tiles = buildCapabilityTiles(enablingCapabilities, allCapabilities, supportsEdges, systemsById, plannedReplacements, selfOwnedIds);
    const tilesByCapabilityId = new Map(tiles.map((tile) => [tile.capability.element_id, tile]));

    for (const { stream } of affected) {
      // The stream's *own* full rollup — every stage it has, not just the
      // ones this decision's capabilities happen to reach — since a
      // stream's tone is a fact about the whole stream.
      const stageRollups = stagesOf(stream, allValueStreams).map((stage) => computeStageRollup(stage, enablesEdges, tilesByCapabilityId));
      affectedValueStreams.push({ stream, tone: computeStreamRollup(stream, stageRollups).tone });
    }
  }

  const row: OptionComparisonRow = { branchId, label, metricsByCapabilityId, boundaryCrossingCount, affectedValueStreams };
  return { row, raw: { head, elementsById, relationshipsHead: projection.relationshipsHead, supportsEdges, ownsEdges } };
}

export interface CompareDecisionOptionsInput {
  modelId: UUID;
  mainHeadCommitId: UUID;
  /** The decision's own `linked_type: 'element'` links, filtered to capabilities — the columns `metricsByCapabilityId`/`affectedValueStreams` actually vary over. */
  capabilityIds: readonly UUID[];
  /** The decision's own `linked_type: 'element'` links, filtered to systems/containers — Part B's own "system/container concern" rows (unchanged/retired/replaced by X), which have no `metricsByCapabilityId` equivalent (a system has no `supports` edges targeting *it*). */
  otherConcernElementIds: readonly UUID[];
  options: readonly { branchId: UUID; headCommitId: UUID; label: string }[];
}

export interface CompareDecisionOptionsResult {
  main: OptionComparisonRow;
  options: OptionComparisonRow[];
  /** Part B's "What changes" table rows — already collapsed-vs-main comparison logic, `DecisionView.tsx` only renders these. */
  whatChangesRows: WhatChangesRow[];
  /** Part B's "Also affected" section, per option. */
  alsoAffectedByBranchId: Map<UUID, AlsoAffectedElement[]>;
  /** Part B's per-option one-line derived summary ("Retires PM, adds Hana equivalent, re-points 4 flows") — `null` for an empty-delta option (the caller renders "No changes recorded yet" instead). */
  optionSummaries: Map<UUID, string | null>;
}

/** Every option row, plus the `main` baseline row everything is implicitly diffed against (the comparison table itself renders the delta; this just returns each row's own absolute numbers), plus Part B's own derived comparison data (What-changes rows, Also-affected, and each option's one-line summary) — all pure functions run once here, over data this function has already fetched, never recomputed by a component. */
export async function compareDecisionOptions(supabase: Client, input: CompareDecisionOptionsInput): Promise<CompareDecisionOptionsResult> {
  const { modelId, mainHeadCommitId, capabilityIds, otherConcernElementIds, options } = input;
  // Model-wide (currently-approved branches), not commit-scoped — the same
  // external fact every row's own rollup tone reads regardless of which
  // option's projection it's otherwise looking at, so fetched once here
  // rather than once per row.
  const plannedReplacements = await loadPlannedReplacements(supabase, modelId);
  const mainResult = await computeComparisonRow(supabase, modelId, mainHeadCommitId, capabilityIds, null, 'Current (main)', plannedReplacements);
  // `branchId` is captured directly from this option's own input row (a
  // real `UUID`, never `null`) rather than read back off the computed
  // result — `computeComparisonRow`'s return type is shared with the
  // `null`-branchId main row above, so reading `.row.branchId` back would
  // widen to `UUID | null` even here, where it's always real.
  const optionComputations = await Promise.all(
    options.map(async (o) => ({ branchId: o.branchId, ...(await computeComparisonRow(supabase, modelId, o.headCommitId, capabilityIds, o.branchId, o.label, plannedReplacements)) })),
  );

  const concernCapabilities = capabilityIds.map((id) => mainResult.raw.elementsById.get(id)).filter((e): e is ElementsHeadRow => e !== undefined);
  const concernSystemsOrContainers = otherConcernElementIds.map((id) => mainResult.raw.elementsById.get(id)).filter((e): e is ElementsHeadRow => e !== undefined);
  const concernElementIdSet = new Set<UUID>([...capabilityIds, ...otherConcernElementIds]);

  const optionsForWhatChanges: WhatChangesOptionInput[] = optionComputations.map((c) => ({
    branchId: c.branchId,
    row: c.row,
    elementsById: c.raw.elementsById,
    relationshipsHead: c.raw.relationshipsHead,
    supportsEdges: c.raw.supportsEdges,
    diff: computeVersionDiff(mainResult.raw.head, c.raw.head),
  }));

  const whatChangesRows = buildWhatChangesRows({
    concernCapabilities,
    concernSystemsOrContainers,
    main: { row: mainResult.row, elementsById: mainResult.raw.elementsById, relationshipsHead: mainResult.raw.relationshipsHead, supportsEdges: mainResult.raw.supportsEdges },
    options: optionsForWhatChanges,
  });

  const alsoAffectedByBranchId = new Map<UUID, AlsoAffectedElement[]>();
  const optionSummaries = new Map<UUID, string | null>();
  for (let i = 0; i < optionComputations.length; i += 1) {
    const c = optionComputations[i];
    const optionInput = optionsForWhatChanges[i];
    if (!c || !optionInput) continue;
    // A retired element only resolves on main's own side, a newly added one
    // only on this option's — merged with the option's own entries taking
    // precedence (its own attributes/name as of this option, where both
    // sides happen to have the id at all).
    const mergedElementsById = new Map<UUID, ElementsHeadRow>([...mainResult.raw.elementsById, ...c.raw.elementsById]);
    alsoAffectedByBranchId.set(c.branchId, computeAlsoAffected(optionInput.diff, concernElementIdSet, c.raw.ownsEdges, mergedElementsById));
    optionSummaries.set(c.branchId, summarizeOptionChanges(optionInput.diff));
  }

  return {
    main: mainResult.row,
    options: optionComputations.map((c) => c.row),
    whatChangesRows,
    alsoAffectedByBranchId,
    optionSummaries,
  };
}

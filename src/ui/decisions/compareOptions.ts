import type { Criticality, LifecycleStatus, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { Client } from '../../db/client';
import { findBoundaryCrossings, computeSelfOwnedCapabilityIds } from '../../db/healthFindings';
import { buildCapabilityTiles, loadPlannedReplacements, type PlannedReplacement } from '../../db/modelHome';
import { oldestLifecycleStage, supportingSystemIds, worstCriticality } from '../capabilityMap/metrics';
import { valueStreamsReachedFrom } from '../valueStreams/impactTraversal';
import { computeStageRollup, computeStreamRollup, stagesOf, type ValueStreamTone } from '../valueStreams/valueStreamRollup';
import { loadProjectionAtCommitCached } from '../query/cachedBranchProjection';

export interface CapabilityComparisonMetrics {
  coverage: number;
  oldestLifecycleStage: LifecycleStatus | null;
  criticality: Criticality | null;
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

/**
 * F3's own comparison table (PR5) — genuinely new orchestration, not a new
 * algorithm: each row folds one commit in memory via
 * `cachedBranchProjection.ts`'s `loadProjectionAtCommitCached` (the same
 * cached in-memory fold `useLandscape.ts`/`useElementPage.ts` already use
 * for a branch ref), then re-runs `src/ui/capabilityMap/metrics.ts`'s own
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
): Promise<OptionComparisonRow> {
  const projection = await loadProjectionAtCommitCached(supabase, modelId, commitId);
  const elementsById = new Map(projection.elementsHead.map((e) => [e.element_id, e]));
  const supportsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'supports');

  const metricsByCapabilityId = new Map<UUID, CapabilityComparisonMetrics>();
  for (const capabilityId of capabilityIds) {
    metricsByCapabilityId.set(capabilityId, {
      coverage: supportingSystemIds(capabilityId, supportsEdges).length,
      oldestLifecycleStage: oldestLifecycleStage(capabilityId, supportsEdges, elementsById),
      criticality: worstCriticality(capabilityId, supportsEdges, elementsById),
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
    const ownsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'owns');
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

  return { branchId, label, metricsByCapabilityId, boundaryCrossingCount, affectedValueStreams };
}

export interface CompareDecisionOptionsInput {
  modelId: UUID;
  mainHeadCommitId: UUID;
  /** The decision's own `linked_type: 'element'` links, filtered to capabilities — the columns this comparison actually varies over. */
  capabilityIds: readonly UUID[];
  options: readonly { branchId: UUID; headCommitId: UUID; label: string }[];
}

export interface CompareDecisionOptionsResult {
  main: OptionComparisonRow;
  options: OptionComparisonRow[];
}

/** Every option row, plus the `main` baseline row everything is implicitly diffed against (the comparison table itself renders the delta; this just returns each row's own absolute numbers). */
export async function compareDecisionOptions(supabase: Client, input: CompareDecisionOptionsInput): Promise<CompareDecisionOptionsResult> {
  const { modelId, mainHeadCommitId, capabilityIds, options } = input;
  // Model-wide (currently-approved branches), not commit-scoped — the same
  // external fact every row's own rollup tone reads regardless of which
  // option's projection it's otherwise looking at, so fetched once here
  // rather than once per row.
  const plannedReplacements = await loadPlannedReplacements(supabase, modelId);
  const main = await computeComparisonRow(supabase, modelId, mainHeadCommitId, capabilityIds, null, 'Current (main)', plannedReplacements);
  const optionRows = await Promise.all(options.map((o) => computeComparisonRow(supabase, modelId, o.headCommitId, capabilityIds, o.branchId, o.label, plannedReplacements)));
  return { main, options: optionRows };
}

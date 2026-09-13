import type { Criticality, LifecycleStatus, UUID } from '../../contracts/delta';
import { loadProjectionAtCommit } from '../../db/branchProjection';
import type { Client } from '../../db/client';
import { findBoundaryCrossings } from '../../db/healthFindings';
import { oldestLifecycleStage, supportingSystemIds, worstCriticality } from '../capabilityMap/metrics';

export interface CapabilityComparisonMetrics {
  coverage: number;
  oldestLifecycleStage: LifecycleStatus | null;
  criticality: Criticality | null;
}

export interface OptionComparisonRow {
  /** `null` for the "Current (main)" baseline row every option is compared against — a real option is always a branch. */
  branchId: UUID | null;
  label: string;
  metricsByCapabilityId: Map<UUID, CapabilityComparisonMetrics>;
  /** Model-wide, never per-capability — `findBoundaryCrossings`' own shape (a `uses`/`flows_to` edge, not a capability fact). F1's own "cost" column has no data source yet and is absent here, not a blank cell (CLAUDE.md rule 7). */
  boundaryCrossingCount: number;
}

/**
 * F3's own comparison table (PR5) — genuinely new orchestration, not a new
 * algorithm: each row folds one commit in memory via
 * `branchProjection.ts`'s `loadProjectionAtCommit` (the same in-memory
 * fold `useLandscape.ts`/`useElementPage.ts` already use for a branch
 * ref), then re-runs `src/ui/capabilityMap/metrics.ts`'s own functions and
 * `findBoundaryCrossings` against that projected state — the exact same
 * functions every other capability-map/health-finding surface already
 * uses against the *live* head, just pointed at a different commit. The
 * `main` row and every option row go through this identical path, so
 * nothing here special-cases "the baseline" versus "an option."
 */
async function computeComparisonRow(supabase: Client, modelId: UUID, commitId: UUID, capabilityIds: readonly UUID[], branchId: UUID | null, label: string): Promise<OptionComparisonRow> {
  const projection = await loadProjectionAtCommit(supabase, modelId, commitId);
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
  return { branchId, label, metricsByCapabilityId, boundaryCrossingCount };
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
  const main = await computeComparisonRow(supabase, modelId, mainHeadCommitId, capabilityIds, null, 'Current (main)');
  const optionRows = await Promise.all(options.map((o) => computeComparisonRow(supabase, modelId, o.headCommitId, capabilityIds, o.branchId, o.label)));
  return { main, options: optionRows };
}

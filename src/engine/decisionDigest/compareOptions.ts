import type { Criticality, FitForPurpose, LifecycleStatus, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { ChangeSubjectSummary } from '../../db/changeSummary';
import { summarizeOwnDeltas } from '../../db/changeSummary';
import type { Client } from '../../db/client';
import { buildCommitLoader } from '../../db/commitLoader';
import { findBoundaryCrossings, computeSelfOwnedCapabilityIds } from '../../db/healthFindings';
import { buildCapabilityTiles, loadPlannedReplacements, type PlannedReplacement } from '../../db/modelHome';
import { listOwnDeltas, type BranchFork } from '../branch';
import type { Head } from '../deltas';
import { serializeHeadProjection } from '../projection';
import { oldestLifecycleStage, supportingSystemIds, worstCriticality, worstFitForPurpose } from '../../ui/capabilityMap/metrics';
import { valueStreamsReachedFrom } from '../../ui/valueStreams/impactTraversal';
import { computeStageRollup, computeStreamRollup, stagesOf, type ValueStreamTone } from '../../ui/valueStreams/valueStreamRollup';
import { foldFromGenesis } from '../head';
import { computeAlsoAffected, type AlsoAffectedElement } from './alsoAffected';
import { summarizeOptionChanges } from './optionChangeSummary';
import { deriveOptionTouch } from './optionTouch';
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

/** The raw, per-row data `computeComparisonRow` builds along the way to its own `OptionComparisonRow` — kept around (rather than discarded once the row's own numbers are computed) because Part B's "What changes" table and "Also affected" section both need the underlying projection, not just the summarised metrics. `head` is the engine's own folded `Head` (Map-based) at this ref's own commit — for an option, this is `foldFromGenesis(headCommitId)` under the hood (`loadHeadAtCommitCached`), which walks the option's own commit chain back through its `base_commit_id` to genesis and never touches anything main did *after* that fork point (see `compareDecisionOptions`'s own module comment on what that means for drift). `elementsById`/`relationshipsHead` are `head`'s already-serialised row-shaped twin (`engine/projection.ts`'s `serializeHeadProjection`), which every other function in this file reads. */
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
  commitId: UUID,
  capabilityIds: readonly UUID[],
  branchId: UUID | null,
  label: string,
  plannedReplacements: readonly PlannedReplacement[],
  loadHead: (commitId: UUID) => Promise<Head>,
): Promise<{ row: OptionComparisonRow; raw: ComparisonRowRaw }> {
  // `loadHeadAtCommitCached` (not `loadProjectionAtCommitCached`, which
  // just wraps this call and re-serialises) — the own-delta derivation
  // below (`compareDecisionOptions`) needs the folded `Head` itself as an
  // `asIsHead`/`toBeHead` pair for `summarizeOwnDeltas`, so this reads it
  // once and serialises locally rather than fetching the identical cached
  // value twice under two different function names.
  const head = await loadHead(commitId);
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

/** `true` when main has moved since this option's own fork point — the fact `mainDriftedByBranchId` flags for the reader via the "Main has moved since this option branched" note (`DecisionView.tsx`). Extracted as its own pure function so this one real piece of drift-detection logic is unit-testable directly, rather than only provable by exercising the whole (Supabase-backed) `compareDecisionOptions`. */
export function hasMainDrifted(optionBaseCommitId: UUID, mainHeadCommitId: UUID): boolean {
  return optionBaseCommitId !== mainHeadCommitId;
}

export interface CompareDecisionOptionsInput {
  modelId: UUID;
  mainHeadCommitId: UUID;
  /** The decision's own `linked_type: 'element'` links, filtered to capabilities — the columns `metricsByCapabilityId`/`affectedValueStreams` actually vary over. */
  capabilityIds: readonly UUID[];
  /** The decision's own `linked_type: 'element'` links, filtered to systems/containers — Part B's own "system/container concern" rows (unchanged/retired/replaced by X), which have no `metricsByCapabilityId` equivalent (a system has no `supports` edges targeting *it*). */
  otherConcernElementIds: readonly UUID[];
  /** `baseCommitId` is the option branch's own fork point (`branches.base_commit_id`) — needed alongside `headCommitId` to compute this option's own deltas (`listOwnDeltas`'s `BranchFork`), the basis for everything Part B derives about "what this option itself did." */
  options: readonly { branchId: UUID; baseCommitId: UUID; headCommitId: UUID; label: string }[];
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
  /** Branch ids whose `baseCommitId` no longer equals `mainHeadCommitId` — main has moved since this option forked. `DecisionView.tsx` shows a small note on these; the capability metric rows and the scoped-crossing count are already drift-proofed against this exact fact (each compares against main folded at the option's own fork point, not main's current head) — this set is purely informational, telling the reader *that* main moved, since the rows themselves no longer need it to stay correct. */
  mainDriftedByBranchId: ReadonlySet<UUID>;
}

/**
 * Every option row, plus the `main` baseline row everything is implicitly
 * diffed against (the comparison table itself renders the delta; this
 * just returns each row's own absolute numbers), plus Part B's own
 * derived comparison data (What-changes rows, Also-affected, and each
 * option's one-line summary) — all pure functions run once here, over
 * data this function has already fetched, never recomputed by a
 * component.
 *
 * Three distinct derivations feed the result:
 * - `boundaryCrossingCount`/`affectedValueStreams` (via `computeComparisonRow`,
 *   the `main`/`options` rows themselves) compare main's *current* head
 *   projection against the option's own head projection — genuine state
 *   facts (how many systems support a capability *right now*), not deltas.
 *   `boundaryCrossingCount` here is the model-wide figure `DecisionView.tsx`
 *   shows as a fixed label, distinct from the "What changes" table's own
 *   scoped crossing row below; `affectedValueStreams` isn't drift-proofed
 *   (this sprint's own decision-side-completion item scopes that fix to
 *   the two families below only).
 * - The "What changes" table's own capability metric rows and scoped-
 *   crossing count compare each option against main folded at *that
 *   option's own* `baseCommitId` (its fork point) — `mainAtFork` below,
 *   one fold per option (an option's own head already folds from genesis
 *   through its own `base_commit_id`, `ComparisonRowRaw`'s own doc
 *   comment; this folds the *same* commit id, just reading main's state
 *   there instead of the option's). This drift-proofs those specific rows
 *   against main moving independently after the fork — the "before"
 *   number no longer changes underneath an option just because main kept
 *   moving; `mainDriftedByBranchId` flags *that* it moved, for the reader,
 *   since the rows themselves no longer need flagging to stay correct.
 * - `whatChangesRows`' own outcome/scope pieces, `alsoAffectedByBranchId`,
 *   and `optionSummaries` are built from each option's own `OptionTouch`
 *   (`optionTouch.ts`) — `summarizeOwnDeltas` over `listOwnDeltas`'s
 *   fork-scoped delta list, immune to that same drift by construction:
 *   "what this option itself did" is exactly its own commits, regardless
 *   of what main did after the fork.
 */
export async function compareDecisionOptions(supabase: Client, input: CompareDecisionOptionsInput, loadHeadAtCommit?: (commitId: UUID) => Promise<Head>): Promise<CompareDecisionOptionsResult> {
  const { modelId, mainHeadCommitId, capabilityIds, otherConcernElementIds, options } = input;
  // `plannedReplacements` (model-wide, not commit-scoped) and the raw
  // commit/delta loader (needed for `listOwnDeltas` below — a single
  // shared fetch across every option, not one per option, the same
  // "batch, don't enumerate" shape `changeSummary.ts`'s own
  // `loadChangeSummariesForModel` uses) — both fetched once here rather
  // than once per row.
  const [plannedReplacements, commitLoader] = await Promise.all([loadPlannedReplacements(supabase, modelId), buildCommitLoader(supabase, modelId)]);
  const loadHead = loadHeadAtCommit ?? ((id: UUID) => Promise.resolve(foldFromGenesis(id, commitLoader)));
  const mainResult = await computeComparisonRow(mainHeadCommitId, capabilityIds, null, 'Current (live model)', plannedReplacements, loadHead);
  // `branchId` is captured directly from this option's own input row (a
  // real `UUID`, never `null`) rather than read back off the computed
  // result — `computeComparisonRow`'s return type is shared with the
  // `null`-branchId main row above, so reading `.row.branchId` back would
  // widen to `UUID | null` even here, where it's always real.
  const optionComputations = await Promise.all(
    options.map(async (o) => {
      // `mainAtFork` — main's own state, folded at *this option's own*
      // fork point (`o.baseCommitId`), not at `mainHeadCommitId` — the
      // drift-proof "before" side for this option's own capability metric
      // rows and scoped-crossing count (this function's own module
      // comment). `loadHeadAtCommitCached` inside `computeComparisonRow`
      // means two options sharing a fork point reuse the same cached fold.
      const [result, mainAtFork] = await Promise.all([
        computeComparisonRow(o.headCommitId, capabilityIds, o.branchId, o.label, plannedReplacements, loadHead),
        computeComparisonRow(o.baseCommitId, capabilityIds, null, 'Live model at fork', plannedReplacements, loadHead),
      ]);
      // `asIsHead` = this option's own fork point — `summarizeOwnDeltas`'s
      // own "as-is/to-be" pair, needed to resolve a touched subject's
      // display name; `mainAtFork.raw.head` is this exact same fold, so no
      // second fetch/fold for it.
      const asIsHead = mainAtFork.raw.head;
      const fork: BranchFork = { baseCommitId: o.baseCommitId, headCommitId: o.headCommitId };
      const ownDeltas = listOwnDeltas(fork, commitLoader);
      const { subjects }: { subjects: ChangeSubjectSummary[] } = summarizeOwnDeltas(ownDeltas, asIsHead, result.raw.head);
      const touch = deriveOptionTouch(subjects, result.raw.elementsById, result.raw.relationshipsHead);
      return { branchId: o.branchId, touch, mainAtFork, drifted: hasMainDrifted(o.baseCommitId, mainHeadCommitId), ...result };
    }),
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
    touch: c.touch,
    mainAtFork: { row: c.mainAtFork.row, elementsById: c.mainAtFork.raw.elementsById, relationshipsHead: c.mainAtFork.raw.relationshipsHead, supportsEdges: c.mainAtFork.raw.supportsEdges },
  }));

  const whatChangesRows = buildWhatChangesRows({
    concernCapabilities,
    concernSystemsOrContainers,
    main: { row: mainResult.row, elementsById: mainResult.raw.elementsById, relationshipsHead: mainResult.raw.relationshipsHead, supportsEdges: mainResult.raw.supportsEdges },
    options: optionsForWhatChanges,
  });

  const alsoAffectedByBranchId = new Map<UUID, AlsoAffectedElement[]>();
  const optionSummaries = new Map<UUID, string | null>();
  for (const c of optionComputations) {
    // Owners of a removed element are read from main's own projection (the
    // element no longer resolves on the option's own side); owners of an
    // added or changed element from the option's own projection — decision
    // 2, the sprint's own go-ahead.
    alsoAffectedByBranchId.set(c.branchId, computeAlsoAffected(c.touch, concernElementIdSet, mainResult.raw.ownsEdges, mainResult.raw.elementsById, c.raw.ownsEdges, c.raw.elementsById));
    optionSummaries.set(c.branchId, summarizeOptionChanges(c.touch));
  }

  const mainDriftedByBranchId = new Set<UUID>(optionComputations.filter((c) => c.drifted).map((c) => c.branchId));

  return {
    main: mainResult.row,
    options: optionComputations.map((c) => c.row),
    whatChangesRows,
    alsoAffectedByBranchId,
    optionSummaries,
    mainDriftedByBranchId,
  };
}

/**
 * F6.3 (decision page rework, Part B): the "What changes" table's own row
 * data — pure comparison logic, no I/O, so `DecisionView.tsx` only ever
 * renders `WhatChangesRow[]` it's handed rather than computing anything
 * itself (the sprint's own constraint). Every row is "this option's value
 * vs main's value for this row" (never option-vs-option, the brief's own
 * rule 2) — a row's `anyChanged` is `true` the moment any *one* option
 * differs from main, which is exactly the collapse rule the table itself
 * applies (`groupWhatChangesRows` below).
 *
 * Five row families, one per the brief's own rule 1 ("one row per declared
 * concern + boundary crossings + affected-value-stream rows") plus the
 * decision-side-completion item's own "Trigger resolved" addition:
 * - A capability concern becomes up to four independent metric rows
 *   (coverage/lifecycle/criticality/fit — decision 2 in the sprint's own
 *   go-ahead), each collapsing on its own. Each option's own "before" side
 *   for these rows is main folded at *that option's own* `baseCommitId`
 *   (its fork point), never main's current head — a decision-side-
 *   completion item, drift-proofing what used to compare against a moving
 *   target. See `compareOptions.ts`'s own module comment for the fold and
 *   the drift-note this makes possible.
 * - A system/container concern becomes one outcome row (unchanged/retired/
 *   replaced by X/removed from model), derived from the option's own
 *   `OptionTouch` (`optionTouch.ts`) — its own `lifecycleRetiredElements`,
 *   `replacesEdges`, and `retiredElements`, all read off the option's
 *   *own* deltas resolved against the option's own current head, never a
 *   version-diff against main (which would conflate the option's own
 *   changes with independent main-side drift).
 * - Every declared concern (capability *and* system/container alike) also
 *   gets a "Trigger resolved" row — is the concern's own lifecycle exposure
 *   gone under this option? Reuses `src/ui/capabilityMap/metrics.ts`'s
 *   `systemsExposedByLifecycle` verbatim (the same definition the health
 *   finding and the capability-map colour-by mode already use — never a
 *   second, decision-page-local one), applied to a capability's own
 *   supporting systems or to a system/container concern's own singleton
 *   system, on both the option's fork-point-main "before" and its own head
 *   "after" (the identical drift-proofing the metric rows above use). See
 *   `computeTriggerResolution`'s own doc comment for the four possible
 *   states.
 * - Exactly one "boundary crossings" row, scoped per option (decision 1:
 *   at-least-one-endpoint-in-scope) — distinct from the model-wide figure
 *   `DecisionView.tsx` shows as a fixed label alongside this table, never
 *   folded into it. The scope's own "everything this option touches" half
 *   is `OptionTouch.touchedElementIds` — own-deltas, not a diff. Main's own
 *   scoped *count* is, like the metric rows above, computed against main
 *   folded at this option's own fork point, not main's current head.
 * - Exactly one "Run cost" row, evidence only (never prefills or rates the
 *   judged Cost criterion — `decision_option_ratings` is a wholly separate
 *   table, ADR-022): what leaves (a retired or lifecycle-retired element,
 *   band read off main at this option's own fork point) against what
 *   arrives (an added element, band read off this option's own head), a
 *   `replaces` edge pairing the two when one exists. No totals, no
 *   differences, no "saving" — bands are ordinal and non-additive
 *   (`annualRunCost.ts`'s own rule); "cost incomplete" replaces the whole
 *   cell the moment any listed element's band is unset, rather than
 *   showing a partial pairing a reader could misread as a saving.
 * - One row per value stream reached by *any* row (main or an option) —
 *   "not reached" is a real, comparable state of its own, never the same
 *   as an empty cell. Deliberately NOT drift-proofed the same way — the
 *   sprint's own decision-side-completion item scopes that fix to the
 *   capability metric rows, the crossing count, and the trigger-resolved
 *   row only.
 */
import type { AnnualRunCost, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { findBoundaryCrossings } from '../../db/healthFindings';
import { annualRunCostLabel, annualRunCostOf, ANNUAL_RUN_COST_NOT_ENTERED_LABEL } from '../elements/annualRunCost';
import { hasLifecycleExposureData, replacedElementIds, supportingSystemIds, systemsExposedByLifecycle } from '../capabilityMap/metrics';
import type { ValueStreamTone } from '../valueStreams/valueStreamRollup';
import type { CapabilityComparisonMetrics, OptionComparisonRow } from './compareOptions';
import type { OptionTouch } from './optionTouch';

/**
 * The row shape lives in `src/engine/decisionDigest/whatChangesRow.ts` so the
 * ADR formatter and reviewer digest can read it without importing UI code.
 * Re-exported here so every existing UI import is unchanged.
 */
import type { WhatChangesCell, WhatChangesRow } from '../../engine/decisionDigest/whatChangesRow';

export type { WhatChangesCell, WhatChangesRow } from '../../engine/decisionDigest/whatChangesRow';

function cell(display: string, changed: boolean): WhatChangesCell {
  return { display, changed };
}

function formatCountDelta(before: number, after: number, unit: (n: number) => string): string {
  if (before === after) return 'no change';
  const diff = after - before;
  return `${String(before)} → ${String(after)} ${unit(after)} (${diff > 0 ? '+' : ''}${String(diff)})`;
}

const UNRATED_LABEL = 'not rated';

/** `null` reads as "not rated" on both sides — an unrated capability never silently counts as unchanged next to a rated one, or vice versa (the brief's own "unrated shows 'not rated', never counts as good"). */
function formatCategoricalDelta(before: string | null, after: string | null): string {
  if (before === after) return 'no change';
  return `${before ?? UNRATED_LABEL} → ${after ?? UNRATED_LABEL}`;
}

// ---------------------------------------------------------------------------
// Capability concern -> up to four independent metric rows
// ---------------------------------------------------------------------------

export interface CapabilityMetricOptionInput {
  /** This option's own (after) metrics. */
  metrics: CapabilityComparisonMetrics | undefined;
  /** Main folded at *this option's own* `baseCommitId` (its fork point) — the "before" side these rows actually compare against, drift-proofed against main's current head moving independently after the fork. */
  beforeMetrics: CapabilityComparisonMetrics | undefined;
}

/** `currentMainMetrics` is main's *current* head — used only for the "Current (main)" column's own absolute display value (what main looks like right now), never for the delta text or `anyChanged` — those come from each option's own `beforeMetrics` instead, per this file's own module comment. */
export function buildCapabilityMetricRows(capability: ElementsHeadRow, currentMainMetrics: CapabilityComparisonMetrics | undefined, optionsInput: ReadonlyMap<UUID, CapabilityMetricOptionInput>): WhatChangesRow[] {
  const currentMainCoverage = currentMainMetrics?.coverage ?? 0;
  const currentMainLifecycle = currentMainMetrics?.oldestLifecycleStage ?? null;
  const currentMainCriticality = currentMainMetrics?.criticality ?? null;
  const currentMainFit = currentMainMetrics?.fit ?? null;

  function buildRow(rowLabel: string, mainDisplay: string, pick: (input: CapabilityMetricOptionInput) => string): WhatChangesRow {
    const options = new Map<UUID, WhatChangesCell>();
    for (const [branchId, input] of optionsInput) {
      const display = pick(input);
      options.set(branchId, cell(display, display !== 'no change'));
    }
    return {
      id: `capability:${capability.element_id}:${rowLabel}`,
      groupLabel: capability.name,
      rowLabel,
      main: cell(mainDisplay, false),
      options,
      anyChanged: [...options.values()].some((c) => c.changed),
    };
  }

  return [
    buildRow('Coverage', `${String(currentMainCoverage)} ${currentMainCoverage === 1 ? 'system' : 'systems'}`, (input) => formatCountDelta(input.beforeMetrics?.coverage ?? 0, input.metrics?.coverage ?? 0, (n) => (n === 1 ? 'system' : 'systems'))),
    buildRow('Lifecycle', currentMainLifecycle ?? UNRATED_LABEL, (input) => formatCategoricalDelta(input.beforeMetrics?.oldestLifecycleStage ?? null, input.metrics?.oldestLifecycleStage ?? null)),
    buildRow('Criticality', currentMainCriticality ?? UNRATED_LABEL, (input) => formatCategoricalDelta(input.beforeMetrics?.criticality ?? null, input.metrics?.criticality ?? null)),
    buildRow('Fit', currentMainFit ?? UNRATED_LABEL, (input) => formatCategoricalDelta(input.beforeMetrics?.fit ?? null, input.metrics?.fit ?? null)),
  ];
}

// ---------------------------------------------------------------------------
// System/container concern -> one outcome row
// ---------------------------------------------------------------------------

export type SystemConcernOutcome = { kind: 'unchanged' } | { kind: 'retired' } | { kind: 'replaced'; replacedByName: string } | { kind: 'removed' };

/**
 * `elementId`'s own outcome on this option, read off its own `OptionTouch`
 * (`optionTouch.ts`) — three distinct, independently-real outcomes, per
 * the real actions that produce them (ADR-000):
 * - `'replaced'`: this option's own deltas introduced a live `replaces`
 *   edge targeting the concern (`useElementRetire.ts`'s "replaced by"
 *   picker) — checked first, since the same action that creates this edge
 *   also sets `lifecycleStatus: 'retiring'` in the same commit, and
 *   "replaced by X" is the more specific fact.
 * - `'retired'`: this option's own deltas set the concern's
 *   `lifecycleStatus` to `retiring`/`retired` (`'lifecycleRetiredElementIds'`,
 *   `useElementRetire.ts` with no replacement picked) — the concern still
 *   exists, only its lifecycle status changed.
 * - `'removed'`: this option's own deltas retracted the concern outright
 *   (`useElementRemoveFromModel.ts`'s "Remove from model…") — it no
 *   longer exists at all, distinct from a lifecycle retirement.
 * Anything this option didn't do reads as `'unchanged'` — this option
 * never touching the element at all is exactly as "unchanged" as one that
 * touched it without producing any of the three outcomes above.
 */
export function computeSystemConcernOutcome(elementId: UUID, touch: OptionTouch, optionElementsById: ReadonlyMap<UUID, ElementsHeadRow>): SystemConcernOutcome {
  if (!optionElementsById.has(elementId)) {
    return touch.retiredElements.some((e) => e.id === elementId) ? { kind: 'removed' } : { kind: 'unchanged' };
  }

  const replacesEdge = touch.replacesEdges.find((r) => r.toElementId === elementId);
  if (replacesEdge) {
    const replacedByName = optionElementsById.get(replacesEdge.fromElementId)?.name ?? replacesEdge.fromElementId;
    return { kind: 'replaced', replacedByName };
  }

  if (touch.lifecycleRetiredElements.some((e) => e.id === elementId)) return { kind: 'retired' };
  return { kind: 'unchanged' };
}

export interface SystemConcernOptionInput {
  touch: OptionTouch;
  elementsById: ReadonlyMap<UUID, ElementsHeadRow>;
}

export function buildSystemConcernOutcomeRow(element: ElementsHeadRow, optionsInput: ReadonlyMap<UUID, SystemConcernOptionInput>): WhatChangesRow {
  const options = new Map<UUID, WhatChangesCell>();
  for (const [branchId, input] of optionsInput) {
    const outcome = computeSystemConcernOutcome(element.element_id, input.touch, input.elementsById);
    const display = outcome.kind === 'unchanged' ? 'no change' : outcome.kind === 'retired' ? 'retired' : outcome.kind === 'removed' ? 'removed from model' : `replaced by ${outcome.replacedByName}`;
    options.set(branchId, cell(display, outcome.kind !== 'unchanged'));
  }
  return {
    id: `element:${element.element_id}:outcome`,
    groupLabel: element.name,
    rowLabel: 'Outcome',
    main: cell('unchanged', false),
    options,
    anyChanged: [...options.values()].some((c) => c.changed),
  };
}

// ---------------------------------------------------------------------------
// Boundary crossings -> one scoped row
// ---------------------------------------------------------------------------

export interface ScopedCrossingCounts {
  main: number;
  option: number;
}

/**
 * Decision 1 (the sprint's own go-ahead): a crossing counts for this scope
 * if *at least one* endpoint is in scope — a crossing has one end outside
 * the boundary by definition (`findBoundaryCrossings`'
 * `isBoundaryCrossingPair`, `src/db/healthFindings.ts`), so requiring both
 * endpoints in scope would report ~zero crossings for nearly every option.
 *
 * Scope = every declared concern element itself, plus every system
 * supporting a concern capability (on *both* main's and this option's own
 * `supports` edges — a system this option newly added or removed as a
 * supporter still belongs in scope), plus everything this option's own
 * deltas touched at all (`OptionTouch.touchedElementIds` — created,
 * updated, or retracted; removed elements included, so a retired system's
 * own crossings still count against the *before* picture). Main's own
 * count is computed against this exact same scope, against main's own
 * edges — never the model-wide figure — so "3 → 2" is always a
 * like-with-like comparison (the sprint's own rule 7).
 *
 * "Main" here is caller-supplied (`mainSupportsEdges`/`mainRelationshipsHead`/
 * `mainElementsById`) — this function is agnostic to *which* main
 * projection that is. `buildBoundaryCrossingsRow` passes each option's own
 * fork-point main, drift-proofing `counts.main` the same way the
 * capability metric rows are.
 */
export function computeScopedBoundaryCrossings(
  concernElementIds: readonly UUID[],
  mainSupportsEdges: readonly RelationshipsHeadRow[],
  optionSupportsEdges: readonly RelationshipsHeadRow[],
  mainRelationshipsHead: readonly RelationshipsHeadRow[],
  optionRelationshipsHead: readonly RelationshipsHeadRow[],
  mainElementsById: ReadonlyMap<UUID, ElementsHeadRow>,
  optionElementsById: ReadonlyMap<UUID, ElementsHeadRow>,
  touch: OptionTouch,
): ScopedCrossingCounts {
  const concernIdSet = new Set(concernElementIds);
  const scope = new Set<UUID>(concernElementIds);
  for (const edge of mainSupportsEdges) if (concernIdSet.has(edge.to_element_id)) scope.add(edge.from_element_id);
  for (const edge of optionSupportsEdges) if (concernIdSet.has(edge.to_element_id)) scope.add(edge.from_element_id);
  for (const id of touch.touchedElementIds) scope.add(id);

  const inScope = (edge: RelationshipsHeadRow): boolean => scope.has(edge.from_element_id) || scope.has(edge.to_element_id);

  return {
    main: findBoundaryCrossings(mainRelationshipsHead.filter(inScope), mainElementsById).length,
    option: findBoundaryCrossings(optionRelationshipsHead.filter(inScope), optionElementsById).length,
  };
}

export interface BoundaryCrossingsOptionInput {
  supportsEdges: readonly RelationshipsHeadRow[];
  relationshipsHead: readonly RelationshipsHeadRow[];
  elementsById: ReadonlyMap<UUID, ElementsHeadRow>;
  touch: OptionTouch;
  /** Main folded at *this option's own* `baseCommitId` (its fork point) — the "before" side `counts.main` actually compares against, same drift-proofing as the capability metric rows. Each option carries its own, since different options can fork at different points. */
  mainAtForkSupportsEdges: readonly RelationshipsHeadRow[];
  mainAtForkRelationshipsHead: readonly RelationshipsHeadRow[];
  mainAtForkElementsById: ReadonlyMap<UUID, ElementsHeadRow>;
}

export function buildBoundaryCrossingsRow(concernElementIds: readonly UUID[], optionsInput: ReadonlyMap<UUID, BoundaryCrossingsOptionInput>): WhatChangesRow {
  const options = new Map<UUID, WhatChangesCell>();
  for (const [branchId, input] of optionsInput) {
    const counts = computeScopedBoundaryCrossings(concernElementIds, input.mainAtForkSupportsEdges, input.supportsEdges, input.mainAtForkRelationshipsHead, input.relationshipsHead, input.mainAtForkElementsById, input.elementsById, input.touch);
    const display = formatCountDelta(counts.main, counts.option, (n) => (n === 1 ? 'crossing' : 'crossings'));
    options.set(branchId, cell(display, counts.main !== counts.option));
  }
  return {
    id: 'boundary-crossings',
    groupLabel: 'Boundary crossings',
    rowLabel: 'Scoped crossings',
    main: cell('—', false),
    options,
    anyChanged: [...options.values()].some((c) => c.changed),
  };
}

// ---------------------------------------------------------------------------
// Run cost -> exactly one row, evidence only (never touches the judged Cost
// criterion in decision_option_ratings — ADR-022's own decisions-tier/
// model-tier split; whatChangesRows.ts has no dependency on that table at
// all, and nothing here writes anything). annualRunCost is banded and
// non-additive (annualRunCost.ts's own module comment) — never summed,
// never a "saving": this only ever lists what leaves and what arrives,
// each side's own band read at the state where it actually applies (a
// retiring/removed element's band as main had it just before this option's
// own changes; an added element's band as this option's own head has it).
// ---------------------------------------------------------------------------

export type RunCostChange =
  | { kind: 'replace'; retiring: { name: string; band: AnnualRunCost | null }; added: { name: string; band: AnnualRunCost | null } }
  | { kind: 'retire'; retiring: { name: string; band: AnnualRunCost | null } }
  | { kind: 'add'; added: { name: string; band: AnnualRunCost | null } };

function isCostBearing(element: ElementsHeadRow): boolean {
  return element.element_type === 'system' || element.element_type === 'container';
}

/**
 * This option's own run-cost-relevant changes, derived from its `OptionTouch`
 * — never a version-diff, same "own deltas, not main drift" reasoning every
 * other row in this file already follows. A `replaces` edge pairs a retiring
 * element (read off `mainAtForkElementsById` — its state just before this
 * option's own changes, since "retire" only changes `lifecycleStatus`/
 * retracts, it never rewrites `annualRunCost` itself) with its replacement
 * (read off `elementsById` — this option's own head); everything else in
 * `retiredElements`/`lifecycleRetiredElements`/`addedElements` that isn't
 * part of a pair is listed on its own. "Retired" here means either outcome
 * the rest of this file's own `computeSystemConcernOutcome` already
 * distinguishes — a true removal (`retiredElements`) or a lifecycle-only
 * retirement that leaves the element in place (`lifecycleRetiredElements`):
 * both are "leaving" for run-cost purposes, since a system the "Retire…"
 * action marks `retiring` is exactly the case the task's own "retire
 * option" names, and it never appears in `retiredElements` (ADR-000: Retire
 * sets `lifecycleStatus`, it never retracts). Non-cost-bearing elements
 * (a capability, an actor, a value stream) are never included — only
 * `system`/`container` carries `annualRunCost` at all.
 */
export function computeRunCostChanges(touch: OptionTouch, elementsById: ReadonlyMap<UUID, ElementsHeadRow>, mainAtForkElementsById: ReadonlyMap<UUID, ElementsHeadRow>): RunCostChange[] {
  const changes: RunCostChange[] = [];
  const pairedRetiringIds = new Set<UUID>();
  const pairedAddedIds = new Set<UUID>();

  for (const edge of touch.replacesEdges) {
    const retiring = mainAtForkElementsById.get(edge.toElementId);
    const added = elementsById.get(edge.fromElementId);
    if (!retiring || !added || !isCostBearing(retiring) || !isCostBearing(added)) continue;
    pairedRetiringIds.add(edge.toElementId);
    pairedAddedIds.add(edge.fromElementId);
    changes.push({ kind: 'replace', retiring: { name: retiring.name, band: annualRunCostOf(retiring) }, added: { name: added.name, band: annualRunCostOf(added) } });
  }

  const soloLeaving = [...touch.retiredElements, ...touch.lifecycleRetiredElements].filter((e) => !pairedRetiringIds.has(e.id));
  for (const leaving of soloLeaving) {
    const element = mainAtForkElementsById.get(leaving.id);
    if (!element || !isCostBearing(element)) continue;
    changes.push({ kind: 'retire', retiring: { name: element.name, band: annualRunCostOf(element) } });
  }

  const soloAdded = touch.addedElements.filter((e) => !pairedAddedIds.has(e.id));
  for (const added of soloAdded) {
    const element = elementsById.get(added.id);
    if (!element || !isCostBearing(element)) continue;
    changes.push({ kind: 'add', added: { name: element.name, band: annualRunCostOf(element) } });
  }

  return changes;
}

function bandDisplay(band: AnnualRunCost | null): string {
  return band === null ? ANNUAL_RUN_COST_NOT_ENTERED_LABEL : annualRunCostLabel(band);
}

function formatRunCostChange(change: RunCostChange): string {
  switch (change.kind) {
    case 'replace':
      return `${change.retiring.name} ${bandDisplay(change.retiring.band)} → ${change.added.name} ${bandDisplay(change.added.band)}`;
    case 'retire':
      return `${change.retiring.name} retired (${bandDisplay(change.retiring.band)})`;
    case 'add':
      return `${change.added.name} added (${bandDisplay(change.added.band)})`;
  }
}

function runCostChangeIncomplete(change: RunCostChange): boolean {
  switch (change.kind) {
    case 'replace':
      return change.retiring.band === null || change.added.band === null;
    case 'retire':
      return change.retiring.band === null;
    case 'add':
      return change.added.band === null;
  }
}

/**
 * No totals, no differences, no "saving" (the task's own rule) — each
 * change is listed on its own, joined, never combined into one figure.
 * "Cost incomplete" replaces the whole list the moment *any* listed
 * element's own band is unset, for this option, rather than half-showing a
 * pairing with a guessed-at gap — a partial "PM £250k–£1m → not entered"
 * line reads exactly like a saving to an inattentive reader, which the task
 * explicitly rules out.
 */
export function formatRunCostCell(changes: readonly RunCostChange[]): string {
  if (changes.length === 0) return 'no change';
  if (changes.some(runCostChangeIncomplete)) return 'cost incomplete';
  return changes.map(formatRunCostChange).join('; ');
}

export interface RunCostOptionInput {
  touch: OptionTouch;
  /** This option's own head — the "arrives" side. */
  elementsById: ReadonlyMap<UUID, ElementsHeadRow>;
  /** Main folded at *this option's own* `baseCommitId` — the "leaves" side's own state just before this option's changes, same drift-proofing every other row family in this file already applies. */
  mainAtForkElementsById: ReadonlyMap<UUID, ElementsHeadRow>;
}

/** Collapse rule (item 4): `anyChanged` — and therefore this row's own visibility — is `true` the moment any one option retires or adds at least one cost-bearing element, regardless of whether every band involved is actually set; an option with only non-cost-bearing changes (or none at all) reads as `changed: false`, same as `computeRunCostChanges` returning `[]`. */
export function buildRunCostRow(optionsInput: ReadonlyMap<UUID, RunCostOptionInput>): WhatChangesRow {
  const options = new Map<UUID, WhatChangesCell>();
  for (const [branchId, input] of optionsInput) {
    const changes = computeRunCostChanges(input.touch, input.elementsById, input.mainAtForkElementsById);
    options.set(branchId, cell(formatRunCostCell(changes), changes.length > 0));
  }
  return {
    id: 'run-cost',
    groupLabel: 'Run cost',
    rowLabel: 'Run cost',
    main: cell('—', false),
    options,
    anyChanged: [...options.values()].some((c) => c.changed),
  };
}

// ---------------------------------------------------------------------------
// Trigger resolved -> one row per declared concern (capability or
// system/container), reusing the exact same lifecycle-exposure definition
// the health finding and capability-map colour-by mode already use
// (`src/ui/capabilityMap/metrics.ts`'s `systemsExposedByLifecycle` — never
// a second, decision-page-local definition of exposure).
// ---------------------------------------------------------------------------

export type TriggerResolution = { kind: 'not_exposed' } | { kind: 'unknown' } | { kind: 'resolved' } | { kind: 'still_exposed' };

const TRIGGER_RESOLUTION_LABEL: Record<TriggerResolution['kind'], string> = {
  not_exposed: 'not exposed',
  unknown: 'unknown',
  resolved: 'exposed → resolved',
  still_exposed: 'exposed → still exposed',
};

/**
 * Whether this concern's own exposure trigger — the same lifecycle-exposure
 * read the health finding and capability-map colour-by mode already use,
 * applied here to `beforeSystems` (main folded at the option's own fork
 * point, per this file's own drift-proofing) — is gone on `afterSystems`
 * (this option's own head). Four states only, per the sprint's own list:
 * - `'unknown'`: `beforeSystems` is non-empty but none of them carry a
 *   recorded `plannedEnd` at all — there's no signal either way, so this
 *   is deliberately distinct from a genuine "not exposed" read (a system
 *   with no `plannedEnd` recorded reads identically to one confirmed to
 *   have none, which `hasLifecycleExposureData` exists to tell apart).
 * - `'not_exposed'`: either no systems are in scope at all (nothing that
 *   could be exposed), or real data exists and none of it is within
 *   `STALE_AFTER_MONTHS` — there was no trigger to resolve in the first
 *   place, on the *before* side.
 * - `'resolved'` / `'still_exposed'`: the before side was genuinely
 *   exposed; whether the after side still is decides which.
 * Deliberately not a fifth "newly exposed" state (before not exposed, after
 * exposed) — outside the sprint's own four-state list, and this row is
 * about resolving an existing trigger, not detecting a new one.
 */
export function computeTriggerResolution(beforeSystems: readonly ElementsHeadRow[], afterSystems: readonly ElementsHeadRow[], now: Date = new Date(), afterReplacedIds?: ReadonlySet<UUID>): TriggerResolution {
  if (beforeSystems.length === 0) return { kind: 'not_exposed' };
  if (!hasLifecycleExposureData(beforeSystems)) return { kind: 'unknown' };
  if (!systemsExposedByLifecycle(beforeSystems, now)) return { kind: 'not_exposed' };
  // Retire keeps the old system's capability links, so on the option's own head a replaced system is still a supporter; the recorded replacement is what clears it (same rule as the capability map).
  return systemsExposedByLifecycle(afterSystems, now, afterReplacedIds) ? { kind: 'still_exposed' } : { kind: 'resolved' };
}

export interface TriggerResolvedOptionInput {
  beforeSystems: readonly ElementsHeadRow[];
  afterSystems: readonly ElementsHeadRow[];
  /** Elements this option's own head records a replacement for (`replacedElementIds`). */
  afterReplacedIds?: ReadonlySet<UUID>;
}

/** A cell only ever marks `changed` on `'resolved'` — `'still_exposed'` is truthfully "nothing changed here", and the collapse rule (rule 2) should hide this row when every option leaves the concern equally exposed, same as it hides any other row no option affects. */
export function buildTriggerResolvedRow(id: string, groupLabel: string, mainSystems: readonly ElementsHeadRow[], optionsInput: ReadonlyMap<UUID, TriggerResolvedOptionInput>, now: Date = new Date()): WhatChangesRow {
  const options = new Map<UUID, WhatChangesCell>();
  for (const [branchId, input] of optionsInput) {
    const resolution = computeTriggerResolution(input.beforeSystems, input.afterSystems, now, input.afterReplacedIds);
    options.set(branchId, cell(TRIGGER_RESOLUTION_LABEL[resolution.kind], resolution.kind === 'resolved'));
  }
  // Main's own column is never anything but a before-vs-itself read (no
  // fork drift applies to main), so it can only ever land on `not_exposed`,
  // `unknown`, or `still_exposed` — `resolved` is impossible here by
  // construction, since `beforeSystems === afterSystems`.
  const mainResolution = computeTriggerResolution(mainSystems, mainSystems, now);
  return {
    id,
    groupLabel,
    rowLabel: 'Trigger resolved',
    main: cell(TRIGGER_RESOLUTION_LABEL[mainResolution.kind], false),
    options,
    anyChanged: [...options.values()].some((c) => c.changed),
  };
}

// ---------------------------------------------------------------------------
// Affected value streams -> one row per stream reached anywhere
// ---------------------------------------------------------------------------

const VALUE_STREAM_TONE_LABEL: Record<ValueStreamTone, string> = {
  ok: 'no known exposure',
  warn: 'end of life',
  info: 'replacement planned',
  neutral: 'no system supports this',
};

/** "Not reached" is a real, comparable state distinct from every `ValueStreamTone` — an option reaching a stream main never touched (or vice versa) is exactly the comparison this row exists to show, not a blank cell to hide (`ValueStreamComparisonRow`'s own doc comment in `compareOptions.ts`). */
export function valueStreamToneLabel(tone: ValueStreamTone | null): string {
  return tone === null ? 'not reached' : VALUE_STREAM_TONE_LABEL[tone];
}

export function buildValueStreamRow(streamId: UUID, streamName: string, mainRow: Pick<OptionComparisonRow, 'affectedValueStreams'>, optionRows: ReadonlyMap<UUID, Pick<OptionComparisonRow, 'affectedValueStreams'>>): WhatChangesRow {
  const mainTone = mainRow.affectedValueStreams.find((r) => r.stream.element_id === streamId)?.tone ?? null;
  const options = new Map<UUID, WhatChangesCell>();
  for (const [branchId, row] of optionRows) {
    const tone = row.affectedValueStreams.find((r) => r.stream.element_id === streamId)?.tone ?? null;
    const changed = tone !== mainTone;
    options.set(branchId, cell(changed ? `${valueStreamToneLabel(mainTone)} → ${valueStreamToneLabel(tone)}` : 'no change', changed));
  }
  return {
    id: `value-stream:${streamId}`,
    groupLabel: 'Affected value streams',
    rowLabel: streamName,
    main: cell(valueStreamToneLabel(mainTone), false),
    options,
    anyChanged: [...options.values()].some((c) => c.changed),
  };
}

// ---------------------------------------------------------------------------
// Orchestration + collapse
// ---------------------------------------------------------------------------

export interface WhatChangesOptionInput {
  branchId: UUID;
  row: OptionComparisonRow;
  elementsById: Map<UUID, ElementsHeadRow>;
  relationshipsHead: RelationshipsHeadRow[];
  supportsEdges: RelationshipsHeadRow[];
  touch: OptionTouch;
  /** Main folded at *this option's own* `baseCommitId` — the drift-proof "before" side for this option's own capability metric rows and scoped-crossing count (`compareOptions.ts`'s own module comment). */
  mainAtFork: {
    row: OptionComparisonRow;
    elementsById: Map<UUID, ElementsHeadRow>;
    relationshipsHead: RelationshipsHeadRow[];
    supportsEdges: RelationshipsHeadRow[];
  };
}

export interface WhatChangesInput {
  concernCapabilities: readonly ElementsHeadRow[];
  concernSystemsOrContainers: readonly ElementsHeadRow[];
  /** Main's *current* head — used only for the "Current (main)" column's own display and the value-stream rows (deliberately not drift-proofed, per this file's own module comment). */
  main: {
    row: OptionComparisonRow;
    elementsById: Map<UUID, ElementsHeadRow>;
    relationshipsHead: RelationshipsHeadRow[];
    supportsEdges: RelationshipsHeadRow[];
  };
  options: readonly WhatChangesOptionInput[];
}

/** Every "What changes" row (rule 1) — capability metric rows, system/container outcome rows, exactly one boundary-crossings row, and one row per value stream reached anywhere. Rendering order (visible-vs-collapsed grouping happens separately, in `groupWhatChangesRows`) follows this same order: declared concerns first (capabilities, then systems/containers, in the order they were linked), boundary crossings, then value streams. */
export function buildWhatChangesRows(input: WhatChangesInput): WhatChangesRow[] {
  const rows: WhatChangesRow[] = [];

  function systemsFor(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): ElementsHeadRow[] {
    const systems: ElementsHeadRow[] = [];
    for (const id of supportingSystemIds(capabilityId, supportsEdges)) {
      const system = elementsById.get(id);
      if (system) systems.push(system);
    }
    return systems;
  }

  for (const capability of input.concernCapabilities) {
    const optionsInput = new Map(
      input.options.map((o) => [o.branchId, { metrics: o.row.metricsByCapabilityId.get(capability.element_id), beforeMetrics: o.mainAtFork.row.metricsByCapabilityId.get(capability.element_id) }]),
    );
    rows.push(...buildCapabilityMetricRows(capability, input.main.row.metricsByCapabilityId.get(capability.element_id), optionsInput));

    const triggerOptionsInput = new Map(
      input.options.map((o) => [
        o.branchId,
        { beforeSystems: systemsFor(capability.element_id, o.mainAtFork.supportsEdges, o.mainAtFork.elementsById), afterSystems: systemsFor(capability.element_id, o.supportsEdges, o.elementsById), afterReplacedIds: replacedElementIds(o.relationshipsHead) },
      ]),
    );
    const mainSystems = systemsFor(capability.element_id, input.main.supportsEdges, input.main.elementsById);
    rows.push(buildTriggerResolvedRow(`capability:${capability.element_id}:trigger`, capability.name, mainSystems, triggerOptionsInput));
  }

  for (const element of input.concernSystemsOrContainers) {
    const optionsInput = new Map(input.options.map((o) => [o.branchId, { touch: o.touch, elementsById: o.elementsById }]));
    rows.push(buildSystemConcernOutcomeRow(element, optionsInput));

    const triggerOptionsInput = new Map(
      input.options.map((o) => {
        const before = o.mainAtFork.elementsById.get(element.element_id);
        const after = o.elementsById.get(element.element_id);
        return [o.branchId, { beforeSystems: before ? [before] : [], afterSystems: after ? [after] : [], afterReplacedIds: replacedElementIds(o.relationshipsHead) }];
      }),
    );
    const mainSelf = input.main.elementsById.get(element.element_id);
    rows.push(buildTriggerResolvedRow(`element:${element.element_id}:trigger`, element.name, mainSelf ? [mainSelf] : [], triggerOptionsInput));
  }

  const concernElementIds = [...input.concernCapabilities, ...input.concernSystemsOrContainers].map((e) => e.element_id);
  const crossingsInput = new Map(
    input.options.map((o) => [
      o.branchId,
      {
        supportsEdges: o.supportsEdges,
        relationshipsHead: o.relationshipsHead,
        elementsById: o.elementsById,
        touch: o.touch,
        mainAtForkSupportsEdges: o.mainAtFork.supportsEdges,
        mainAtForkRelationshipsHead: o.mainAtFork.relationshipsHead,
        mainAtForkElementsById: o.mainAtFork.elementsById,
      },
    ]),
  );
  rows.push(buildBoundaryCrossingsRow(concernElementIds, crossingsInput));

  const runCostInput = new Map(
    input.options.map((o) => [o.branchId, { touch: o.touch, elementsById: o.elementsById, mainAtForkElementsById: o.mainAtFork.elementsById }]),
  );
  rows.push(buildRunCostRow(runCostInput));

  const streamNameById = new Map<UUID, string>();
  for (const r of input.main.row.affectedValueStreams) streamNameById.set(r.stream.element_id, r.stream.name);
  for (const o of input.options) for (const r of o.row.affectedValueStreams) streamNameById.set(r.stream.element_id, r.stream.name);
  const optionRowsForStreams = new Map(input.options.map((o) => [o.branchId, o.row]));
  const streamIds = [...streamNameById.keys()].sort((a, b) => (streamNameById.get(a) ?? '').localeCompare(streamNameById.get(b) ?? ''));
  for (const streamId of streamIds) {
    rows.push(buildValueStreamRow(streamId, streamNameById.get(streamId) ?? streamId, input.main.row, optionRowsForStreams));
  }

  return rows;
}

export interface WhatChangesGrouping {
  visible: WhatChangesRow[];
  collapsed: WhatChangesRow[];
}

/** Rule 2: a row collapses (joins the tappable "N rows unchanged in all options" group) exactly when no option differs from main — never hidden outright, only grouped. A declared concern no option touches lands here automatically, reading as "no change" on every cell, per the brief's own "appears in the collapsed group as 'no change'". */
export function groupWhatChangesRows(rows: readonly WhatChangesRow[]): WhatChangesGrouping {
  return { visible: rows.filter((r) => r.anyChanged), collapsed: rows.filter((r) => !r.anyChanged) };
}

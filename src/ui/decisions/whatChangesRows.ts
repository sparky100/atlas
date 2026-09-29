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
 * Four row families, one per the brief's own rule 1 ("one row per declared
 * concern + boundary crossings + affected-value-stream rows"):
 * - A capability concern becomes up to four independent metric rows
 *   (coverage/lifecycle/criticality/fit — decision 2 in the sprint's own
 *   go-ahead), each collapsing on its own.
 * - A system/container concern becomes one outcome row
 *   (unchanged/retired/replaced by X), derived from
 *   `computeVersionDiff` plus a `replaces` edge the diff surfaces as an
 *   *added* relationship whose `toElementId` is this concern (ADR-001's
 *   own `from = replacement, to = retiring element` convention) — no
 *   second calculation, no `replaces`-specific fetch.
 * - Exactly one "boundary crossings" row, scoped per option (decision 1:
 *   at-least-one-endpoint-in-scope) — distinct from the model-wide figure
 *   `DecisionView.tsx` shows as a fixed label alongside this table, never
 *   folded into it.
 * - One row per value stream reached by *any* row (main or an option) —
 *   "not reached" is a real, comparable state of its own, never the same
 *   as an empty cell.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { findBoundaryCrossings } from '../../db/healthFindings';
import type { ValueStreamTone } from '../valueStreams/valueStreamRollup';
import type { VersionDiff } from '../../engine/versionDiff';
import type { CapabilityComparisonMetrics, OptionComparisonRow } from './compareOptions';

export interface WhatChangesCell {
  display: string;
  changed: boolean;
}

export interface WhatChangesRow {
  id: string;
  /** The capability/system/container/stream name this row belongs under, or "Boundary crossings" — how the UI groups rows (decision 2: "group visible rows under the capability name"). */
  groupLabel: string;
  /** "Coverage" / "Lifecycle" / "Criticality" / "Fit" / "Outcome" / "Scoped crossings" / a value stream's own name. */
  rowLabel: string;
  main: WhatChangesCell;
  options: ReadonlyMap<UUID, WhatChangesCell>;
  /** `true` the moment any one option's value differs from main's — the collapse rule (rule 2) operates on exactly this flag. */
  anyChanged: boolean;
}

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

export function buildCapabilityMetricRows(capability: ElementsHeadRow, mainMetrics: CapabilityComparisonMetrics | undefined, optionMetrics: ReadonlyMap<UUID, CapabilityComparisonMetrics | undefined>): WhatChangesRow[] {
  const mainCoverage = mainMetrics?.coverage ?? 0;
  const mainLifecycle = mainMetrics?.oldestLifecycleStage ?? null;
  const mainCriticality = mainMetrics?.criticality ?? null;
  const mainFit = mainMetrics?.fit ?? null;

  function buildRow(rowLabel: string, mainDisplay: string, pick: (m: CapabilityComparisonMetrics | undefined) => string): WhatChangesRow {
    const options = new Map<UUID, WhatChangesCell>();
    for (const [branchId, metrics] of optionMetrics) {
      const display = pick(metrics);
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
    buildRow('Coverage', `${String(mainCoverage)} ${mainCoverage === 1 ? 'system' : 'systems'}`, (m) => formatCountDelta(mainCoverage, m?.coverage ?? 0, (n) => (n === 1 ? 'system' : 'systems'))),
    buildRow('Lifecycle', mainLifecycle ?? UNRATED_LABEL, (m) => formatCategoricalDelta(mainLifecycle, m?.oldestLifecycleStage ?? null)),
    buildRow('Criticality', mainCriticality ?? UNRATED_LABEL, (m) => formatCategoricalDelta(mainCriticality, m?.criticality ?? null)),
    buildRow('Fit', mainFit ?? UNRATED_LABEL, (m) => formatCategoricalDelta(mainFit, m?.fit ?? null)),
  ];
}

// ---------------------------------------------------------------------------
// System/container concern -> one outcome row
// ---------------------------------------------------------------------------

export type SystemConcernOutcome = { kind: 'unchanged' } | { kind: 'retired' } | { kind: 'replaced'; replacedByName: string };

/** `elementId`'s own outcome on this option, read off `computeVersionDiff(mainHead, optionHead)` — retracted (state `'removed'`) with no `replaces` edge pointing at it is `'retired'`; retracted with one is `'replaced'`, naming the edge's own `fromElementId` (ADR-001: `from = replacement`) via this option's own elements. Anything else (still present, whether `'unchanged'`/`'changed'`/`'moved'`) reads as `'unchanged'` — rule 5 only ever distinguishes these three outcomes, never a fourth "modified" state. */
export function computeSystemConcernOutcome(elementId: UUID, diff: VersionDiff, optionElementsById: ReadonlyMap<UUID, ElementsHeadRow>): SystemConcernOutcome {
  const elementDiff = diff.elements.find((e) => e.elementId === elementId);
  if (elementDiff?.state !== 'removed') return { kind: 'unchanged' };

  const replacesEdge = diff.relationships.find((r) => r.state === 'added' && r.toBe?.relationshipType === 'replaces' && r.toBe.toElementId === elementId);
  if (!replacesEdge?.toBe) return { kind: 'retired' };
  const replacedByName = optionElementsById.get(replacesEdge.toBe.fromElementId)?.name ?? replacesEdge.toBe.fromElementId;
  return { kind: 'replaced', replacedByName };
}

export interface SystemConcernOptionInput {
  diff: VersionDiff;
  elementsById: ReadonlyMap<UUID, ElementsHeadRow>;
}

export function buildSystemConcernOutcomeRow(element: ElementsHeadRow, optionsInput: ReadonlyMap<UUID, SystemConcernOptionInput>): WhatChangesRow {
  const options = new Map<UUID, WhatChangesCell>();
  for (const [branchId, input] of optionsInput) {
    const outcome = computeSystemConcernOutcome(element.element_id, input.diff, input.elementsById);
    const display = outcome.kind === 'unchanged' ? 'no change' : outcome.kind === 'retired' ? 'retired' : `replaced by ${outcome.replacedByName}`;
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
 * diff touched at all (added/removed/changed — removed elements
 * included, so a retired system's own crossings still count against the
 * *before* picture). Main's own count is computed against this exact same
 * scope, against main's own edges — never the model-wide figure — so "3 →
 * 2" is always a like-with-like comparison (the sprint's own rule 7).
 */
export function computeScopedBoundaryCrossings(
  concernElementIds: readonly UUID[],
  mainSupportsEdges: readonly RelationshipsHeadRow[],
  optionSupportsEdges: readonly RelationshipsHeadRow[],
  mainRelationshipsHead: readonly RelationshipsHeadRow[],
  optionRelationshipsHead: readonly RelationshipsHeadRow[],
  mainElementsById: ReadonlyMap<UUID, ElementsHeadRow>,
  optionElementsById: ReadonlyMap<UUID, ElementsHeadRow>,
  diff: VersionDiff,
): ScopedCrossingCounts {
  const concernIdSet = new Set(concernElementIds);
  const scope = new Set<UUID>(concernElementIds);
  for (const edge of mainSupportsEdges) if (concernIdSet.has(edge.to_element_id)) scope.add(edge.from_element_id);
  for (const edge of optionSupportsEdges) if (concernIdSet.has(edge.to_element_id)) scope.add(edge.from_element_id);
  for (const e of diff.elements) if (e.state !== 'unchanged') scope.add(e.elementId);

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
  diff: VersionDiff;
}

export function buildBoundaryCrossingsRow(
  concernElementIds: readonly UUID[],
  mainSupportsEdges: readonly RelationshipsHeadRow[],
  mainRelationshipsHead: readonly RelationshipsHeadRow[],
  mainElementsById: ReadonlyMap<UUID, ElementsHeadRow>,
  optionsInput: ReadonlyMap<UUID, BoundaryCrossingsOptionInput>,
): WhatChangesRow {
  const options = new Map<UUID, WhatChangesCell>();
  for (const [branchId, input] of optionsInput) {
    const counts = computeScopedBoundaryCrossings(concernElementIds, mainSupportsEdges, input.supportsEdges, mainRelationshipsHead, input.relationshipsHead, mainElementsById, input.elementsById, input.diff);
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
// Affected value streams -> one row per stream reached anywhere
// ---------------------------------------------------------------------------

const VALUE_STREAM_TONE_LABEL: Record<ValueStreamTone, string> = {
  ok: 'no known exposure',
  warn: 'lifecycle exposure',
  info: 'replacement planned',
  neutral: 'nothing recorded',
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
  diff: VersionDiff;
}

export interface WhatChangesInput {
  concernCapabilities: readonly ElementsHeadRow[];
  concernSystemsOrContainers: readonly ElementsHeadRow[];
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

  for (const capability of input.concernCapabilities) {
    const optionMetrics = new Map(input.options.map((o) => [o.branchId, o.row.metricsByCapabilityId.get(capability.element_id)]));
    rows.push(...buildCapabilityMetricRows(capability, input.main.row.metricsByCapabilityId.get(capability.element_id), optionMetrics));
  }

  for (const element of input.concernSystemsOrContainers) {
    const optionsInput = new Map(input.options.map((o) => [o.branchId, { diff: o.diff, elementsById: o.elementsById }]));
    rows.push(buildSystemConcernOutcomeRow(element, optionsInput));
  }

  const concernElementIds = [...input.concernCapabilities, ...input.concernSystemsOrContainers].map((e) => e.element_id);
  const crossingsInput = new Map(input.options.map((o) => [o.branchId, { supportsEdges: o.supportsEdges, relationshipsHead: o.relationshipsHead, elementsById: o.elementsById, diff: o.diff }]));
  rows.push(buildBoundaryCrossingsRow(concernElementIds, input.main.supportsEdges, input.main.relationshipsHead, input.main.elementsById, crossingsInput));

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

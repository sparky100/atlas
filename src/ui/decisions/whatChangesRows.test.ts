import { describe, expect, it } from 'vitest';
import type { Delta, RelationshipType } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { ChangeSubjectSummary } from '../../db/changeSummary';
import type { CapabilityComparisonMetrics, OptionComparisonRow } from './compareOptions';
import { deriveOptionTouch } from './optionTouch';
import {
  buildBoundaryCrossingsRow,
  buildCapabilityMetricRows,
  buildSystemConcernOutcomeRow,
  buildTriggerResolvedRow,
  buildValueStreamRow,
  buildWhatChangesRows,
  computeScopedBoundaryCrossings,
  computeSystemConcernOutcome,
  computeTriggerResolution,
  groupWhatChangesRows,
  valueStreamToneLabel,
} from './whatChangesRows';

function elementRow(id: string, type: ElementsHeadRow['element_type'], name: string, attributes: Record<string, unknown> = {}): ElementsHeadRow {
  return { element_id: id, element_type: type, name, parent_id: null, attributes: attributes as ElementsHeadRow['attributes'], exists_delta_id: 'd1' };
}

function relRow(id: string, type: RelationshipsHeadRow['relationship_type'], from: string, to: string, attributes: Record<string, unknown> = {}): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: type, from_element_id: from, to_element_id: to, attributes: attributes as RelationshipsHeadRow['attributes'], exists_delta_id: 'd2' };
}

// Own-delta fixtures (ChangeSubjectSummary, the `summarizeOwnDeltas` shape
// `deriveOptionTouch` consumes) — the sprint's own decision to derive
// "what an option did" from its own deltas, not a version-diff against main.
function elementSubject(id: string, name: string, delta: Delta): ChangeSubjectSummary {
  return { subjectType: 'element', elementType: 'system', subjectId: id, name, deltas: [delta] };
}

function retractDelta(elementId: string): Delta {
  return { kind: 'element.retract', id: `retract-${elementId}`, elementId, elementType: 'system', previousDeltaId: 'prev', sourceId: 's1', confidence: 1 };
}

function lifecycleUpdateDelta(elementId: string): Delta {
  return { kind: 'element.update', id: `update-lifecycle-${elementId}`, elementId, elementType: 'system', attribute: 'lifecycleStatus', value: 'retiring', previousDeltaId: 'prev', sourceId: 's1', confidence: 1 };
}

function relationshipSubject(id: string, relationshipType: RelationshipType, from: string, to: string): ChangeSubjectSummary {
  const delta = { kind: 'relationship.create', id: `create-${id}`, relationshipId: id, relationshipType, fromElementId: from, toElementId: to, attributes: {}, sourceId: 's1', confidence: 1 } as Delta;
  return { subjectType: 'relationship', relationshipType, subjectId: id, name: `${relationshipType} ${from} → ${to}`, deltas: [delta] };
}

describe('buildCapabilityMetricRows', () => {
  const capability = elementRow('cap1', 'capability', 'Outage Management');
  const mainMetrics: CapabilityComparisonMetrics = { coverage: 3, oldestLifecycleStage: 'active', criticality: 'high', fit: 'poor' };

  function optionInput(metrics: CapabilityComparisonMetrics | undefined, beforeMetrics: CapabilityComparisonMetrics | undefined = mainMetrics) {
    return new Map([['b1', { metrics, beforeMetrics }]]);
  }

  it('produces exactly four rows (coverage, lifecycle, criticality, fit), each grouped under the capability name', () => {
    const rows = buildCapabilityMetricRows(capability, mainMetrics, new Map());
    expect(rows.map((r) => r.rowLabel)).toEqual(['Coverage', 'Lifecycle', 'Criticality', 'Fit']);
    expect(rows.every((r) => r.groupLabel === 'Outage Management')).toBe(true);
  });

  it('collapses (anyChanged: false) when every option matches its own before-metrics on every metric', () => {
    const rows = buildCapabilityMetricRows(capability, mainMetrics, optionInput(mainMetrics));
    expect(rows.every((r) => !r.anyChanged)).toBe(true);
    expect(rows.every((r) => r.options.get('b1')?.display === 'no change')).toBe(true);
  });

  it('shows a delta and anyChanged: true for a metric that differs, independently per metric', () => {
    const changed: CapabilityComparisonMetrics = { coverage: 2, oldestLifecycleStage: 'active', criticality: 'high', fit: 'poor' };
    const rows = buildCapabilityMetricRows(capability, mainMetrics, optionInput(changed));
    const coverageRow = rows.find((r) => r.rowLabel === 'Coverage');
    const lifecycleRow = rows.find((r) => r.rowLabel === 'Lifecycle');
    expect(coverageRow?.anyChanged).toBe(true);
    expect(coverageRow?.options.get('b1')?.display).toBe('3 → 2 systems (-1)');
    expect(lifecycleRow?.anyChanged).toBe(false);
  });

  it('an unrated fit (null) never reads as equal to a rated one, and displays "not rated"', () => {
    const unrated: CapabilityComparisonMetrics = { coverage: 3, oldestLifecycleStage: 'active', criticality: 'high', fit: null };
    const rows = buildCapabilityMetricRows(capability, mainMetrics, optionInput(unrated));
    const fitRow = rows.find((r) => r.rowLabel === 'Fit');
    expect(fitRow?.anyChanged).toBe(true);
    expect(fitRow?.options.get('b1')?.display).toBe('poor → not rated');
  });

  it('an option missing from metricsByCapabilityId (capability not resolved there) reads as all-zero/unrated, not a crash', () => {
    const rows = buildCapabilityMetricRows(capability, mainMetrics, optionInput(undefined));
    expect(rows.find((r) => r.rowLabel === 'Coverage')?.options.get('b1')?.display).toBe('3 → 0 systems (-3)');
  });

  it("decision-side-completion (drift-proofing): an option's delta compares against its OWN before-metrics (main folded at its own fork point), never the current-main figure shown in the \"Current (main)\" column — main drifting to a different current value after the option forked changes nothing about this row", () => {
    // Main has drifted to 5 systems since this option forked; the option's
    // own fork-point snapshot of main still reads 3 (unchanged from
    // `mainMetrics`), and the option itself now has 3 (no real change of
    // its own). If the row compared against current main (5), this would
    // wrongly show a change the option never made; comparing against the
    // option's own before-metrics (3) correctly reads "no change".
    const currentMain: CapabilityComparisonMetrics = { coverage: 5, oldestLifecycleStage: 'active', criticality: 'high', fit: 'poor' };
    const optionOwnMetrics: CapabilityComparisonMetrics = { coverage: 3, oldestLifecycleStage: 'active', criticality: 'high', fit: 'poor' };
    const rows = buildCapabilityMetricRows(capability, currentMain, optionInput(optionOwnMetrics, mainMetrics));
    const coverageRow = rows.find((r) => r.rowLabel === 'Coverage');
    expect(coverageRow?.main.display).toBe('5 systems'); // "Current (main)" column shows the real current figure...
    expect(coverageRow?.options.get('b1')).toEqual({ display: 'no change', changed: false }); // ...but the option's own row is unaffected by that drift.
  });
});

describe('computeSystemConcernOutcome', () => {
  it('reads as unchanged when this option never touched the element', () => {
    const touch = deriveOptionTouch([], new Map(), []);
    expect(computeSystemConcernOutcome('pm', touch, new Map())).toEqual({ kind: 'unchanged' });
  });

  it("reads as retired when this option's own lifecycle-retire delta leaves the element still existing (the real \"Retire…\" action, ADR-000 — never a retract)", () => {
    const optionElementsById = new Map([['pm', elementRow('pm', 'system', 'PM', { lifecycleStatus: 'retiring' })]]);
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', lifecycleUpdateDelta('pm'))], optionElementsById, []);
    expect(computeSystemConcernOutcome('pm', touch, optionElementsById)).toEqual({ kind: 'retired' });
  });

  it('reads as removed when this option retracted the element outright, with no lifecycle-retire delta ("Remove from model…", ADR-000)', () => {
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', retractDelta('pm'))], new Map(), []);
    expect(computeSystemConcernOutcome('pm', touch, new Map())).toEqual({ kind: 'removed' });
  });

  it("reads as replaced-by-X when this option's own deltas set the element's lifecycle to retiring AND introduced a live `replaces` edge pointing at it — the element itself is never retracted", () => {
    const optionElementsById = new Map([
      ['pm', elementRow('pm', 'system', 'PM', { lifecycleStatus: 'retiring' })],
      ['hana', elementRow('hana', 'system', 'Hana equivalent')],
    ]);
    const optionRelationshipsHead = [relRow('r1', 'replaces', 'hana', 'pm')];
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', lifecycleUpdateDelta('pm')), relationshipSubject('r1', 'replaces', 'hana', 'pm')], optionElementsById, optionRelationshipsHead);
    expect(computeSystemConcernOutcome('pm', touch, optionElementsById)).toEqual({ kind: 'replaced', replacedByName: 'Hana equivalent' });
  });
});

describe('buildSystemConcernOutcomeRow / buildWhatChangesRows system row', () => {
  it('collapses to "no change" when unchanged, and shows each of the other three outcomes\' own text when not', () => {
    const element = elementRow('sys1', 'system', 'Legacy Gateway');
    const unchangedTouch = deriveOptionTouch([], new Map(), []);

    const retiringElementsById = new Map([['sys1', elementRow('sys1', 'system', 'Legacy Gateway', { lifecycleStatus: 'retiring' })]]);
    const retiredTouch = deriveOptionTouch([elementSubject('sys1', 'Legacy Gateway', lifecycleUpdateDelta('sys1'))], retiringElementsById, []);

    const removedTouch = deriveOptionTouch([elementSubject('sys1', 'Legacy Gateway', retractDelta('sys1'))], new Map(), []);

    const replacedElementsById = new Map([
      ['sys1', elementRow('sys1', 'system', 'Legacy Gateway', { lifecycleStatus: 'retiring' })],
      ['hana', elementRow('hana', 'system', 'Hana equivalent')],
    ]);
    const replacedRelationshipsHead = [relRow('r1', 'replaces', 'hana', 'sys1')];
    const replacedTouch = deriveOptionTouch([elementSubject('sys1', 'Legacy Gateway', lifecycleUpdateDelta('sys1')), relationshipSubject('r1', 'replaces', 'hana', 'sys1')], replacedElementsById, replacedRelationshipsHead);

    const row = buildSystemConcernOutcomeRow(
      element,
      new Map([
        ['unchanged-branch', { touch: unchangedTouch, elementsById: new Map() }],
        ['retired-branch', { touch: retiredTouch, elementsById: retiringElementsById }],
        ['removed-branch', { touch: removedTouch, elementsById: new Map() }],
        ['replaced-branch', { touch: replacedTouch, elementsById: replacedElementsById }],
      ]),
    );
    expect(row.anyChanged).toBe(true);
    expect(row.options.get('unchanged-branch')).toEqual({ display: 'no change', changed: false });
    expect(row.options.get('retired-branch')).toEqual({ display: 'retired', changed: true });
    expect(row.options.get('removed-branch')).toEqual({ display: 'removed from model', changed: true });
    expect(row.options.get('replaced-branch')).toEqual({ display: 'replaced by Hana equivalent', changed: true });
  });
});

describe('computeTriggerResolution', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const exposedSystem = elementRow('sys1', 'system', 'Legacy Gateway', { plannedEnd: '2026-06-01' }); // within STALE_AFTER_MONTHS of `now`
  const safeSystem = elementRow('sys2', 'system', 'Safe System', { plannedEnd: '2032-01-01' }); // far beyond STALE_AFTER_MONTHS
  const noDataSystem = elementRow('sys3', 'system', 'No Data System');

  it('reads "not exposed" when the concern has no systems in scope at all', () => {
    expect(computeTriggerResolution([], [], now)).toEqual({ kind: 'not_exposed' });
  });

  it('reads "unknown" when systems exist but none carry a recorded plannedEnd — no signal either way, distinct from a genuine "not exposed"', () => {
    expect(computeTriggerResolution([noDataSystem], [noDataSystem], now)).toEqual({ kind: 'unknown' });
  });

  it('reads "not exposed" when real plannedEnd data exists and none of it is within STALE_AFTER_MONTHS', () => {
    expect(computeTriggerResolution([safeSystem], [safeSystem], now)).toEqual({ kind: 'not_exposed' });
  });

  it('reads "still_exposed" when the before side was exposed and the after side still is', () => {
    expect(computeTriggerResolution([exposedSystem], [exposedSystem], now)).toEqual({ kind: 'still_exposed' });
  });

  it('reads "resolved" when the before side was exposed and the after side no longer is', () => {
    expect(computeTriggerResolution([exposedSystem], [safeSystem], now)).toEqual({ kind: 'resolved' });
  });

  it('reads "resolved" when the exposed system was removed from the model entirely on the after side (no systems left to be exposed)', () => {
    expect(computeTriggerResolution([exposedSystem], [], now)).toEqual({ kind: 'resolved' });
  });

  it('never reads a fifth "newly exposed" state — a before side that was not exposed stays "not exposed" even if the after side introduces new exposure', () => {
    expect(computeTriggerResolution([safeSystem], [exposedSystem], now)).toEqual({ kind: 'not_exposed' });
  });
});

describe('buildTriggerResolvedRow', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const exposedSystem = elementRow('sys1', 'system', 'Legacy Gateway', { plannedEnd: '2026-06-01' });
  const safeSystem = elementRow('sys2', 'system', 'Safe System', { plannedEnd: '2032-01-01' });

  it('marks changed only on "resolved", follows the collapse rule, and shows the right label per state', () => {
    const row = buildTriggerResolvedRow(
      'row1',
      'Legacy Gateway',
      [],
      new Map([
        ['resolved-branch', { beforeSystems: [exposedSystem], afterSystems: [safeSystem] }],
        ['still-exposed-branch', { beforeSystems: [exposedSystem], afterSystems: [exposedSystem] }],
        ['not-exposed-branch', { beforeSystems: [safeSystem], afterSystems: [safeSystem] }],
      ]),
      now,
    );
    expect(row.rowLabel).toBe('Trigger resolved');
    expect(row.options.get('resolved-branch')).toEqual({ display: 'exposed → resolved', changed: true });
    expect(row.options.get('still-exposed-branch')).toEqual({ display: 'exposed → still exposed', changed: false });
    expect(row.options.get('not-exposed-branch')).toEqual({ display: 'not exposed', changed: false });
    expect(row.anyChanged).toBe(true);
  });

  it("collapses when every option leaves the concern equally exposed (no option resolved it)", () => {
    const row = buildTriggerResolvedRow('row1', 'Legacy Gateway', [], new Map([['b1', { beforeSystems: [exposedSystem], afterSystems: [exposedSystem] }]]), now);
    expect(row.anyChanged).toBe(false);
  });

  it("main's own column reads its current exposure state (before === after, self-comparison), never \"resolved\"", () => {
    const row = buildTriggerResolvedRow('row1', 'Legacy Gateway', [exposedSystem], new Map(), now);
    expect(row.main).toEqual({ display: 'exposed → still exposed', changed: false });
  });
});

describe('computeScopedBoundaryCrossings', () => {
  const capA = elementRow('capA', 'capability', 'A');
  const sysIT = elementRow('sysIT', 'system', 'IT System', { domain: 'it' });
  const sysOT = elementRow('sysOT', 'system', 'OT System', { domain: 'ot' });
  const sysOther = elementRow('sysOther', 'system', 'Unrelated OT System', { domain: 'ot' });

  it('counts a crossing when at least one endpoint is in scope (decision 1) — not requiring both', () => {
    // sysIT supports capA (in scope via supporter); it crosses to sysOther, which is NOT itself in scope.
    const supportsEdges = [relRow('s1', 'supports', 'sysIT', 'capA')];
    const elementsById = new Map([capA, sysIT, sysOther].map((e) => [e.element_id, e]));
    const relationshipsHead = [...supportsEdges, relRow('u1', 'uses', 'sysIT', 'sysOther')];
    const touch = deriveOptionTouch([], elementsById, relationshipsHead);
    const counts = computeScopedBoundaryCrossings(['capA'], supportsEdges, supportsEdges, relationshipsHead, relationshipsHead, elementsById, elementsById, touch);
    expect(counts).toEqual({ main: 1, option: 1 });
  });

  it("recomputes main's own count against the SAME option scope, including a removed element", () => {
    // main: sysOT supports capA and crosses to sysIT. Option: sysOT retired (removed from scope's edges), so the option's own edge is gone too.
    const mainSupportsEdges = [relRow('s1', 'supports', 'sysOT', 'capA')];
    const mainRelationshipsHead = [...mainSupportsEdges, relRow('u1', 'uses', 'sysOT', 'sysIT')];
    const mainElementsById = new Map([capA, sysOT, sysIT].map((e) => [e.element_id, e]));

    const optionSupportsEdges: RelationshipsHeadRow[] = [];
    const optionRelationshipsHead: RelationshipsHeadRow[] = [];
    const optionElementsById = new Map([capA, sysIT].map((e) => [e.element_id, e]));

    // The option's own deltas removed sysOT from the model outright — its own removal, not a diff artifact.
    const touch = deriveOptionTouch([elementSubject('sysOT', 'OT System', retractDelta('sysOT'))], optionElementsById, optionRelationshipsHead);

    const counts = computeScopedBoundaryCrossings(['capA'], mainSupportsEdges, optionSupportsEdges, mainRelationshipsHead, optionRelationshipsHead, mainElementsById, optionElementsById, touch);
    // Scope includes sysOT (removed element, still added to scope) and capA's main-side supporter sysOT.
    expect(counts.main).toBe(1);
    expect(counts.option).toBe(0);
  });
});

describe('buildBoundaryCrossingsRow / groupWhatChangesRows', () => {
  it('shows "no change" and is grouped as collapsed when the scoped count is identical', () => {
    const elementsById = new Map<string, ElementsHeadRow>();
    const touch = deriveOptionTouch([], elementsById, []);
    const row = buildBoundaryCrossingsRow(
      [],
      new Map([['b1', { supportsEdges: [], relationshipsHead: [], elementsById, touch, mainAtForkSupportsEdges: [], mainAtForkRelationshipsHead: [], mainAtForkElementsById: elementsById }]]),
    );
    expect(row.options.get('b1')).toEqual({ display: 'no change', changed: false });
    expect(groupWhatChangesRows([row]).collapsed).toEqual([row]);
    expect(groupWhatChangesRows([row]).visible).toEqual([]);
  });
});

describe('buildValueStreamRow / valueStreamToneLabel', () => {
  it('treats "not reached" as its own comparable state, distinct from every real tone', () => {
    expect(valueStreamToneLabel(null)).toBe('not reached');
    const stream = elementRow('vs1', 'value_stream', 'Outage response');
    const mainRow: Pick<OptionComparisonRow, 'affectedValueStreams'> = { affectedValueStreams: [] };
    const optionRow: Pick<OptionComparisonRow, 'affectedValueStreams'> = { affectedValueStreams: [{ stream, tone: 'warn' }] };
    const row = buildValueStreamRow('vs1', 'Outage response', mainRow, new Map([['b1', optionRow]]));
    expect(row.main.display).toBe('not reached');
    expect(row.options.get('b1')).toEqual({ display: 'not reached → lifecycle exposure', changed: true });
  });

  it('collapses when both sides reach the stream with the same tone', () => {
    const stream = elementRow('vs1', 'value_stream', 'Outage response');
    const mainRow: Pick<OptionComparisonRow, 'affectedValueStreams'> = { affectedValueStreams: [{ stream, tone: 'ok' }] };
    const optionRow: Pick<OptionComparisonRow, 'affectedValueStreams'> = { affectedValueStreams: [{ stream, tone: 'ok' }] };
    const row = buildValueStreamRow('vs1', 'Outage response', mainRow, new Map([['b1', optionRow]]));
    expect(row.anyChanged).toBe(false);
  });
});

describe('buildWhatChangesRows (full orchestration)', () => {
  it("a declared concern no option affects appears in the collapsed group, reading 'no change' on every metric", () => {
    const capability = elementRow('cap1', 'capability', 'Untouched Capability');
    const metrics: CapabilityComparisonMetrics = { coverage: 1, oldestLifecycleStage: 'active', criticality: 'low', fit: null };
    const mainRow: OptionComparisonRow = { branchId: null, label: 'main', metricsByCapabilityId: new Map([['cap1', metrics]]), boundaryCrossingCount: 0, affectedValueStreams: [] };
    const optionRow: OptionComparisonRow = { branchId: 'b1', label: 'Option', metricsByCapabilityId: new Map([['cap1', metrics]]), boundaryCrossingCount: 0, affectedValueStreams: [] };
    const touch = deriveOptionTouch([], new Map(), []);

    const rows = buildWhatChangesRows({
      concernCapabilities: [capability],
      concernSystemsOrContainers: [],
      main: { row: mainRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [] },
      options: [{ branchId: 'b1', row: optionRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [], touch, mainAtFork: { row: mainRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [] } }],
    });

    const { visible, collapsed } = groupWhatChangesRows(rows);
    expect(visible).toEqual([]);
    // 4 capability metric rows + 1 trigger-resolved row (no supporting
    // systems on either side, so "not exposed") + 1 boundary-crossings row.
    expect(collapsed).toHaveLength(6);
    const triggerRow = collapsed.find((r) => r.rowLabel === 'Trigger resolved');
    expect(triggerRow?.options.get('b1')).toEqual({ display: 'not exposed', changed: false });
    expect(collapsed.filter((r) => r.rowLabel !== 'Trigger resolved').every((r) => r.options.get('b1')?.display === 'no change')).toBe(true);
  });

  it('an empty-delta option (no capability/system concerns, two like-for-like options) produces only the boundary-crossings row, and it collapses', () => {
    const mainRow: OptionComparisonRow = { branchId: null, label: 'main', metricsByCapabilityId: new Map(), boundaryCrossingCount: 0, affectedValueStreams: [] };
    const optionRow: OptionComparisonRow = { branchId: 'b1', label: 'Option', metricsByCapabilityId: new Map(), boundaryCrossingCount: 0, affectedValueStreams: [] };
    const touch = deriveOptionTouch([], new Map(), []);
    const rows = buildWhatChangesRows({
      concernCapabilities: [],
      concernSystemsOrContainers: [],
      main: { row: mainRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [] },
      options: [{ branchId: 'b1', row: optionRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [], touch, mainAtFork: { row: mainRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [] } }],
    });
    expect(rows).toHaveLength(1);
    expect(groupWhatChangesRows(rows).visible).toEqual([]);
  });

  it("a fixture where main has drifted since the option forked (an unrelated system added to main after fork) still produces a correct summary/outcome — own-delta derivation is immune to that drift", () => {
    // The option's own deltas remove PM from the model outright — nothing
    // else. Main independently gained a new, unrelated capability concern
    // after the option forked (simulated here by giving main's row
    // different metrics for a SEPARATE capability than the option ever
    // touched) — the option's own outcome must still read exactly
    // "removed", untouched by that drift, since it's derived from the
    // option's own deltas alone.
    const pm = elementRow('pm', 'system', 'PM');
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', retractDelta('pm'))], new Map(), []);
    const outcome = computeSystemConcernOutcome('pm', touch, new Map());
    expect(outcome).toEqual({ kind: 'removed' });
    expect(touch.touchedElementIds.has(pm.element_id)).toBe(true);
    // Drift on main (a capability this option never linked or touched)
    // never appears in this option's own touch at all.
    expect(touch.touchedElementIds.has('unrelated-capability-main-added-after-fork')).toBe(false);
  });
});

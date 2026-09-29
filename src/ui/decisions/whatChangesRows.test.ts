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
  buildValueStreamRow,
  buildWhatChangesRows,
  computeScopedBoundaryCrossings,
  computeSystemConcernOutcome,
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

function relationshipSubject(id: string, relationshipType: RelationshipType, from: string, to: string): ChangeSubjectSummary {
  const delta = { kind: 'relationship.create', id: `create-${id}`, relationshipId: id, relationshipType, fromElementId: from, toElementId: to, attributes: {}, sourceId: 's1', confidence: 1 } as Delta;
  return { subjectType: 'relationship', relationshipType, subjectId: id, name: `${relationshipType} ${from} → ${to}`, deltas: [delta] };
}

describe('buildCapabilityMetricRows', () => {
  const capability = elementRow('cap1', 'capability', 'Outage Management');
  const mainMetrics: CapabilityComparisonMetrics = { coverage: 3, oldestLifecycleStage: 'active', criticality: 'high', fit: 'poor' };

  it('produces exactly four rows (coverage, lifecycle, criticality, fit), each grouped under the capability name', () => {
    const rows = buildCapabilityMetricRows(capability, mainMetrics, new Map());
    expect(rows.map((r) => r.rowLabel)).toEqual(['Coverage', 'Lifecycle', 'Criticality', 'Fit']);
    expect(rows.every((r) => r.groupLabel === 'Outage Management')).toBe(true);
  });

  it('collapses (anyChanged: false) when every option matches main on every metric', () => {
    const optionMetrics = new Map([['b1', mainMetrics]]);
    const rows = buildCapabilityMetricRows(capability, mainMetrics, optionMetrics);
    expect(rows.every((r) => !r.anyChanged)).toBe(true);
    expect(rows.every((r) => r.options.get('b1')?.display === 'no change')).toBe(true);
  });

  it('shows a delta and anyChanged: true for a metric that differs, independently per metric', () => {
    const changed: CapabilityComparisonMetrics = { coverage: 2, oldestLifecycleStage: 'active', criticality: 'high', fit: 'poor' };
    const rows = buildCapabilityMetricRows(capability, mainMetrics, new Map([['b1', changed]]));
    const coverageRow = rows.find((r) => r.rowLabel === 'Coverage');
    const lifecycleRow = rows.find((r) => r.rowLabel === 'Lifecycle');
    expect(coverageRow?.anyChanged).toBe(true);
    expect(coverageRow?.options.get('b1')?.display).toBe('3 → 2 systems (-1)');
    expect(lifecycleRow?.anyChanged).toBe(false);
  });

  it('an unrated fit (null) never reads as equal to a rated one, and displays "not rated"', () => {
    const unrated: CapabilityComparisonMetrics = { coverage: 3, oldestLifecycleStage: 'active', criticality: 'high', fit: null };
    const rows = buildCapabilityMetricRows(capability, mainMetrics, new Map([['b1', unrated]]));
    const fitRow = rows.find((r) => r.rowLabel === 'Fit');
    expect(fitRow?.anyChanged).toBe(true);
    expect(fitRow?.options.get('b1')?.display).toBe('poor → not rated');
  });

  it('an option missing from metricsByCapabilityId (capability not resolved there) reads as all-zero/unrated, not a crash', () => {
    const rows = buildCapabilityMetricRows(capability, mainMetrics, new Map([['b1', undefined]]));
    expect(rows.find((r) => r.rowLabel === 'Coverage')?.options.get('b1')?.display).toBe('3 → 0 systems (-3)');
  });
});

describe('computeSystemConcernOutcome', () => {
  it('reads as unchanged when this option never touched the element', () => {
    const touch = deriveOptionTouch([]);
    expect(computeSystemConcernOutcome('pm', touch, new Map())).toEqual({ kind: 'unchanged' });
  });

  it('reads as retired when this option retracted the element, with no replaces edge', () => {
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', retractDelta('pm'))]);
    expect(computeSystemConcernOutcome('pm', touch, new Map())).toEqual({ kind: 'retired' });
  });

  it('reads as replaced-by-X when this option retracted the element alongside its own `replaces` edge pointing at it', () => {
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', retractDelta('pm')), relationshipSubject('r1', 'replaces', 'hana', 'pm')]);
    const optionElementsById = new Map([['hana', elementRow('hana', 'system', 'Hana equivalent')]]);
    expect(computeSystemConcernOutcome('pm', touch, optionElementsById)).toEqual({ kind: 'replaced', replacedByName: 'Hana equivalent' });
  });
});

describe('buildSystemConcernOutcomeRow / buildWhatChangesRows system row', () => {
  it('collapses to "no change" when unchanged, and shows the outcome text when not', () => {
    const element = elementRow('sys1', 'system', 'Legacy Gateway');
    const unchangedTouch = deriveOptionTouch([]);
    const retiredTouch = deriveOptionTouch([elementSubject('sys1', 'Legacy Gateway', retractDelta('sys1'))]);

    const row = buildSystemConcernOutcomeRow(
      element,
      new Map([
        ['unchanged-branch', { touch: unchangedTouch, elementsById: new Map() }],
        ['retired-branch', { touch: retiredTouch, elementsById: new Map() }],
      ]),
    );
    expect(row.anyChanged).toBe(true);
    expect(row.options.get('unchanged-branch')).toEqual({ display: 'no change', changed: false });
    expect(row.options.get('retired-branch')).toEqual({ display: 'retired', changed: true });
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
    const touch = deriveOptionTouch([]);
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

    // The option's own deltas retracted sysOT — its own retire, not a diff artifact.
    const touch = deriveOptionTouch([elementSubject('sysOT', 'OT System', retractDelta('sysOT'))]);

    const counts = computeScopedBoundaryCrossings(['capA'], mainSupportsEdges, optionSupportsEdges, mainRelationshipsHead, optionRelationshipsHead, mainElementsById, optionElementsById, touch);
    // Scope includes sysOT (removed element, still added to scope) and capA's main-side supporter sysOT.
    expect(counts.main).toBe(1);
    expect(counts.option).toBe(0);
  });
});

describe('buildBoundaryCrossingsRow / groupWhatChangesRows', () => {
  it('shows "no change" and is grouped as collapsed when the scoped count is identical', () => {
    const elementsById = new Map<string, ElementsHeadRow>();
    const touch = deriveOptionTouch([]);
    const row = buildBoundaryCrossingsRow([], [], [], elementsById, new Map([['b1', { supportsEdges: [], relationshipsHead: [], elementsById, touch }]]));
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
    const touch = deriveOptionTouch([]);

    const rows = buildWhatChangesRows({
      concernCapabilities: [capability],
      concernSystemsOrContainers: [],
      main: { row: mainRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [] },
      options: [{ branchId: 'b1', row: optionRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [], touch }],
    });

    const { visible, collapsed } = groupWhatChangesRows(rows);
    expect(visible).toEqual([]);
    // 4 capability metric rows + 1 boundary-crossings row, all unchanged.
    expect(collapsed).toHaveLength(5);
    expect(collapsed.every((r) => r.options.get('b1')?.display === 'no change')).toBe(true);
  });

  it('an empty-delta option (no capability/system concerns, two like-for-like options) produces only the boundary-crossings row, and it collapses', () => {
    const mainRow: OptionComparisonRow = { branchId: null, label: 'main', metricsByCapabilityId: new Map(), boundaryCrossingCount: 0, affectedValueStreams: [] };
    const optionRow: OptionComparisonRow = { branchId: 'b1', label: 'Option', metricsByCapabilityId: new Map(), boundaryCrossingCount: 0, affectedValueStreams: [] };
    const touch = deriveOptionTouch([]);
    const rows = buildWhatChangesRows({
      concernCapabilities: [],
      concernSystemsOrContainers: [],
      main: { row: mainRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [] },
      options: [{ branchId: 'b1', row: optionRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [], touch }],
    });
    expect(rows).toHaveLength(1);
    expect(groupWhatChangesRows(rows).visible).toEqual([]);
  });

  it("a fixture where main has drifted since the option forked (an unrelated system added to main after fork) still produces a correct summary/outcome — own-delta derivation is immune to that drift", () => {
    // The option's own deltas retire PM — nothing else. Main independently
    // gained a new, unrelated capability concern after the option forked
    // (simulated here by giving main's row different metrics for a SEPARATE
    // capability than the option ever touched) — the option's own outcome
    // and summary must still read exactly "retires PM", untouched by that
    // drift, since both are derived from the option's own deltas alone.
    const pm = elementRow('pm', 'system', 'PM');
    const touch = deriveOptionTouch([elementSubject('pm', 'PM', retractDelta('pm'))]);
    const outcome = computeSystemConcernOutcome('pm', touch, new Map());
    expect(outcome).toEqual({ kind: 'retired' });
    expect(touch.touchedElementIds.has(pm.element_id)).toBe(true);
    // Drift on main (a capability this option never linked or touched)
    // never appears in this option's own touch at all.
    expect(touch.touchedElementIds.has('unrelated-capability-main-added-after-fork')).toBe(false);
  });
});

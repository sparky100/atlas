import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { emptyHead, type ElementRow, type Head, type RelationshipRow } from '../../engine/deltas';
import { computeVersionDiff } from '../../engine/versionDiff';
import type { CapabilityComparisonMetrics, OptionComparisonRow } from './compareOptions';
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

function withElement(head: Head, id: string, row: ElementRow): Head {
  head.elements.set(id, row);
  return head;
}

function withRelationship(head: Head, id: string, row: RelationshipRow): Head {
  head.relationships.set(id, row);
  return head;
}

function elementRow(id: string, type: ElementsHeadRow['element_type'], name: string, attributes: Record<string, unknown> = {}): ElementsHeadRow {
  return { element_id: id, element_type: type, name, parent_id: null, attributes: attributes as ElementsHeadRow['attributes'], exists_delta_id: 'd1' };
}

function relRow(id: string, type: RelationshipsHeadRow['relationship_type'], from: string, to: string, attributes: Record<string, unknown> = {}): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: type, from_element_id: from, to_element_id: to, attributes: attributes as RelationshipsHeadRow['attributes'], exists_delta_id: 'd2' };
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
  it('reads as unchanged when the element still exists on the option', () => {
    const row = { elementType: 'system' as const, name: 'PM', parentId: null, attributes: {}, existsDeltaId: 'd1' };
    const diff = computeVersionDiff(withElement(emptyHead(), 'pm', row), withElement(emptyHead(), 'pm', row));
    expect(computeSystemConcernOutcome('pm', diff, new Map())).toEqual({ kind: 'unchanged' });
  });

  it('reads as retired when the element is retracted with no replaces edge', () => {
    const row = { elementType: 'system' as const, name: 'PM', parentId: null, attributes: {}, existsDeltaId: 'd1' };
    const diff = computeVersionDiff(withElement(emptyHead(), 'pm', row), emptyHead());
    expect(computeSystemConcernOutcome('pm', diff, new Map())).toEqual({ kind: 'retired' });
  });

  it('reads as replaced-by-X when retracted alongside an added `replaces` edge pointing at it', () => {
    const pm = { elementType: 'system' as const, name: 'PM', parentId: null, attributes: {}, existsDeltaId: 'd1' };
    const hana = { elementType: 'system' as const, name: 'Hana equivalent', parentId: null, attributes: {}, existsDeltaId: 'd1' };
    const asIs = withElement(emptyHead(), 'pm', pm);
    let toBe = withElement(emptyHead(), 'hana', hana);
    toBe = withRelationship(toBe, 'r1', { relationshipType: 'replaces', fromElementId: 'hana', toElementId: 'pm', attributes: {}, existsDeltaId: 'd2' });
    const diff = computeVersionDiff(asIs, toBe);
    const optionElementsById = new Map([['hana', elementRow('hana', 'system', 'Hana equivalent')]]);
    expect(computeSystemConcernOutcome('pm', diff, optionElementsById)).toEqual({ kind: 'replaced', replacedByName: 'Hana equivalent' });
  });
});

describe('buildSystemConcernOutcomeRow / buildWhatChangesRows system row', () => {
  it('collapses to "no change" when unchanged, and shows the outcome text when not', () => {
    const element = elementRow('sys1', 'system', 'Legacy Gateway');
    const pm = { elementType: 'system' as const, name: 'Legacy Gateway', parentId: null, attributes: {}, existsDeltaId: 'd1' };
    const unchangedDiff = computeVersionDiff(withElement(emptyHead(), 'sys1', pm), withElement(emptyHead(), 'sys1', pm));
    const retiredDiff = computeVersionDiff(withElement(emptyHead(), 'sys1', pm), emptyHead());

    const row = buildSystemConcernOutcomeRow(
      element,
      new Map([
        ['unchanged-branch', { diff: unchangedDiff, elementsById: new Map() }],
        ['retired-branch', { diff: retiredDiff, elementsById: new Map() }],
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
    const diff = computeVersionDiff(emptyHead(), emptyHead());
    const counts = computeScopedBoundaryCrossings(['capA'], supportsEdges, supportsEdges, relationshipsHead, relationshipsHead, elementsById, elementsById, diff);
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

    const pmRow = { elementType: 'system' as const, name: 'OT System', parentId: null, attributes: { domain: 'ot' }, existsDeltaId: 'd1' };
    const asIs = withElement(emptyHead(), 'sysOT', pmRow);
    const diff = computeVersionDiff(asIs, emptyHead());

    const counts = computeScopedBoundaryCrossings(['capA'], mainSupportsEdges, optionSupportsEdges, mainRelationshipsHead, optionRelationshipsHead, mainElementsById, optionElementsById, diff);
    // Scope includes sysOT (removed element, still added to scope) and capA's main-side supporter sysOT.
    expect(counts.main).toBe(1);
    expect(counts.option).toBe(0);
  });
});

describe('buildBoundaryCrossingsRow / groupWhatChangesRows', () => {
  it('shows "no change" and is grouped as collapsed when the scoped count is identical', () => {
    const elementsById = new Map<string, ElementsHeadRow>();
    const diff = computeVersionDiff(emptyHead(), emptyHead());
    const row = buildBoundaryCrossingsRow([], [], [], elementsById, new Map([['b1', { supportsEdges: [], relationshipsHead: [], elementsById, diff }]]));
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
    const diff = computeVersionDiff(emptyHead(), emptyHead());

    const rows = buildWhatChangesRows({
      concernCapabilities: [capability],
      concernSystemsOrContainers: [],
      main: { row: mainRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [] },
      options: [{ branchId: 'b1', row: optionRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [], diff }],
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
    const diff = computeVersionDiff(emptyHead(), emptyHead());
    const rows = buildWhatChangesRows({
      concernCapabilities: [],
      concernSystemsOrContainers: [],
      main: { row: mainRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [] },
      options: [{ branchId: 'b1', row: optionRow, elementsById: new Map(), relationshipsHead: [], supportsEdges: [], diff }],
    });
    expect(rows).toHaveLength(1);
    expect(groupWhatChangesRows(rows).visible).toEqual([]);
  });
});

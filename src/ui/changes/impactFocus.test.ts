import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { AffectedCapability, ChangeAffectedValueStream } from '../../db/changeSummary';
import { describeImpactReason, describeImpactReasons, describeValueStreamReason, focusImpact } from './impactFocus';

function row(id: string, name: string, elementType: ElementsHeadRow['element_type'], parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: elementType, name, parent_id: parentId, attributes: {}, exists_delta_id: `create-${id}` };
}

const wayleaves = row('cap-w', 'Wayleaves', 'capability');
const records = row('cap-r', 'Asset records', 'capability');
const escoms = row('escoms', 'ESCOMS', 'system');
const reason = { kind: 'integration', systemName: 'ESCOMS', consumerName: 'ESCOMS', relationshipType: 'uses', otherName: 'GIS' } as const;

const capabilities: AffectedCapability[] = [
  { capability: records, viaSystems: [escoms], reasons: [reason] },
  { capability: wayleaves, viaSystems: [escoms], reasons: [reason] },
];

const stream = row('vs', 'Connections', 'value_stream');
const survey = row('st-1', 'Survey', 'value_stream', 'vs');
const consent = row('st-2', 'Consent', 'value_stream', 'vs');
const otherStream = row('vs-2', 'Asset lifecycle', 'value_stream');
const register = row('st-3', 'Register', 'value_stream', 'vs-2');
const valueStreams: ChangeAffectedValueStream[] = [
  { stream, reasons: [], stages: [{ stage: survey, viaCapabilities: [records], reasons: [] }, { stage: consent, viaCapabilities: [wayleaves], reasons: [] }] },
  { stream: otherStream, reasons: [], stages: [{ stage: register, viaCapabilities: [records], reasons: [] }] },
];

describe('focusImpact', () => {
  it('shows everything when the change is in no project', () => {
    const focus = focusImpact(capabilities, valueStreams, null);
    expect(focus.focused).toBe(false);
    expect(focus.shownCapabilities).toHaveLength(2);
    expect(focus.collapsedCapabilities).toHaveLength(0);
    expect(focus.shownValueStreams).toHaveLength(2);
  });

  it('shows everything when nothing affected is in the project scope — never an empty "nothing affected"', () => {
    const focus = focusImpact(capabilities, valueStreams, new Set(['escoms']));
    expect(focus.focused).toBe(false);
    expect(focus.shownCapabilities).toHaveLength(2);
  });

  it('shows only in-scope capabilities and collapses the rest', () => {
    const focus = focusImpact(capabilities, valueStreams, new Set(['cap-w']));
    expect(focus.focused).toBe(true);
    expect(focus.shownCapabilities.map((ac) => ac.capability.name)).toEqual(['Wayleaves']);
    expect(focus.collapsedCapabilities.map((ac) => ac.capability.name)).toEqual(['Asset records']);
  });

  it("keeps a stream shown with only the stages a shown capability reaches; a stream reached only by collapsed ones is collapsed", () => {
    const focus = focusImpact(capabilities, valueStreams, new Set(['cap-w']));
    expect(focus.shownValueStreams).toEqual([{ stream, reasons: [], stages: [{ stage: consent, viaCapabilities: [wayleaves], reasons: [] }] }]);
    expect(focus.collapsedValueStreams.map((v) => v.stream.name)).toEqual(['Asset lifecycle']);
  });
});

describe('focusImpact — value streams the change names directly', () => {
  it('never collapses a stage the change edits or links directly, whatever the project scope', () => {
    const direct: ChangeAffectedValueStream[] = [{ stream: otherStream, reasons: [], stages: [{ stage: register, viaCapabilities: [], reasons: [{ kind: 'enables', capabilityName: 'Asset records', change: 'removed' }] }] }];
    const focus = focusImpact(capabilities, direct, new Set(['cap-w']));
    expect(focus.shownValueStreams.map((v) => v.stream.name)).toEqual(['Asset lifecycle']);
    expect(focus.collapsedValueStreams).toEqual([]);
  });

  it("shows a stream whose own record the change edits, even with no stage reached", () => {
    const direct: ChangeAffectedValueStream[] = [{ stream: otherStream, reasons: [{ kind: 'stream', change: 'edited' }], stages: [] }];
    expect(focusImpact(capabilities, direct, new Set(['cap-w'])).shownValueStreams).toHaveLength(1);
  });

  it('words each value-stream reason', () => {
    expect(describeValueStreamReason({ kind: 'stage', change: 'edited' })).toBe('stage edited directly');
    expect(describeValueStreamReason({ kind: 'stage', change: 'added' })).toBe('stage added');
    expect(describeValueStreamReason({ kind: 'stream', change: 'removed' })).toBe('stream removed');
    expect(describeValueStreamReason({ kind: 'enables', capabilityName: 'Wayleaves', change: 'added' })).toBe('Wayleaves now enables it');
    expect(describeValueStreamReason({ kind: 'enables', capabilityName: 'Wayleaves', change: 'removed' })).toBe('Wayleaves no longer enables it');
  });
});

describe('describeImpactReason', () => {
  it('words each reason', () => {
    expect(describeImpactReason({ kind: 'direct' })).toBe('edited directly');
    expect(describeImpactReason({ kind: 'edited', systemName: 'GIS' })).toBe('GIS edited');
    expect(describeImpactReason({ kind: 'module', systemName: 'SAP', moduleName: 'SAP · PM' })).toBe('module SAP · PM edited');
    expect(describeImpactReason(reason)).toBe('integration: ESCOMS uses GIS');
    expect(describeImpactReason({ ...reason, relationshipType: 'flows_to' })).toBe('integration: ESCOMS sends data to GIS');
    expect(describeImpactReason({ kind: 'supports', systemName: 'GIS' })).toBe("GIS's support for it changed");
  });

  it('drops a repeated reason when joining', () => {
    expect(describeImpactReasons([reason, reason, { kind: 'edited', systemName: 'ESCOMS' }])).toBe('integration: ESCOMS uses GIS; ESCOMS edited');
  });
});

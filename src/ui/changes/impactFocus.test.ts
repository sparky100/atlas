import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { AffectedCapability } from '../../db/changeSummary';
import type { AffectedValueStream } from '../valueStreams/impactTraversal';
import { describeImpactReason, describeImpactReasons, focusImpact } from './impactFocus';

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
const valueStreams: AffectedValueStream[] = [
  { stream, stages: [{ stage: survey, viaCapabilities: [records] }, { stage: consent, viaCapabilities: [wayleaves] }] },
  { stream: otherStream, stages: [{ stage: register, viaCapabilities: [records] }] },
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
    expect(focus.shownValueStreams).toEqual([{ stream, stages: [{ stage: consent, viaCapabilities: [wayleaves] }] }]);
    expect(focus.collapsedValueStreams.map((v) => v.stream.name)).toEqual(['Asset lifecycle']);
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

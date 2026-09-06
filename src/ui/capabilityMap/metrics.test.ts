import { describe, expect, it } from 'vitest';
import { mostlyExternal, oldestLifecycleStage, supportingSystemIds, tileColourFor } from './metrics';
import type { ElementsHeadRow, Json, RelationshipsHeadRow } from '../../contracts/rows';

function system(id: string, lifecycleStatus?: string, isExternal = false): ElementsHeadRow {
  const attrs: Record<string, Json> = { isExternal };
  if (lifecycleStatus !== undefined) attrs.lifecycleStatus = lifecycleStatus;
  return { element_id: id, element_type: 'system', name: id, parent_id: null, attributes: attrs, exists_delta_id: `d-${id}` };
}

function supports(systemId: string, capabilityId: string): RelationshipsHeadRow {
  return { relationship_id: `r-${systemId}-${capabilityId}`, relationship_type: 'supports', from_element_id: systemId, to_element_id: capabilityId, attributes: {}, exists_delta_id: `d-r-${systemId}` };
}

describe('supportingSystemIds', () => {
  it('finds every system with a supports edge into the capability, ignoring edges into other capabilities', () => {
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-2')];
    expect(supportingSystemIds('cap-1', edges)).toEqual(['sys-1']);
  });
});

describe('oldestLifecycleStage', () => {
  it('returns the most-advanced stage among supporting systems', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', 'active')],
      ['sys-2', system('sys-2', 'retiring')],
    ]);
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-1')];
    expect(oldestLifecycleStage('cap-1', edges, systemsById)).toBe('retiring');
  });

  it('returns null when no supporting system has a recorded lifecycle status', () => {
    const systemsById = new Map([['sys-1', system('sys-1')]]);
    expect(oldestLifecycleStage('cap-1', [supports('sys-1', 'cap-1')], systemsById)).toBeNull();
  });

  it('returns null for a capability with no supporting systems at all', () => {
    expect(oldestLifecycleStage('cap-1', [], new Map())).toBeNull();
  });
});

describe('mostlyExternal', () => {
  it('is true when a strict majority of supporting systems are external', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', undefined, true)],
      ['sys-2', system('sys-2', undefined, true)],
      ['sys-3', system('sys-3', undefined, false)],
    ]);
    const edges = ['sys-1', 'sys-2', 'sys-3'].map((s) => supports(s, 'cap-1'));
    expect(mostlyExternal('cap-1', edges, systemsById)).toBe(true);
  });

  it('is null on an exact tie, not an arbitrary pick', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', undefined, true)],
      ['sys-2', system('sys-2', undefined, false)],
    ]);
    const edges = ['sys-1', 'sys-2'].map((s) => supports(s, 'cap-1'));
    expect(mostlyExternal('cap-1', edges, systemsById)).toBeNull();
  });

  it('is null with no supporting systems', () => {
    expect(mostlyExternal('cap-1', [], new Map())).toBeNull();
  });
});

describe('tileColourFor', () => {
  it('mode "none" never returns a tone or label', () => {
    expect(tileColourFor('none', 'cap-1', [supports('sys-1', 'cap-1')], new Map([['sys-1', system('sys-1', 'retired')]]))).toEqual({ tone: undefined, label: undefined });
  });

  it('flags zero supporting systems as a coverage gap (warn), any real count as plain neutral', () => {
    expect(tileColourFor('metric:supportingSystemCount', 'cap-1', [], new Map())).toEqual({ tone: 'warn', label: '0 supporting systems' });
    const edges = [supports('sys-1', 'cap-1')];
    expect(tileColourFor('metric:supportingSystemCount', 'cap-1', edges, new Map([['sys-1', system('sys-1')]]))).toEqual({ tone: 'neutral', label: '1 supporting system' });
  });

  it('never uses a status/danger tone for a merely-large supporting-system count', () => {
    const systemsById = new Map(Array.from({ length: 20 }, (_, i) => [`sys-${String(i)}`, system(`sys-${String(i)}`)] as const));
    const edges = [...systemsById.keys()].map((id) => supports(id, 'cap-1'));
    expect(tileColourFor('metric:supportingSystemCount', 'cap-1', edges, systemsById).tone).toBe('neutral');
  });

  it('colours by the oldest lifecycle stage using the same tone lifecycle chips use elsewhere', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'retired')]]);
    expect(tileColourFor('metric:oldestLifecycleStage', 'cap-1', [supports('sys-1', 'cap-1')], systemsById)).toEqual({ tone: 'neutral', label: 'retired' });
  });

  it('colours by isExternal only when supporting systems are mostly external', () => {
    const systemsById = new Map([['sys-1', system('sys-1', undefined, true)]]);
    expect(tileColourFor('attribute:isExternal', 'cap-1', [supports('sys-1', 'cap-1')], systemsById)).toEqual({ tone: 'neutral', label: 'mostly external' });
    const internalById = new Map([['sys-1', system('sys-1', undefined, false)]]);
    expect(tileColourFor('attribute:isExternal', 'cap-1', [supports('sys-1', 'cap-1')], internalById)).toEqual({ tone: undefined, label: undefined });
  });
});

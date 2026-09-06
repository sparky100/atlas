import { describe, expect, it } from 'vitest';
import { lifecycleExposure, oldestLifecycleStage, supportingSystemIds, tileColourFor } from './metrics';
import type { ElementsHeadRow, Json, RelationshipsHeadRow } from '../../contracts/rows';

function system(id: string, lifecycleStatus?: string, plannedEnd?: string): ElementsHeadRow {
  const attrs: Record<string, Json> = { isExternal: false };
  if (lifecycleStatus !== undefined) attrs.lifecycleStatus = lifecycleStatus;
  if (plannedEnd !== undefined) attrs.plannedEnd = plannedEnd;
  return { element_id: id, element_type: 'system', name: id, parent_id: null, attributes: attrs, exists_delta_id: `d-${id}` };
}

function supports(systemId: string, capabilityId: string): RelationshipsHeadRow {
  return { relationship_id: `r-${systemId}-${capabilityId}`, relationship_type: 'supports', from_element_id: systemId, to_element_id: capabilityId, attributes: {}, exists_delta_id: `d-r-${systemId}` };
}

const NOW = new Date('2026-06-15T00:00:00Z');

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

describe('lifecycleExposure', () => {
  it('is true when a supporting system plans to end within the next STALE_AFTER_MONTHS (12) months', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'retiring', '2027-01-01')]]); // ~6.5 months out
    expect(lifecycleExposure('cap-1', [supports('sys-1', 'cap-1')], systemsById, NOW)).toBe(true);
  });

  it('is true when a supporting system is already past its planned end (more exposed, not less)', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'retired', '2026-01-01')]]);
    expect(lifecycleExposure('cap-1', [supports('sys-1', 'cap-1')], systemsById, NOW)).toBe(true);
  });

  it('is false when the only planned end is well beyond the 12-month horizon', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'active', '2030-01-01')]]);
    expect(lifecycleExposure('cap-1', [supports('sys-1', 'cap-1')], systemsById, NOW)).toBe(false);
  });

  it('is false when no supporting system has a plannedEnd at all', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'active')]]);
    expect(lifecycleExposure('cap-1', [supports('sys-1', 'cap-1')], systemsById, NOW)).toBe(false);
  });

  it('is false for a capability with no supporting systems', () => {
    expect(lifecycleExposure('cap-1', [], new Map(), NOW)).toBe(false);
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

  it('colours lifecycle exposure danger only once a supporting system is actually exposed', () => {
    const soon = new Date();
    soon.setMonth(soon.getMonth() + 1);
    const exposedById = new Map([['sys-1', system('sys-1', 'retiring', soon.toISOString().slice(0, 10))]]);
    expect(tileColourFor('metric:lifecycleExposure', 'cap-1', [supports('sys-1', 'cap-1')], exposedById)).toEqual({ tone: 'danger', label: 'exposed' });

    const notExposedById = new Map([['sys-1', system('sys-1', 'active')]]);
    expect(tileColourFor('metric:lifecycleExposure', 'cap-1', [supports('sys-1', 'cap-1')], notExposedById)).toEqual({ tone: undefined, label: undefined });
  });
});

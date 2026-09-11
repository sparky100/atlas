import { describe, expect, it } from 'vitest';
import { aggregateTileColourFor, lifecycleExposure, oldestLifecycleStage, resolveDefaultColourBy, supportingSystemIds, tileColourFor, worstCriticality } from './metrics';
import type { ElementsHeadRow, Json, RelationshipsHeadRow } from '../../contracts/rows';

function system(id: string, lifecycleStatus?: string, plannedEnd?: string, criticality?: string): ElementsHeadRow {
  const attrs: Record<string, Json> = { isExternal: false };
  if (lifecycleStatus !== undefined) attrs.lifecycleStatus = lifecycleStatus;
  if (plannedEnd !== undefined) attrs.plannedEnd = plannedEnd;
  if (criticality !== undefined) attrs.criticality = criticality;
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

describe('worstCriticality (Prompt 7k item 1)', () => {
  it('returns the most-severe criticality among supporting systems', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', undefined, undefined, 'medium')],
      ['sys-2', system('sys-2', undefined, undefined, 'critical')],
    ]);
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-1')];
    expect(worstCriticality('cap-1', edges, systemsById)).toBe('critical');
  });

  it('returns null when no supporting system has a recorded criticality', () => {
    const systemsById = new Map([['sys-1', system('sys-1')]]);
    expect(worstCriticality('cap-1', [supports('sys-1', 'cap-1')], systemsById)).toBeNull();
  });

  it('returns null for a capability with no supporting systems at all', () => {
    expect(worstCriticality('cap-1', [], new Map())).toBeNull();
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

  it('colours by the worst-of criticality among supporting systems (Prompt 7k item 1)', () => {
    const systemsById = new Map([['sys-1', system('sys-1', undefined, undefined, 'critical')]]);
    expect(tileColourFor('metric:criticality', 'cap-1', [supports('sys-1', 'cap-1')], systemsById)).toEqual({ tone: 'danger', label: 'critical' });
  });

  it('criticality: no tone when no supporting system has a recorded criticality', () => {
    const systemsById = new Map([['sys-1', system('sys-1')]]);
    expect(tileColourFor('metric:criticality', 'cap-1', [supports('sys-1', 'cap-1')], systemsById)).toEqual({ tone: undefined, label: undefined });
  });
});

describe('aggregateTileColourFor (Sprint U4-1 C3 review note: L1 group header)', () => {
  it('mode "none" never returns a tone or label', () => {
    expect(aggregateTileColourFor('none', ['cap-1'], [], new Map())).toEqual({ tone: undefined, label: undefined });
  });

  it('an empty descendant list (an L1 with no L2/L3 children at all) never returns a tone or label', () => {
    expect(aggregateTileColourFor('metric:lifecycleExposure', [], [], new Map())).toEqual({ tone: undefined, label: undefined });
  });

  it('exposure: worst-of-children — any exposed descendant makes the whole group exposed, even when it is the only one', () => {
    const soon = new Date();
    soon.setMonth(soon.getMonth() + 1);
    const systemsById = new Map([
      ['sys-safe', system('sys-safe', 'active')],
      ['sys-exposed', system('sys-exposed', 'retiring', soon.toISOString().slice(0, 10))],
    ]);
    const edges = [supports('sys-safe', 'cap-safe'), supports('sys-exposed', 'cap-exposed')];
    expect(aggregateTileColourFor('metric:lifecycleExposure', ['cap-safe', 'cap-exposed'], edges, systemsById)).toEqual({ tone: 'danger', label: 'exposed' });
  });

  it('exposure: an L1 whose only exposed capability sits at L3 still reads as exposed — the descendant list is the caller\'s own flattened L2+L3 ids, not just L2', () => {
    const soon = new Date();
    soon.setMonth(soon.getMonth() + 1);
    const systemsById = new Map([['sys-l3', system('sys-l3', 'retiring', soon.toISOString().slice(0, 10))]]);
    const edges = [supports('sys-l3', 'cap-l3-leaf')];
    // 'cap-l2' (the L2 parent) has no supporting system of its own at all —
    // only its L3 child ('cap-l3-leaf') does.
    expect(aggregateTileColourFor('metric:lifecycleExposure', ['cap-l2', 'cap-l3-leaf'], edges, systemsById)).toEqual({ tone: 'danger', label: 'exposed' });
  });

  it('exposure: no tone when nothing in the group is exposed', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'active')]]);
    const edges = [supports('sys-1', 'cap-1')];
    expect(aggregateTileColourFor('metric:lifecycleExposure', ['cap-1', 'cap-2'], edges, systemsById)).toEqual({ tone: undefined, label: undefined });
  });

  it('oldest lifecycle stage: worst-of-children — the most-advanced stage among any descendant', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', 'active')],
      ['sys-2', system('sys-2', 'retired')],
    ]);
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-2')];
    expect(aggregateTileColourFor('metric:oldestLifecycleStage', ['cap-1', 'cap-2'], edges, systemsById)).toEqual({ tone: 'neutral', label: 'retired' });
  });

  it('coverage: fraction-supported, not worst-of-children — the label names the real fraction', () => {
    const systemsById = new Map([['sys-1', system('sys-1')]]);
    const edges = [supports('sys-1', 'cap-1')];
    expect(aggregateTileColourFor('metric:supportingSystemCount', ['cap-1', 'cap-2', 'cap-3'], edges, systemsById)).toEqual({ tone: 'neutral', label: '1/3 capabilities supported' });
  });

  it('coverage: warn only when literally none of the group\'s descendants have a supporting system', () => {
    expect(aggregateTileColourFor('metric:supportingSystemCount', ['cap-1', 'cap-2'], [], new Map())).toEqual({ tone: 'warn', label: '0/2 capabilities supported' });
  });

  it('criticality: worst-of-children, same shape as oldest lifecycle stage (Prompt 7k item 1)', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', undefined, undefined, 'low')],
      ['sys-2', system('sys-2', undefined, undefined, 'high')],
    ]);
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-2')];
    expect(aggregateTileColourFor('metric:criticality', ['cap-1', 'cap-2'], edges, systemsById)).toEqual({ tone: 'warn', label: 'high' });
  });

  it('criticality: no tone when nothing in the group has a recorded criticality', () => {
    expect(aggregateTileColourFor('metric:criticality', ['cap-1', 'cap-2'], [], new Map())).toEqual({ tone: undefined, label: undefined });
  });
});

describe('resolveDefaultColourBy (Sprint U4-1 C4)', () => {
  it('a saved choice always wins, regardless of home mode or whether the model has systems', () => {
    expect(resolveDefaultColourBy('metric:oldestLifecycleStage', 'director', true)).toBe('metric:oldestLifecycleStage');
    expect(resolveDefaultColourBy('none', 'architect', true)).toBe('none');
    expect(resolveDefaultColourBy('metric:supportingSystemCount', 'director', false)).toBe('metric:supportingSystemCount');
  });

  it('"none" while the model has no systems at all, no saved choice, regardless of home mode', () => {
    expect(resolveDefaultColourBy(null, 'director', false)).toBe('none');
    expect(resolveDefaultColourBy(null, 'architect', false)).toBe('none');
  });

  it('exposure for a director, coverage for an architect, once the model has real systems', () => {
    expect(resolveDefaultColourBy(null, 'director', true)).toBe('metric:lifecycleExposure');
    expect(resolveDefaultColourBy(null, 'architect', true)).toBe('metric:supportingSystemCount');
  });
});

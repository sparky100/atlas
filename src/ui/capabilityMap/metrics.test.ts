import { describe, expect, it } from 'vitest';
import {
  aiShareOf,
  aggregateTileColourFor,
  fitAssessmentSupportsEdges,
  lifecycleExposure,
  oldestLifecycleStage,
  otShareOf,
  replacedElementIds,
  weakFitSupportsEdges,
  resolveDefaultColourBy,
  supportingSystemIds,
  tileColourFor,
  worstCriticality,
  worstFitForPurpose,
  worstDispositionOf,
  worstFitForPurposeOfSupporter,
} from './metrics';
import type { ElementsHeadRow, Json, RelationshipsHeadRow } from '../../contracts/rows';

function system(id: string, lifecycleStatus?: string, plannedEnd?: string, criticality?: string, domain?: string): ElementsHeadRow {
  const attrs: Record<string, Json> = { isExternal: false };
  if (lifecycleStatus !== undefined) attrs.lifecycleStatus = lifecycleStatus;
  if (plannedEnd !== undefined) attrs.plannedEnd = plannedEnd;
  if (criticality !== undefined) attrs.criticality = criticality;
  if (domain !== undefined) attrs.domain = domain;
  return { element_id: id, element_type: 'system', name: id, parent_id: null, attributes: attrs, exists_delta_id: `d-${id}` };
}

function supports(systemId: string, capabilityId: string, fitForPurpose?: string, role?: string): RelationshipsHeadRow {
  const attrs: Record<string, Json> = fitForPurpose === undefined ? {} : { fitForPurpose };
  if (role !== undefined) attrs.role = role;
  return { relationship_id: `r-${systemId}-${capabilityId}`, relationship_type: 'supports', from_element_id: systemId, to_element_id: capabilityId, attributes: attrs, exists_delta_id: `d-r-${systemId}` };
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

  it('is false when the near-end supporter has a recorded replacement (ADR-001 amendment), and unchanged when none is passed', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'retiring', '2026-01-01')]]);
    const edges = [supports('sys-1', 'cap-1')];
    expect(lifecycleExposure('cap-1', edges, systemsById, NOW, new Set(['sys-1']))).toBe(false);
    expect(lifecycleExposure('cap-1', edges, systemsById, NOW, new Set(['sys-other']))).toBe(true);
    expect(lifecycleExposure('cap-1', edges, systemsById, NOW)).toBe(true);
  });

  it('a second, un-replaced near-end supporter still exposes the capability', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'retiring', '2026-01-01')], ['sys-2', system('sys-2', 'retiring', '2026-02-01')]]);
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-1')];
    expect(lifecycleExposure('cap-1', edges, systemsById, NOW, new Set(['sys-1']))).toBe(true);
  });
});

describe('lifecycle-exposure colouring with replacedIds (ADR-001 amendment)', () => {
  // `tileColourFor`/`aggregateTileColourFor` read `lifecycleExposure` against the real clock — a long-overdue plannedEnd stays exposed whatever "now" is.
  const systemsById = new Map([['sys-1', system('sys-1', 'retired', '2000-01-01')]]);
  const edges = [supports('sys-1', 'cap-1')];

  it('tileColourFor reads exposed without a replacement and clears with one', () => {
    expect(tileColourFor('metric:lifecycleExposure', 'cap-1', edges, systemsById)).toEqual({ tone: 'danger', label: 'end of life' });
    expect(tileColourFor('metric:lifecycleExposure', 'cap-1', edges, systemsById, new Set(['sys-1']))).toEqual({ tone: undefined, label: undefined });
  });

  it('aggregateTileColourFor clears the roll-up the same way', () => {
    expect(aggregateTileColourFor('metric:lifecycleExposure', ['cap-1'], edges, systemsById)).toEqual({ tone: 'danger', label: 'end of life' });
    expect(aggregateTileColourFor('metric:lifecycleExposure', ['cap-1'], edges, systemsById, new Set(['sys-1']))).toEqual({ tone: undefined, label: undefined });
  });
});

describe('replacedElementIds (ADR-001 amendment)', () => {
  it('collects the retiring side (to_element_id) of every replaces edge and ignores other edge types', () => {
    const replaces = (from: string, to: string): RelationshipsHeadRow => ({ ...supports(from, to), relationship_type: 'replaces' });
    expect([...replacedElementIds([replaces('new', 'old'), supports('sys', 'cap')])]).toEqual(['old']);
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

describe('worstFitForPurpose', () => {
  it('returns the worst (poor) rating among a capability\'s supporting edges', () => {
    const edges = [supports('sys-1', 'cap-1', 'good'), supports('sys-2', 'cap-1', 'poor')];
    expect(worstFitForPurpose('cap-1', edges)).toBe('poor');
  });

  it('ignores edges into other capabilities', () => {
    const edges = [supports('sys-1', 'cap-1', 'good'), supports('sys-2', 'cap-2', 'poor')];
    expect(worstFitForPurpose('cap-1', edges)).toBe('good');
  });

  it('returns null when no supporting edge has a recorded fitForPurpose', () => {
    expect(worstFitForPurpose('cap-1', [supports('sys-1', 'cap-1')])).toBeNull();
  });

  it('returns null for a capability with no supporting systems at all', () => {
    expect(worstFitForPurpose('cap-1', [])).toBeNull();
  });
});

describe('worstFitForPurposeOfSupporter', () => {
  it("returns the worst rating among a supporter's own outgoing supports edges", () => {
    const edges = [supports('sys-1', 'cap-1', 'good'), supports('sys-1', 'cap-2', 'poor')];
    expect(worstFitForPurposeOfSupporter('sys-1', edges)).toBe('poor');
  });

  it('ignores edges from other supporters', () => {
    const edges = [supports('sys-1', 'cap-1', 'good'), supports('sys-2', 'cap-1', 'poor')];
    expect(worstFitForPurposeOfSupporter('sys-1', edges)).toBe('good');
  });

  it('returns null when none of the supporter\'s own edges have a recorded fitForPurpose', () => {
    expect(worstFitForPurposeOfSupporter('sys-1', [supports('sys-1', 'cap-1')])).toBeNull();
  });

  it('returns null for a supporter with no outgoing supports edges at all', () => {
    expect(worstFitForPurposeOfSupporter('sys-1', [])).toBeNull();
  });
});

describe('weakFitSupportsEdges', () => {
  it('finds the edges into this capability rated poor or adequate, ignoring good/unrated edges and edges into other capabilities', () => {
    const edges = [supports('sys-1', 'cap-1', 'good'), supports('sys-2', 'cap-1', 'poor'), supports('sys-3', 'cap-1', 'adequate'), supports('sys-4', 'cap-2', 'poor'), supports('sys-5', 'cap-1')];
    expect(weakFitSupportsEdges('cap-1', edges).map((e) => e.from_element_id)).toEqual(['sys-2', 'sys-3']);
  });

  it('returns an empty array when nothing is rated poor or adequate', () => {
    expect(weakFitSupportsEdges('cap-1', [supports('sys-1', 'cap-1', 'good'), supports('sys-2', 'cap-1')])).toEqual([]);
  });
});

describe('fitAssessmentSupportsEdges', () => {
  it('returns the primary edge when the capability has one, with usedSecondaryFallback false', () => {
    const primaryEdge = supports('sys-1', 'cap-1', 'poor', 'primary');
    const result = fitAssessmentSupportsEdges('cap-1', [primaryEdge]);
    expect(result).toEqual({ edges: [primaryEdge], usedSecondaryFallback: false });
  });

  it('falls back to the secondary edge when the capability has no primary edge at all', () => {
    const secondaryEdge = supports('sys-1', 'cap-1', 'poor', 'secondary');
    const result = fitAssessmentSupportsEdges('cap-1', [secondaryEdge]);
    expect(result).toEqual({ edges: [secondaryEdge], usedSecondaryFallback: true });
  });

  it('returns only the primary edges, ignoring a secondary edge, once at least one primary edge exists', () => {
    const primaryEdge = supports('sys-1', 'cap-1', 'good', 'primary');
    const secondaryEdge = supports('sys-2', 'cap-1', 'poor', 'secondary');
    const result = fitAssessmentSupportsEdges('cap-1', [primaryEdge, secondaryEdge]);
    expect(result).toEqual({ edges: [primaryEdge], usedSecondaryFallback: false });
  });

  it('ignores edges into other capabilities', () => {
    const result = fitAssessmentSupportsEdges('cap-1', [supports('sys-1', 'cap-2', 'poor', 'primary')]);
    expect(result).toEqual({ edges: [], usedSecondaryFallback: true });
  });

  it('returns no edges (still usedSecondaryFallback true) for a capability with no supporting systems at all', () => {
    expect(fitAssessmentSupportsEdges('cap-1', [])).toEqual({ edges: [], usedSecondaryFallback: true });
  });
});

describe('otShareOf (Prompt 7k item 3)', () => {
  it('counts supporting systems whose domain resolves to ot, out of the total', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', undefined, undefined, undefined, 'ot')],
      ['sys-2', system('sys-2', undefined, undefined, undefined, 'it')],
      ['sys-3', system('sys-3')],
    ]);
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-1'), supports('sys-3', 'cap-1')];
    expect(otShareOf('cap-1', edges, systemsById)).toEqual({ ot: 1, total: 3 });
  });

  it('is {ot: 0, total: 0} for a capability with no supporting systems', () => {
    expect(otShareOf('cap-1', [], new Map())).toEqual({ ot: 0, total: 0 });
  });
});

describe('tileColourFor', () => {
  it('mode "none" never returns a tone or label', () => {
    expect(tileColourFor('none', 'cap-1', [supports('sys-1', 'cap-1')], new Map([['sys-1', system('sys-1', 'retired')]]))).toEqual({ tone: undefined, label: undefined });
  });

  it('flags zero supporting systems as a coverage gap (warn), any real count as plain neutral — the label states the tone in words, never the count, since LandscapeZoomLink already shows that unconditionally right beside it', () => {
    expect(tileColourFor('metric:supportingSystemCount', 'cap-1', [], new Map())).toEqual({ tone: 'warn', label: 'no supporting systems' });
    const edges = [supports('sys-1', 'cap-1')];
    expect(tileColourFor('metric:supportingSystemCount', 'cap-1', edges, new Map([['sys-1', system('sys-1')]]))).toEqual({ tone: 'neutral', label: 'supporting systems' });
  });

  it('never uses a status/danger tone for a merely-large supporting-system count', () => {
    const systemsById = new Map(Array.from({ length: 20 }, (_, i) => [`sys-${String(i)}`, system(`sys-${String(i)}`)] as const));
    const edges = [...systemsById.keys()].map((id) => supports(id, 'cap-1'));
    expect(tileColourFor('metric:supportingSystemCount', 'cap-1', edges, systemsById).tone).toBe('neutral');
  });

  it('colours by the oldest lifecycle stage using the same tone lifecycle chips use elsewhere', () => {
    const systemsById = new Map([['sys-1', system('sys-1', 'retired')]]);
    expect(tileColourFor('metric:oldestLifecycleStage', 'cap-1', [supports('sys-1', 'cap-1')], systemsById)).toEqual({ tone: 'danger', label: 'retired' });
  });

  it('colours lifecycle exposure danger only once a supporting system is actually exposed', () => {
    const soon = new Date();
    soon.setMonth(soon.getMonth() + 1);
    const exposedById = new Map([['sys-1', system('sys-1', 'retiring', soon.toISOString().slice(0, 10))]]);
    expect(tileColourFor('metric:lifecycleExposure', 'cap-1', [supports('sys-1', 'cap-1')], exposedById)).toEqual({ tone: 'danger', label: 'end of life' });

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

  it('OT share: shows the fraction, warn-toned, once at least one supporting system is OT (Prompt 7k item 3)', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', undefined, undefined, undefined, 'ot')],
      ['sys-2', system('sys-2')],
    ]);
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-1')];
    expect(tileColourFor('metric:otShare', 'cap-1', edges, systemsById)).toEqual({ tone: 'neutral', label: '1/2 systems OT' });
  });

  it('OT share: silent (no tone/label) when nothing supporting is OT — unlike coverage, zero is the ordinary case here', () => {
    const systemsById = new Map([['sys-1', system('sys-1')]]);
    expect(tileColourFor('metric:otShare', 'cap-1', [supports('sys-1', 'cap-1')], systemsById)).toEqual({ tone: undefined, label: undefined });
  });

  it('fit: colours by the worst-of fitForPurpose rating among supporting edges (poor → danger)', () => {
    const edges = [supports('sys-1', 'cap-1', 'adequate'), supports('sys-2', 'cap-1', 'poor')];
    expect(tileColourFor('metric:fitForPurpose', 'cap-1', edges, new Map())).toEqual({ tone: 'warn', label: 'poor' });
  });

  it('fit: no tone when no supporting edge has a recorded fitForPurpose', () => {
    expect(tileColourFor('metric:fitForPurpose', 'cap-1', [supports('sys-1', 'cap-1')], new Map())).toEqual({ tone: undefined, label: undefined });
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
    expect(aggregateTileColourFor('metric:lifecycleExposure', ['cap-safe', 'cap-exposed'], edges, systemsById)).toEqual({ tone: 'danger', label: 'end of life' });
  });

  it('exposure: an L1 whose only exposed capability sits at L3 still reads as exposed — the descendant list is the caller\'s own flattened L2+L3 ids, not just L2', () => {
    const soon = new Date();
    soon.setMonth(soon.getMonth() + 1);
    const systemsById = new Map([['sys-l3', system('sys-l3', 'retiring', soon.toISOString().slice(0, 10))]]);
    const edges = [supports('sys-l3', 'cap-l3-leaf')];
    // 'cap-l2' (the L2 parent) has no supporting system of its own at all —
    // only its L3 child ('cap-l3-leaf') does.
    expect(aggregateTileColourFor('metric:lifecycleExposure', ['cap-l2', 'cap-l3-leaf'], edges, systemsById)).toEqual({ tone: 'danger', label: 'end of life' });
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
    expect(aggregateTileColourFor('metric:oldestLifecycleStage', ['cap-1', 'cap-2'], edges, systemsById)).toEqual({ tone: 'danger', label: 'retired' });
  });

  it('coverage: fraction-supported, not worst-of-children — the tone reflects the real fraction, but the label states it in words, never the digits (`computeCapabilityRollup`\'s own supportedCapabilityCount/totalCapabilityCount is the one place that fraction is printed as a number, in the always-on group header line — this chip used to duplicate it)', () => {
    const systemsById = new Map([['sys-1', system('sys-1')]]);
    const edges = [supports('sys-1', 'cap-1')];
    expect(aggregateTileColourFor('metric:supportingSystemCount', ['cap-1', 'cap-2', 'cap-3'], edges, systemsById)).toEqual({ tone: 'neutral', label: 'capabilities supported' });
  });

  it('coverage: warn only when literally none of the group\'s descendants have a supporting system', () => {
    expect(aggregateTileColourFor('metric:supportingSystemCount', ['cap-1', 'cap-2'], [], new Map())).toEqual({ tone: 'warn', label: 'no capabilities supported' });
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

  it('OT share: sums across descendants, not worst-of (Prompt 7k item 3)', () => {
    const systemsById = new Map([
      ['sys-1', system('sys-1', undefined, undefined, undefined, 'ot')],
      ['sys-2', system('sys-2')],
      ['sys-3', system('sys-3', undefined, undefined, undefined, 'ot')],
    ]);
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-1'), supports('sys-3', 'cap-2')];
    expect(aggregateTileColourFor('metric:otShare', ['cap-1', 'cap-2'], edges, systemsById)).toEqual({ tone: 'neutral', label: '2/3 systems OT' });
  });

  it('OT share: silent when nothing in the group is OT', () => {
    const systemsById = new Map([['sys-1', system('sys-1')]]);
    expect(aggregateTileColourFor('metric:otShare', ['cap-1'], [supports('sys-1', 'cap-1')], systemsById)).toEqual({ tone: undefined, label: undefined });
  });

  it('fit: worst-of-children — one poor-rated edge on any descendant makes the whole group read as poor', () => {
    const edges = [supports('sys-1', 'cap-1', 'excellent'), supports('sys-2', 'cap-2', 'poor')];
    expect(aggregateTileColourFor('metric:fitForPurpose', ['cap-1', 'cap-2'], edges, new Map())).toEqual({ tone: 'warn', label: 'poor' });
  });

  it('fit: silent when nothing in the group has a recorded fitForPurpose', () => {
    expect(aggregateTileColourFor('metric:fitForPurpose', ['cap-1', 'cap-2'], [supports('sys-1', 'cap-1')], new Map())).toEqual({ tone: undefined, label: undefined });
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

describe('disposition colour-by (F11)', () => {
  function withDisposition(row: ElementsHeadRow, disposition: string): ElementsHeadRow {
    return { ...row, attributes: { ...(row.attributes as Record<string, Json>), disposition } };
  }
  function moduleOf(id: string, platformId: string, disposition?: string): ElementsHeadRow {
    const attrs: Record<string, Json> = disposition === undefined ? {} : { disposition };
    return { element_id: id, element_type: 'container', name: id, parent_id: platformId, attributes: attrs, exists_delta_id: `d-${id}` };
  }

  it('worst-of across supporting systems and modules: eliminate beats migrate beats tolerate beats invest', () => {
    const systemsById = new Map([
      ['sys-1', withDisposition(system('sys-1'), 'invest')],
      ['sys-2', withDisposition(system('sys-2'), 'tolerate')],
      ['mod-1', moduleOf('mod-1', 'sys-1', 'migrate')],
    ]);
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-1'), supports('mod-1', 'cap-1')];
    expect(worstDispositionOf('cap-1', edges, systemsById)).toBe('migrate');
    expect(tileColourFor('metric:disposition', 'cap-1', edges, systemsById)).toEqual({ tone: 'info', label: 'Move to another system' });
  });

  it('a module with no disposition of its own does not borrow its platform\'s', () => {
    const systemsById = new Map([
      ['sys-1', withDisposition(system('sys-1'), 'eliminate')],
      ['mod-1', moduleOf('mod-1', 'sys-1')],
    ]);
    expect(worstDispositionOf('cap-1', [supports('mod-1', 'cap-1')], systemsById)).toBeNull();
  });

  it('silent when nothing supporting is assessed — not assessed never reads as Tolerate', () => {
    const systemsById = new Map([['sys-1', system('sys-1')]]);
    expect(tileColourFor('metric:disposition', 'cap-1', [supports('sys-1', 'cap-1')], systemsById)).toEqual({ tone: undefined, label: undefined });
  });

  it('L1 aggregate: the worst across every descendant capability', () => {
    const systemsById = new Map([
      ['sys-1', withDisposition(system('sys-1'), 'invest')],
      ['sys-2', withDisposition(system('sys-2'), 'eliminate')],
    ]);
    const edges = [supports('sys-1', 'cap-l2'), supports('sys-2', 'cap-l3')];
    expect(aggregateTileColourFor('metric:disposition', ['cap-l2', 'cap-l3'], edges, systemsById)).toEqual({ tone: 'info', label: 'Switch off' });
  });
});

describe('AI share colour-by', () => {
  const agent = (id: string, aiAutonomy: string): ElementsHeadRow => ({ ...system(id), attributes: { isExternal: false, aiAutonomy } });
  const usesAi = (id: string, aiUse: string): ElementsHeadRow => ({ ...system(id), attributes: { isExternal: false, aiUse } });

  it('counts supporting systems that use AI, how many are agents, and the freest way any agent acts', () => {
    const systemsById = new Map([
      ['a', agent('a', 'suggests')],
      ['b', agent('b', 'acts_with_approval')],
      ['c', system('c')],
      ['d', usesAi('d', 'built_in')],
    ]);
    const edges = [supports('a', 'cap-1'), supports('b', 'cap-1'), supports('c', 'cap-1'), supports('d', 'cap-1')];
    expect(aiShareOf('cap-1', edges, systemsById)).toEqual({ using: 3, agents: 2, total: 4, worst: 'acts_with_approval' });
    expect(tileColourFor('metric:aiAgentShare', 'cap-1', edges, systemsById)).toEqual({ tone: 'warn', label: '3/4 AI · with approval' });
  });

  it('is a quiet neutral "n/m use AI" when AI is used but nothing is an agent', () => {
    const systemsById = new Map([['d', usesAi('d', 'external_service')], ['c', system('c')]]);
    expect(tileColourFor('metric:aiAgentShare', 'cap-1', [supports('d', 'cap-1'), supports('c', 'cap-1')], systemsById)).toEqual({ tone: 'neutral', label: '1/2 use AI' });
  });

  it('uses the strongest risk tone, with the words, for an agent that acts alone', () => {
    const systemsById = new Map([['a', agent('a', 'acts_alone')]]);
    expect(tileColourFor('metric:aiAgentShare', 'cap-1', [supports('a', 'cap-1')], systemsById)).toEqual({ tone: 'danger', label: '1/1 AI · acts alone' });
  });

  it('is silent when no supporting system uses AI, and for an unknown value', () => {
    const systemsById = new Map([['a', system('a')], ['b', agent('b', 'nonsense')], ['c', usesAi('c', 'nonsense')]]);
    expect(tileColourFor('metric:aiAgentShare', 'cap-1', [supports('a', 'cap-1'), supports('b', 'cap-1'), supports('c', 'cap-1')], systemsById)).toEqual({ tone: undefined, label: undefined });
  });

  it('sums across a group and takes the freest way any agent acts', () => {
    const systemsById = new Map([['a', agent('a', 'suggests')], ['b', agent('b', 'acts_alone')], ['c', system('c')], ['d', usesAi('d', 'built_in')]]);
    const edges = [supports('a', 'cap-1'), supports('c', 'cap-1'), supports('b', 'cap-2'), supports('d', 'cap-2')];
    expect(aggregateTileColourFor('metric:aiAgentShare', ['cap-1', 'cap-2'], edges, systemsById)).toEqual({ tone: 'danger', label: '3/4 AI · acts alone' });
  });
});

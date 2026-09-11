import { describe, expect, it } from 'vitest';
import { landscapeTileColourFor } from './landscapeColour';
import type { ElementsHeadRow, Json } from '../../contracts/rows';

function system(attributes: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: 'sys-1', element_type: 'system', name: 'System', parent_id: null, attributes, exists_delta_id: 'd-sys-1' };
}

describe('landscapeTileColourFor (Prompt 7k item 1)', () => {
  it('mode "none" never returns a tone or label', () => {
    expect(landscapeTileColourFor('none', system({ criticality: 'critical' }))).toEqual({ tone: undefined, label: undefined });
  });

  it('criticality: colours by the recorded value using the same tone table as the element page', () => {
    expect(landscapeTileColourFor('metric:criticality', system({ criticality: 'critical' }))).toEqual({ tone: 'danger', label: 'critical' });
    expect(landscapeTileColourFor('metric:criticality', system({ criticality: 'low' }))).toEqual({ tone: 'neutral', label: 'low' });
  });

  it('criticality: no tone when the system has no recorded criticality', () => {
    expect(landscapeTileColourFor('metric:criticality', system())).toEqual({ tone: undefined, label: undefined });
  });

  it('hosting model: every recorded value gets the same info tone — no "worst" hosting model exists', () => {
    expect(landscapeTileColourFor('metric:hostingModel', system({ hostingModel: 'saas' }))).toEqual({ tone: 'info', label: 'SaaS' });
    expect(landscapeTileColourFor('metric:hostingModel', system({ hostingModel: 'on_premises' }))).toEqual({ tone: 'info', label: 'on-premises' });
  });

  it('hosting model: no tone when the system has no recorded hosting model', () => {
    expect(landscapeTileColourFor('metric:hostingModel', system())).toEqual({ tone: undefined, label: undefined });
  });

  it('domain (Prompt 7k item 3): colours by the recorded domain, warn for ot, info for hybrid', () => {
    expect(landscapeTileColourFor('metric:domain', system({ domain: 'ot' }))).toEqual({ tone: 'warn', label: 'ot' });
    expect(landscapeTileColourFor('metric:domain', system({ domain: 'hybrid' }))).toEqual({ tone: 'info', label: 'hybrid' });
  });

  it('domain: is never silent, unlike criticality/hostingModel — an unrecorded system defaults to it', () => {
    expect(landscapeTileColourFor('metric:domain', system())).toEqual({ tone: 'neutral', label: 'it' });
  });
});

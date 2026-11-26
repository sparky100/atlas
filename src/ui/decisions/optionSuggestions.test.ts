import { describe, expect, it } from 'vitest';
import { suggestDecisionTitle, suggestOptions } from './optionSuggestions';
import type { EstateSupporter } from './estateUncertainty';

const sys = (name: string, over: Partial<EstateSupporter> = {}): EstateSupporter => ({ name, fit: null, fitNote: null, plannedEnd: null, ...over });

describe('suggestOptions', () => {
  it('suggests extending each system that already supports it, then buy and build', () => {
    const out = suggestOptions(['Billing'], [sys('SAP IS-U'), sys('DUoS Billing Engine')]);
    expect(out.map((o) => o.title)).toEqual(['Extend DUoS Billing Engine to cover this', 'Extend SAP IS-U to cover this', 'Buy or adopt a new product', 'Build it ourselves']);
    expect(out[0]?.reason).toBe('DUoS Billing Engine already supports Billing.');
  });
  it('always offers buy and build, even when nothing supports it', () => {
    expect(suggestOptions(['Billing'], []).map((o) => o.title)).toEqual(['Buy or adopt a new product', 'Build it ourselves']);
  });
  it('lists a system once and caps how many it names', () => {
    const many = Array.from({ length: 9 }, (_, i) => `System ${String(i)}`);
    expect(suggestOptions(['A'], [...many, 'System 1'].map((n) => sys(n)))).toHaveLength(5 + 2);
  });
});

describe('estate uncertainty', () => {
  const now = new Date('2026-11-26T00:00:00Z');
  const read = (s: EstateSupporter) => suggestOptions(['Connect a new customer'], [s], now)[0];
  it('names what is not recorded and warns when fit is unrated', () => {
    const r = read(sys('CRM'));
    expect(r?.reading?.notRecorded).toEqual(['how well it fits is not rated', 'no end of support is recorded']);
    expect(r?.reading?.check).toBe(true);
    expect(r?.text).toContain('Atlas cannot see capacity or data fit');
  });
  it('shows a rated fit with its note and no warning when fine and no end is near', () => {
    const r = read(sys('CRM', { fit: 'good', fitNote: 'Quotes by hand', plannedEnd: new Date('2031-01-01T00:00:00Z') }));
    expect(r?.reading?.known).toEqual(['fit rated Good: Quotes by hand', 'support ends Jan 2031']);
    expect(r?.reading?.check).toBe(false);
  });
  it('warns on poor fit and on support ending within the stale threshold or already past', () => {
    expect(read(sys('A', { fit: 'poor' }))?.reading?.check).toBe(true);
    expect(read(sys('B', { fit: 'good', plannedEnd: new Date('2027-03-01T00:00:00Z') }))?.reading?.check).toBe(true);
    const past = read(sys('C', { fit: 'good', plannedEnd: new Date('2025-01-01T00:00:00Z') }));
    expect(past?.reading?.known).toContain('support ended Jan 2025');
    expect(past?.reading?.check).toBe(true);
  });
  it('never removes an option, and says Buy and Build are a judgement', () => {
    const out = suggestOptions(['X'], [sys('CRM', { fit: 'poor' })], now);
    expect(out.map((o) => o.approach)).toEqual(['configure', 'buy', 'build']);
    expect(out[1]?.reading).toBeNull();
    expect(out[1]?.text).toContain('it is a judgement');
  });
});

describe('suggestDecisionTitle', () => {
  it('asks about the one system in scope, else the one capability, else leaves it to the person', () => {
    expect(suggestDecisionTitle(['DUoS Billing Engine'], ['Billing'])).toBe('Keep, replace or retire DUoS Billing Engine?');
    expect(suggestDecisionTitle([], ['Billing'])).toBe('How should we meet Billing?');
    expect(suggestDecisionTitle(['A', 'B'], ['X', 'Y'])).toBe('');
  });
});

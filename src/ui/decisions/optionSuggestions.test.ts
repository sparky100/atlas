import { describe, expect, it } from 'vitest';
import { suggestDecisionTitle, suggestOptions } from './optionSuggestions';

describe('suggestOptions', () => {
  it('suggests extending each system that already supports it, then buy and build', () => {
    const out = suggestOptions(['Billing'], ['SAP IS-U', 'DUoS Billing Engine']);
    expect(out.map((o) => o.title)).toEqual(['Extend DUoS Billing Engine to cover this', 'Extend SAP IS-U to cover this', 'Buy or adopt a new product', 'Build it ourselves']);
    expect(out[0]?.reason).toBe('DUoS Billing Engine already supports Billing.');
  });
  it('always offers buy and build, even when nothing supports it', () => {
    expect(suggestOptions(['Billing'], []).map((o) => o.title)).toEqual(['Buy or adopt a new product', 'Build it ourselves']);
  });
  it('lists a system once and caps how many it names', () => {
    const many = Array.from({ length: 9 }, (_, i) => `System ${String(i)}`);
    expect(suggestOptions(['A'], [...many, 'System 1'])).toHaveLength(5 + 2);
  });
});

describe('suggestDecisionTitle', () => {
  it('asks about the one system in scope, else the one capability, else leaves it to the person', () => {
    expect(suggestDecisionTitle(['DUoS Billing Engine'], ['Billing'])).toBe('Keep, replace or retire DUoS Billing Engine?');
    expect(suggestDecisionTitle([], ['Billing'])).toBe('How should we meet Billing?');
    expect(suggestDecisionTitle(['A', 'B'], ['X', 'Y'])).toBe('');
  });
});

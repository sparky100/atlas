import { describe, expect, it } from 'vitest';
import { buildResearchQuery, cleanChip, suggestResearchQuery } from './researchQuerySuggestion';

const scoringContext = {
  optionLabel: 'Exploring: Meter-to-cash',
  decisionTitle: 'Meter-to-cash',
  capabilityNames: ['Utility billing software'],
  productNames: ['Oracle Utilities Customer Care and Billing'],
  vendorNames: ['Oracle'],
};

describe('cleanChip', () => {
  it('strips the intent prefix and a leading "Use "', () => {
    expect(cleanChip('Exploring: Replace the ledger')).toBe('Replace the ledger');
    expect(cleanChip('Use Oracle Utilities')).toBe('Oracle Utilities');
  });

  it('keeps a chip on one line and bounds its length', () => {
    expect(cleanChip('  a\n b  ')).toBe('a b');
    expect(cleanChip('x'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe('suggestResearchQuery', () => {
  it('scores a named product, using its vendor, the capability and the scoring terms', () => {
    const suggestion = suggestResearchQuery(scoringContext);
    expect(suggestion.intent).toBe('score-product');
    expect(suggestion.productName).toBe('Oracle Utilities Customer Care and Billing');
    expect(suggestion.productOptions).toEqual(['Oracle Utilities Customer Care and Billing']);
    expect(suggestion.chips).toEqual([
      'Oracle Utilities Customer Care and Billing',
      'Oracle',
      'Utility billing software',
      'Meter-to-cash',
      'pricing',
      'implementation',
      'support',
      'integrations',
      'roadmap',
    ]);
    expect(suggestion.query).toBe(suggestion.chips.join(' '));
    expect(suggestion.query).not.toContain('software products that support');
  });

  it('runs a market scan when no product is named', () => {
    const suggestion = suggestResearchQuery({
      optionLabel: 'Replace with a product',
      decisionTitle: 'Billing',
      capabilityNames: ['Utility billing software'],
    });
    expect(suggestion.intent).toBe('find-products');
    expect(suggestion.productName).toBeNull();
    expect(suggestion.productOptions).toEqual([]);
    expect(suggestion.chips).toEqual(['Utility billing software']);
    expect(suggestion.query).toBe('software products that support Utility billing software');
  });

  it('treats a "Use <product>" option title as the named product', () => {
    const suggestion = suggestResearchQuery({
      optionLabel: 'Use Xylem Vue',
      decisionTitle: 'Water network monitoring',
      capabilityNames: ['Water network monitoring'],
    });
    expect(suggestion.intent).toBe('score-product');
    expect(suggestion.productName).toBe('Xylem Vue');
    expect(suggestion.productOptions).toEqual(['Xylem Vue']);
    expect(suggestion.chips[0]).toBe('Xylem Vue');
    expect(suggestion.query).toContain('pricing');
  });

  it('offers both structured products and scores the chosen one with its own vendor', () => {
    const suggestion = suggestResearchQuery({
      optionLabel: 'Replace with a product',
      decisionTitle: '',
      capabilityNames: ['Billing'],
      optionProducts: [
        { product: 'Alpha Billing', vendor: 'Alpha Ltd' },
        { product: 'Beta Billing', vendor: 'Beta Ltd' },
      ],
    });
    expect(suggestion.productOptions).toEqual(['Alpha Billing', 'Beta Billing']);
    expect(suggestion.productName).toBe('Alpha Billing');
    expect(suggestion.chips).toEqual(expect.arrayContaining(['Alpha Billing', 'Alpha Ltd']));

    const chosen = suggestResearchQuery({
      optionLabel: 'Replace with a product',
      decisionTitle: '',
      capabilityNames: ['Billing'],
      optionProducts: [
        { product: 'Alpha Billing', vendor: 'Alpha Ltd' },
        { product: 'Beta Billing', vendor: 'Beta Ltd' },
      ],
      selectedProductName: 'Beta Billing',
    });
    expect(chosen.productName).toBe('Beta Billing');
    expect(chosen.chips).toEqual(expect.arrayContaining(['Beta Billing', 'Beta Ltd']));
    expect(chosen.chips).not.toContain('Alpha Billing');
  });

  it('never exceeds the Researcher limit, dropping whole chips from the end', () => {
    const long = 'a'.repeat(150);
    const suggestion = suggestResearchQuery({
      optionLabel: long,
      decisionTitle: long,
      capabilityNames: [long],
      productNames: [long],
    });
    expect(suggestion.query.length).toBeLessThanOrEqual(300);
    expect(suggestion.query.endsWith(' ')).toBe(false);
  });
});

describe('buildResearchQuery', () => {
  it('joins the chips in the given order for a scoring search', () => {
    expect(buildResearchQuery(['Capability', 'Option', 'Vendor'])).toBe('Capability Option Vendor');
  });

  it('builds a market-scan phrase rather than a bare list', () => {
    expect(buildResearchQuery(['Capability', 'Option'], 'find-products')).toBe('software products that support Capability Option');
    expect(buildResearchQuery([], 'find-products')).toBe('software products');
  });

  it('returns an empty string when nothing is safe to suggest', () => {
    expect(buildResearchQuery(['', '  '])).toBe('');
  });
});

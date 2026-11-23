import { describe, expect, it } from 'vitest';
import { buildResearchQuery, cleanChip, suggestResearchQuery } from './researchQuerySuggestion';

const context = {
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
  it('suggests capability, product, vendor and the option name, without repeating the decision title', () => {
    const suggestion = suggestResearchQuery(context);
    expect(suggestion.chips).toEqual([
      'Utility billing software',
      'Meter-to-cash',
      'Oracle Utilities Customer Care and Billing',
      'Oracle',
    ]);
    expect(suggestion.query).toBe('Utility billing software Meter-to-cash Oracle Utilities Customer Care and Billing Oracle');
  });

  it('drops a generic option label but keeps the capability', () => {
    const suggestion = suggestResearchQuery({
      optionLabel: 'Replace with a product',
      decisionTitle: 'Billing',
      capabilityNames: ['Utility billing software'],
    });
    expect(suggestion.chips).toEqual(['Utility billing software']);
  });

  it('deduplicates case-insensitively and ignores empty names', () => {
    const suggestion = suggestResearchQuery({
      optionLabel: 'Oracle',
      decisionTitle: '',
      capabilityNames: [' oracle ', ''],
      productNames: ['ORACLE'],
    });
    expect(suggestion.chips).toEqual(['oracle']);
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
  it('joins the chips in the given order', () => {
    expect(buildResearchQuery(['Capability', 'Option', 'Vendor'])).toBe('Capability Option Vendor');
  });

  it('returns an empty string when nothing is safe to suggest', () => {
    expect(buildResearchQuery(['', '  '])).toBe('');
  });
});

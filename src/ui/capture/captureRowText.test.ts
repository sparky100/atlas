import { describe, expect, it } from 'vitest';
import { newAliasValues, sameName } from './captureRowText';

describe('sameName', () => {
  it('ignores case, spacing and surrounding space', () => {
    expect(sameName('SAP  PM', ' sap pm ')).toBe(true);
    expect(sameName('Billing', 'Billing System')).toBe(false);
  });
});

describe('newAliasValues', () => {
  it('drops values that only repeat a name already on the row', () => {
    expect(newAliasValues(['Billing', 'INV'], ['billing', 'Invoicer'])).toEqual(['INV']);
    expect(newAliasValues(['Billing'], ['Billing'])).toEqual([]);
  });
  it('keeps everything when nothing repeats', () => {
    expect(newAliasValues(['INV-1'], ['Invoicer'])).toEqual(['INV-1']);
  });
});

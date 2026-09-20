import { describe, expect, it } from 'vitest';
import { normaliseName } from './normalise';

describe('normaliseName', () => {
  it('lowercases and trims', () => {
    expect(normaliseName('  Legacy CRM  ')).toBe('legacy crm');
  });

  it('replaces "&" with "and"', () => {
    expect(normaliseName('Sales & Marketing')).toBe('sales and marketing');
  });

  it('collapses any run of non-alphanumerics into one space', () => {
    expect(normaliseName('Widget-Co., Ltd.')).toBe('widget co ltd');
  });

  it('drops a leading "the "', () => {
    expect(normaliseName('The Legacy CRM')).toBe('legacy crm');
  });

  it('does not drop "the" when it is not a leading word', () => {
    expect(normaliseName('Not the Legacy CRM')).toBe('not the legacy crm');
  });

  it('strips diacritics', () => {
    expect(normaliseName('Café Système')).toBe('cafe systeme');
  });

  it('treats visually-equivalent forms the same (NFKC)', () => {
    // U+FB01 LATIN SMALL LIGATURE FI vs the plain two-character "fi".
    expect(normaliseName('ﬁle Server')).toBe(normaliseName('file Server'));
  });

  it('two names differing only by case/punctuation/leading "the" normalise identically', () => {
    expect(normaliseName('The Widget-Co.')).toBe(normaliseName('widget co'));
  });
});

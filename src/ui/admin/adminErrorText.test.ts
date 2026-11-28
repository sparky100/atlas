import { describe, expect, it } from 'vitest';
import { catalogueProductContentSchema } from '../../contracts/catalogueAdmin';
import { errorText } from './adminErrorText';

const product = { code: 'test-product', product: 'Test', vendor: 'Vendor', summary: 'Summary', capabilities: [], claims: [] };
const claim = { position: 1, kind: 'functional' as const, statement: 'The vendor describes it.', sourceUrl: 'https://example.test/page', sourceDate: '2026-11-28' };

function failure(content: unknown): string {
  const result = catalogueProductContentSchema.safeParse(content);
  if (result.success) throw new Error('expected the content to be refused');
  return errorText(result.error);
}

describe('admin error text', () => {
  it('says what to do about an empty claim, once per field, with no JSON', () => {
    const text = failure({ ...product, claims: [claim, claim, { ...claim, position: 3, statement: '', sourceUrl: '' }] });
    expect(text).toContain('Claim 3, Statement: write what the vendor says.');
    expect(text).toContain('Claim 3, Source link: add the web address of the page that says it.');
    expect(text.match(/Claim 3, Statement/g)).toHaveLength(1);
    expect(text).not.toMatch(/[{}[\]"]|too_small|inclusive/);
  });

  it('tells a price from an empty statement, and a bad link from a missing one', () => {
    expect(failure({ ...product, claims: [{ ...claim, statement: 'It costs £500 a month.' }] })).toContain('take the price out');
    expect(failure({ ...product, claims: [{ ...claim, sourceUrl: 'http://example.test:8080/x' }] })).toContain('starts with https://');
  });

  it('explains a bad stable code and passes a plain error message through', () => {
    expect(failure({ ...product, code: 'Bad Code' })).toBe('Stable code: use lowercase letters, numbers and hyphens, at least two characters.');
    expect(errorText(new Error('That product is no longer available.'))).toBe('That product is no longer available.');
    expect(errorText('plain')).toBe('plain');
  });
});

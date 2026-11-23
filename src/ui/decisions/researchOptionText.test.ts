import { describe, expect, it } from 'vitest';
import { RESEARCH_OPTION_TITLE_MAX, researchOptionDescription, researchOptionTitle } from './researchOptionText';

const candidate = {
  title: 'Oracle Utilities Customer Care and Billing',
  publisher: 'oracle.com',
  excerpt: 'Utilities can manage customer care and billing in one product.',
  url: 'https://www.oracle.com/utilities/customer-care/',
};

describe('researchOptionTitle', () => {
  it('names the option after the page, without an intent prefix', () => {
    expect(researchOptionTitle(candidate)).toBe('Use Oracle Utilities Customer Care and Billing');
  });

  it('collapses whitespace and bounds the title without cutting mid-word', () => {
    const title = researchOptionTitle({ title: `${'word '.repeat(40)}end` });
    expect(title.length).toBeLessThanOrEqual(RESEARCH_OPTION_TITLE_MAX);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toContain('  ');
  });
});

describe('researchOptionDescription', () => {
  it('says what the page is, that it is unreviewed, and where to read it', () => {
    const text = researchOptionDescription(candidate);
    expect(text).toContain('Oracle Utilities Customer Care and Billing — oracle.com.');
    expect(text).toContain('Unreviewed web source found by search.');
    expect(text).toContain('Utilities can manage customer care and billing in one product.');
    expect(text).toContain(candidate.url);
  });

  it('still carries the URL when there is no excerpt and no publisher', () => {
    const text = researchOptionDescription({ title: 'A page', publisher: '', excerpt: null, url: 'https://example.com/a' });
    expect(text).toContain('A page — https://example.com/a.');
    expect(text).not.toContain('What the page says');
  });
});

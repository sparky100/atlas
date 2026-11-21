import { describe, expect, it } from 'vitest';
import { catalogueAsOf, formatCatalogueDate, sourceDomain } from './capabilityProductsText';

describe('catalogue entry text', () => {
  it('takes the latest source date across the claims', () => {
    expect(catalogueAsOf({ claims: [{ sourceDate: '2026-11-01' }, { sourceDate: '2026-11-21' }] } as never)).toBe('2026-11-21');
    expect(catalogueAsOf({ claims: [] })).toBeNull();
  });

  it('shows a source host without www', () => {
    expect(sourceDomain('https://www.oracle.com/utilities/customer-care-and-billing/')).toBe('oracle.com');
    expect(sourceDomain('https://kraken.tech/')).toBe('kraken.tech');
    expect(sourceDomain('not a url')).toBe('not a url');
  });

  it('formats an ISO date in UTC, so the day never shifts', () => {
    expect(formatCatalogueDate('2026-11-21')).toBe('21 Nov 2026');
  });
});

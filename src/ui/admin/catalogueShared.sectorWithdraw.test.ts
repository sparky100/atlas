import { describe, expect, it } from 'vitest';
import { entriesNotYetPublished } from './catalogueShared';

describe('entriesNotYetPublished', () => {
  const salesforce = { vendor: 'Salesforce', product: 'Energy and Utilities Cloud' };
  const microsoft = { vendor: 'Microsoft', product: 'Dynamics 365 Customer Service' };
  const entries = [salesforce, microsoft];

  it('lists entries no published product matches, ignoring case and spacing', () => {
    expect(entriesNotYetPublished(entries, [{ vendor: ' microsoft ', product: 'dynamics 365 customer service' }])).toEqual([salesforce]);
  });

  it('lists every entry when nothing is published, and none when all are', () => {
    expect(entriesNotYetPublished(entries, [])).toEqual(entries);
    expect(entriesNotYetPublished(entries, entries)).toEqual([]);
  });

  it('does not treat the same product name from another vendor as a match', () => {
    expect(entriesNotYetPublished([salesforce], [{ vendor: 'Other', product: 'Energy and Utilities Cloud' }])).toEqual([salesforce]);
  });
});

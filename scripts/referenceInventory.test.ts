import { describe, expect, it } from 'vitest';
import { catalogueFingerprint, mapItemFingerprint, reconcile, type Inventory } from './referenceInventory';

describe('reference content inventory', () => {
  it('fingerprints content independently of row order and flags a substantive change', () => {
    const first = { code: '1', parent: null, name: 'Contact', description: null, level: 1, order: 10 };
    const second = { code: '1.1', parent: '1', name: 'Cases', description: 'Track cases', level: 2, order: 20 };
    expect(mapItemFingerprint([first, second])).toBe(mapItemFingerprint([second, first]));
    expect(mapItemFingerprint([first, second])).not.toBe(mapItemFingerprint([first, { ...second, name: 'Requests' }]));

    const claim = { position: 1, kind: 'functional', statement: 'Has cases', url: 'https://example.org', date: '2026-11-21' };
    const entry = { code: 'crm', product: 'CRM', vendor: 'Vendor', summary: 'Cases',
      supports: [{ code: '1.1', name: 'Cases', how: 'Tracks them' }, { code: '1', name: 'Contact', how: 'Receives them' }],
      claims: [claim] };
    expect(catalogueFingerprint([entry])).toBe(catalogueFingerprint([{ ...entry, supports: [...entry.supports].reverse() }]));
    expect(catalogueFingerprint([entry])).not.toBe(catalogueFingerprint([{ ...entry, claims: [{ ...claim, statement: 'May have cases' }] }]));
  });

  it('reports missing, extra, differing and differently published versions without changing them', () => {
    const map = { sector: 'electricity_network', version: 4, status: 'draft', itemCount: 1,
      sourceCount: 1, valueStreamCount: 0, itemFingerprint: 'original', referenceFingerprint: 'original' };
    const catalogue = { sector: 'electricity_network', version: 1, capabilityMapVersion: 4,
      status: 'draft', entryCount: 1, supportCount: 1, claimCount: 1, contentFingerprint: 'original' };
    const repository: Inventory = { maps: [map], catalogues: [catalogue], sharedCapabilityCandidates: [], duplicateProductCandidates: [] };
    expect(reconcile(repository, {
      maps: [{ ...map, status: 'published', itemFingerprint: 'changed' }, { ...map, sector: 'utility' }],
      catalogues: [{ ...catalogue, status: 'published' }, { ...catalogue, sector: 'housing' }],
    })).toEqual({
      maps: ['map electricity_network v4: repository draft, live published', 'map electricity_network v4: content differs', 'map utility v4: live only'],
      catalogues: ['catalogue electricity_network v1: repository draft, live published', 'catalogue housing v1: live only'],
    });
  });
});

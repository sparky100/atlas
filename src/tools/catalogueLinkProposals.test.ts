import { describe, expect, it } from 'vitest';
import { capabilitiesWithoutProduct, proposalFromFound, proposeLinks, setCounts, type ProductLinkRow, type ProposalSet } from './catalogueLinkProposals';

const v3: ProposalSet = { id: 'm3', sector: 'electricity_network', version: 3, title: 'Electricity network' };
const v4: ProposalSet = { id: 'm4', sector: 'electricity_network', version: 4, title: 'Electricity network' };
const water: ProposalSet = { id: 'mw', sector: 'water_wastewater', version: 1, title: 'Water' };
const sets = [v3, v4, water];
const hub = { id: 'p1', product: 'Meter hub', vendor: 'Acme' };
const link = (over: Partial<ProductLinkRow> = {}): ProductLinkRow => ({ productId: 'p1', mapId: 'm3', code: '12.2.1', name: 'Smart meter data management', howItSupports: 'Validates reads.', ...over });
const items = [{ code: '12.2.1', name: 'Smart metering data' }, { code: '12.3', name: 'Outage management' }, { code: '2', name: 'Finance' }];

describe('proposeLinks', () => {
  it('proposes by the same code in another version of the same sector, and says why', () => {
    const out = proposeLinks(v4, items, [hub], [link()], sets, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ productId: 'p1', code: '12.2.1', name: 'Smart metering data', howItSupports: 'Validates reads.' });
    expect(out[0]?.why).toContain('same code (12.2.1)');
    expect(out[0]?.why).toContain('Smart meter data management');
  });
  it('proposes by the same name in any set, even another sector, ignoring case and spacing', () => {
    const out = proposeLinks(v4, items, [hub], [link({ mapId: 'mw', code: '13.1', name: ' outage  MANAGEMENT ' })], sets, []);
    expect(out.map((p) => p.code)).toEqual(['12.3']);
    expect(out[0]?.why).toContain('same name');
  });
  it('does not propose a code match from a different sector', () => {
    expect(proposeLinks(v4, items, [hub], [link({ mapId: 'mw' })], sets, [])).toEqual([]);
  });
  it('skips what is already linked in this set, general capabilities and rejected pairs', () => {
    expect(proposeLinks(v4, items, [hub], [link(), link({ mapId: 'm4', code: '12.2.1', name: 'Smart metering data' })], sets, [])).toEqual([]);
    expect(proposeLinks(v4, items, [hub], [link({ code: '2', name: 'Finance' })], sets, [])).toEqual([]);
    expect(proposeLinks(v4, items, [hub], [link()], sets, [{ productId: 'p1', mapId: 'm4', code: '12.2.1', name: 'Smart metering data' }])).toEqual([]);
    // A rejection holds for the same name in a later version too.
    expect(proposeLinks(v4, items, [hub], [link()], sets, [{ productId: 'p1', mapId: 'm3', code: '12.2.1', name: 'smart metering data' }])).toEqual([]);
  });
});

describe('capabilitiesWithoutProduct and setCounts', () => {
  it('lists the capabilities nothing is linked to and counts them', () => {
    const links = [link({ mapId: 'm4', code: '12.2.1' })];
    expect(capabilitiesWithoutProduct(v4, items, links).map((i) => i.code)).toEqual(['12.3']);
    expect(setCounts(v4, items, links, [])).toEqual({ capabilities: 2, withProduct: 1, without: 1, proposed: 0 });
  });
});

describe('proposalFromFound', () => {
  const found = { productId: 'p1', product: 'Meter hub', vendor: 'Acme', howItSupports: 'It does.' };
  it('proposes a link for a product found again, unless linked or rejected', () => {
    expect(proposalFromFound(found, { code: '12.3', name: 'Outage management' }, v4, [], [])?.why).toContain('found this product again');
    expect(proposalFromFound(found, { code: '12.3', name: 'Outage management' }, v4, [link({ mapId: 'm4', code: '12.3', name: 'Outage management' })], [])).toBeNull();
    expect(proposalFromFound(found, { code: '12.3', name: 'Outage management' }, v4, [], [{ productId: 'p1', mapId: 'm4', code: '12.3', name: 'Outage management' }])).toBeNull();
  });
});

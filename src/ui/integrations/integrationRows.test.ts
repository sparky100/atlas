import { describe, expect, it } from 'vitest';
import type { Json, RelationshipsHeadRow } from '../../contracts/rows';
import { fakeElement } from '../portfolio/portfolioTestFixtures';
import { DEFAULT_INTEGRATION_FILTERS, filterIntegrationRows, groupIntegrationRows, sortIntegrationRows } from './integrationFilter';
import { buildIntegrationRows } from './integrationRows';

const mule = fakeElement('mule', 'system', { kind: 'integration_platform' });
const boomi = fakeElement('boomi', 'system', { kind: 'integration_platform' });
const customerApi = { ...fakeElement('customer-api', 'container', { interfaceType: 'api', transformation: 'Merges A and B' }), parent_id: 'mule' };
const a = fakeElement('A');
const b = fakeElement('B');
const c = fakeElement('C');
const elements = new Map([mule, boomi, customerApi, a, b, c].map((e) => [e.element_id, e]));

function link(id: string, type: 'uses' | 'flows_to', from: string, to: string, attributes: Record<string, Json> = {}): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: type, from_element_id: from, to_element_id: to, attributes, exists_delta_id: `d-${id}` };
}

const links = [
  link('direct', 'uses', 'A', 'B', { protocol: 'rest_api' }),
  link('platform-only', 'flows_to', 'A', 'C', { via: 'boomi', dataClassification: 'official' }),
  link('interface', 'flows_to', 'B', 'C', { via: 'customer-api', protocolIn: 'file_sftp', protocolOut: 'rest_api', dataClassification: 'official_sensitive' }),
];

describe('buildIntegrationRows', () => {
  const rows = buildIntegrationRows(links, elements);
  const byId = (id: string) => rows.find((r) => r.relationshipId === id);

  it('makes one row per link, direct ones included', () => {
    expect(rows).toHaveLength(3);
    expect(byId('direct')).toMatchObject({ routing: 'direct', platform: null, integrationInterface: null, protocol: 'REST API' });
  });

  it('names the platform for a platform-only link, with no interface', () => {
    expect(byId('platform-only')).toMatchObject({ routing: 'platform', integrationInterface: null });
    expect(byId('platform-only')?.platform?.element_id).toBe('boomi');
  });

  it("resolves an interface's platform, type and transformation", () => {
    const row = byId('interface');
    expect(row).toMatchObject({ routing: 'interface', interfaceTypeLabel: 'API', transformation: 'Merges A and B', protocol: 'File (SFTP) in → REST API out' });
    expect(row?.platform?.element_id).toBe('mule');
  });

  it('treats a via that no longer resolves as direct, and skips a link with a missing endpoint', () => {
    const odd = buildIntegrationRows([link('gone', 'uses', 'A', 'B', { via: 'missing' }), link('orphan', 'uses', 'A', 'nobody')], elements);
    expect(odd.map((r) => [r.relationshipId, r.routing])).toEqual([['gone', 'direct']]);
  });

  it('ignores relationship types other than uses and flows_to', () => {
    expect(buildIntegrationRows([{ ...link('x', 'uses', 'A', 'B'), relationship_type: 'supports' }], elements)).toEqual([]);
  });
});

describe('filterIntegrationRows', () => {
  const rows = buildIntegrationRows(links, elements);
  const ids = (filtered: typeof rows) => filtered.map((r) => r.relationshipId);

  it('filters by routing and platform', () => {
    expect(ids(filterIntegrationRows(rows, { ...DEFAULT_INTEGRATION_FILTERS, routing: 'direct' }))).toEqual(['direct']);
    expect(ids(filterIntegrationRows(rows, { ...DEFAULT_INTEGRATION_FILTERS, platform: 'mule' }))).toEqual(['interface']);
  });

  it('hides direct links when a platform is chosen', () => {
    expect(ids(filterIntegrationRows(rows, { ...DEFAULT_INTEGRATION_FILTERS, platform: 'boomi' }))).toEqual(['platform-only']);
  });

  it('gapsOnly keeps links missing a protocol or a classification', () => {
    expect(ids(filterIntegrationRows(rows, { ...DEFAULT_INTEGRATION_FILTERS, gapsOnly: true }))).toEqual(['direct', 'platform-only']);
  });
});

describe('sortIntegrationRows and groupIntegrationRows', () => {
  const rows = buildIntegrationRows(links, elements);

  it('sorts direct links after every platform by platform, in both directions', () => {
    expect(sortIntegrationRows(rows, 'platform', 'asc').map((r) => r.relationshipId)).toEqual(['platform-only', 'interface', 'direct']);
    expect(sortIntegrationRows(rows, 'platform', 'desc').map((r) => r.relationshipId)).toEqual(['interface', 'platform-only', 'direct']);
  });

  it('groups by platform with the Direct group last', () => {
    const groups = groupIntegrationRows(sortIntegrationRows(rows, 'platform', 'asc'));
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([['boomi', 1], ['mule', 1], ['Direct (no platform)', 1]]);
  });
});

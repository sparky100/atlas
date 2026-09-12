import { describe, expect, it } from 'vitest';
import { isPrimaryOutboundSupportsRow, otherPrimaryCandidates, relationshipRemovalEffectSentence } from './relationshipRemovalEffect';
import type { Json, RelationshipsHeadRow } from '../../../contracts/rows';

function row(id: string, attributes: Record<string, Json> = {}): RelationshipsHeadRow {
  return {
    relationship_id: id,
    relationship_type: 'supports',
    from_element_id: 'anchor',
    to_element_id: `cap-${id}`,
    attributes,
    exists_delta_id: `delta-${id}`,
  };
}

describe('relationshipRemovalEffectSentence ("relationship removal")', () => {
  it("matches the prompt's own worked example exactly", () => {
    expect(relationshipRemovalEffectSentence('supports', 'outbound', 'ArcGIS', 'Asset Management')).toBe('ArcGIS will no longer support Asset Management.');
  });

  it('reads correctly for every relationship type, outbound', () => {
    expect(relationshipRemovalEffectSentence('owns', 'outbound', 'Finance Team', 'Billing')).toBe('Finance Team will no longer own Billing.');
    expect(relationshipRemovalEffectSentence('uses', 'outbound', 'System A', 'System B')).toBe('System A will no longer use System B.');
    expect(relationshipRemovalEffectSentence('flows_to', 'outbound', 'System A', 'System B')).toBe('System A will no longer flow to System B.');
  });

  it('reads correctly for every relationship type, inbound', () => {
    expect(relationshipRemovalEffectSentence('supports', 'inbound', 'Asset Management', 'ArcGIS')).toBe('Asset Management will no longer be supported by ArcGIS.');
    expect(relationshipRemovalEffectSentence('owns', 'inbound', 'Billing', 'Finance Team')).toBe('Billing will no longer be owned by Finance Team.');
    expect(relationshipRemovalEffectSentence('uses', 'inbound', 'System B', 'System A')).toBe('System B will no longer be used by System A.');
    expect(relationshipRemovalEffectSentence('flows_to', 'inbound', 'System B', 'System A')).toBe('System B will no longer receive from System A.');
  });
});

describe('isPrimaryOutboundSupportsRow', () => {
  it('is true only for an outbound supports row with role: primary', () => {
    expect(isPrimaryOutboundSupportsRow('supports', 'outbound', row('r1', { role: 'primary' }))).toBe(true);
  });

  it('is false for a secondary supports row', () => {
    expect(isPrimaryOutboundSupportsRow('supports', 'outbound', row('r1', { role: 'secondary' }))).toBe(false);
  });

  it('is false for the inbound side, even with role: primary', () => {
    expect(isPrimaryOutboundSupportsRow('supports', 'inbound', row('r1', { role: 'primary' }))).toBe(false);
  });

  it('is false for every non-supports relationship type', () => {
    expect(isPrimaryOutboundSupportsRow('owns', 'outbound', row('r1', { role: 'primary' }))).toBe(false);
    expect(isPrimaryOutboundSupportsRow('uses', 'outbound', row('r1', { role: 'primary' }))).toBe(false);
  });
});

describe('otherPrimaryCandidates', () => {
  it('is empty when the removed row is the only one in the sibling list', () => {
    const rows = [row('primary')];
    expect(otherPrimaryCandidates('primary', rows)).toEqual([]);
  });

  it('returns every other row when others exist', () => {
    const rows = [row('primary'), row('secondary-1'), row('secondary-2')];
    const others = otherPrimaryCandidates('primary', rows);
    expect(others.map((r) => r.relationship_id)).toEqual(['secondary-1', 'secondary-2']);
  });
});

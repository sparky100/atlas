import { describe, expect, it } from 'vitest';
import { buildOwnsRoleBackfillDeltas, findOwnsRoleBackfillCandidates } from './backfillOwnsRole';
import type { RelationshipsHeadRow } from '../contracts/rows';

function ownsEdge(overrides: Partial<RelationshipsHeadRow> & Pick<RelationshipsHeadRow, 'relationship_id'>): RelationshipsHeadRow {
  return {
    relationship_type: 'owns',
    from_element_id: `actor-${overrides.relationship_id}`,
    to_element_id: `target-${overrides.relationship_id}`,
    attributes: {},
    exists_delta_id: `exists-${overrides.relationship_id}`,
    ...overrides,
  };
}

describe('findOwnsRoleBackfillCandidates (Prompt 7k item 2 backfill)', () => {
  it('primary: true becomes role: business, anchored on the edge\'s own create delta (role was never asserted before)', () => {
    const edges = [ownsEdge({ relationship_id: 'r1', attributes: { primary: true } })];
    expect(findOwnsRoleBackfillCandidates(edges, new Map())).toEqual([{ relationshipId: 'r1', role: 'business', existsDeltaId: 'exists-r1', primaryDeltaId: 'exists-r1' }]);
  });

  it('primary: false becomes role: technical', () => {
    const edges = [ownsEdge({ relationship_id: 'r1', attributes: { primary: false } })];
    expect(findOwnsRoleBackfillCandidates(edges, new Map())).toEqual([{ relationshipId: 'r1', role: 'technical', existsDeltaId: 'exists-r1', primaryDeltaId: 'exists-r1' }]);
  });

  it('an edge that already has a role is skipped — idempotent, a repeat run is a no-op', () => {
    const edges = [ownsEdge({ relationship_id: 'r1', attributes: { role: 'service' } })];
    expect(findOwnsRoleBackfillCandidates(edges, new Map())).toEqual([]);
  });

  it('an edge with neither primary nor role is skipped — nothing to migrate from', () => {
    const edges = [ownsEdge({ relationship_id: 'r1', attributes: {} })];
    expect(findOwnsRoleBackfillCandidates(edges, new Map())).toEqual([]);
  });

  it('uses the real primary-fact delta id when one is given, not the create delta — an edge whose primary was updated after creation anchors the clearing update on that later delta', () => {
    const edges = [ownsEdge({ relationship_id: 'r1', attributes: { primary: false }, exists_delta_id: 'exists-r1' })];
    const primaryFactDeltaId = new Map([['r1', 'update-r1-primary']]);
    expect(findOwnsRoleBackfillCandidates(edges, primaryFactDeltaId)).toEqual([{ relationshipId: 'r1', role: 'technical', existsDeltaId: 'exists-r1', primaryDeltaId: 'update-r1-primary' }]);
  });

  it('mixed model: migrates only the edges that need it, in order', () => {
    const edges = [
      ownsEdge({ relationship_id: 'r1', attributes: { primary: true } }),
      ownsEdge({ relationship_id: 'r2', attributes: { role: 'business' } }),
      ownsEdge({ relationship_id: 'r3', attributes: { primary: false } }),
    ];
    expect(findOwnsRoleBackfillCandidates(edges, new Map()).map((c) => c.relationshipId)).toEqual(['r1', 'r3']);
  });
});

describe('buildOwnsRoleBackfillDeltas', () => {
  it('two relationship.update deltas per candidate — role set, primary cleared — sharing sourceId', () => {
    const candidates = [{ relationshipId: 'r1', role: 'business' as const, existsDeltaId: 'exists-r1', primaryDeltaId: 'exists-r1' }];
    const deltas = buildOwnsRoleBackfillDeltas(candidates, 'source-1');
    expect(deltas).toHaveLength(2);

    const roleDelta = deltas.find((d) => d.kind === 'relationship.update' && d.attribute === 'role');
    expect(roleDelta).toMatchObject({ kind: 'relationship.update', relationshipId: 'r1', relationshipType: 'owns', attribute: 'role', value: 'business', previousDeltaId: 'exists-r1', sourceId: 'source-1', confidence: 1 });

    const primaryDelta = deltas.find((d) => d.kind === 'relationship.update' && d.attribute === 'primary');
    expect(primaryDelta).toMatchObject({ kind: 'relationship.update', relationshipId: 'r1', relationshipType: 'owns', attribute: 'primary', value: null, previousDeltaId: 'exists-r1', sourceId: 'source-1', confidence: 1 });
  });

  it('a distinct primaryDeltaId is used for the clearing update, not the role-setting one', () => {
    const candidates = [{ relationshipId: 'r1', role: 'technical' as const, existsDeltaId: 'exists-r1', primaryDeltaId: 'update-r1-primary' }];
    const deltas = buildOwnsRoleBackfillDeltas(candidates, 'source-1');
    const roleDelta = deltas.find((d) => d.kind === 'relationship.update' && d.attribute === 'role');
    const primaryDelta = deltas.find((d) => d.kind === 'relationship.update' && d.attribute === 'primary');
    expect(roleDelta).toMatchObject({ previousDeltaId: 'exists-r1' });
    expect(primaryDelta).toMatchObject({ previousDeltaId: 'update-r1-primary' });
  });

  it('multiple candidates each get their own pair, none sharing an id', () => {
    const candidates = [
      { relationshipId: 'r1', role: 'business' as const, existsDeltaId: 'exists-r1', primaryDeltaId: 'exists-r1' },
      { relationshipId: 'r2', role: 'technical' as const, existsDeltaId: 'exists-r2', primaryDeltaId: 'exists-r2' },
    ];
    const deltas = buildOwnsRoleBackfillDeltas(candidates, 'source-1');
    expect(deltas).toHaveLength(4);
    expect(new Set(deltas.map((d) => d.id)).size).toBe(4);
  });
});

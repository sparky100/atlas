import { describe, expect, it } from 'vitest';
import { buildReplacesDelta } from './buildReplacesDelta';

describe('buildReplacesDelta', () => {
  it('ADR-001 amendment: "B replaces A" is from: B, to: A', () => {
    const delta = buildReplacesDelta('replacement-id', 'retiring-id', 'source-id');

    expect(delta.kind).toBe('relationship.create');
    const created = delta as unknown as { relationshipType: string; fromElementId: string; toElementId: string; sourceId: string; confidence: number; attributes: Record<string, unknown> };
    expect(created.relationshipType).toBe('replaces');
    expect(created.fromElementId).toBe('replacement-id');
    expect(created.toElementId).toBe('retiring-id');
    expect(created.sourceId).toBe('source-id');
    expect(created.confidence).toBe(1);
    expect(created.attributes).toEqual({});
  });

  it('carries an optional description when given one', () => {
    const delta = buildReplacesDelta('replacement-id', 'retiring-id', 'source-id', { description: 'consolidated during the SAP migration' });
    expect((delta as unknown as { attributes: Record<string, unknown> }).attributes).toEqual({ description: 'consolidated during the SAP migration' });
  });

  it('mints a fresh id and relationshipId on every call — two edges never collide', () => {
    const a = buildReplacesDelta('b', 'a', 'source-id') as unknown as { id: string; relationshipId: string };
    const b = buildReplacesDelta('c', 'a', 'source-id') as unknown as { id: string; relationshipId: string };
    expect(a.id).not.toBe(b.id);
    expect(a.relationshipId).not.toBe(b.relationshipId);
  });
});

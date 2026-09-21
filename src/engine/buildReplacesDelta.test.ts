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
    const delta = buildReplacesDelta('replacement-id', 'retiring-id', 'source-id', { attributes: { description: 'consolidated during the SAP migration' } });
    expect((delta as unknown as { attributes: Record<string, unknown> }).attributes).toEqual({ description: 'consolidated during the SAP migration' });
  });

  it('carries an optional sourceRef and overrides the default confidence, for a caller with its own per-row provenance', () => {
    const delta = buildReplacesDelta('replacement-id', 'retiring-id', 'source-id', { sourceRef: 'import.json › row 4 › replaced_by', confidence: 0.8 });
    const created = delta as unknown as { sourceRef?: string; confidence: number };
    expect(created.sourceRef).toBe('import.json › row 4 › replaced_by');
    expect(created.confidence).toBe(0.8);
  });

  it('omits sourceRef entirely (not undefined-valued) when none is given', () => {
    const delta = buildReplacesDelta('replacement-id', 'retiring-id', 'source-id');
    expect('sourceRef' in delta).toBe(false);
  });

  it('mints a fresh id and relationshipId on every call — two edges never collide', () => {
    const a = buildReplacesDelta('b', 'a', 'source-id') as unknown as { id: string; relationshipId: string };
    const b = buildReplacesDelta('c', 'a', 'source-id') as unknown as { id: string; relationshipId: string };
    expect(a.id).not.toBe(b.id);
    expect(a.relationshipId).not.toBe(b.relationshipId);
  });
});

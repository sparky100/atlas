import { describe, expect, it } from 'vitest';
import { referenceCapabilityRevisionRowSchema, referenceMapItemLinkRowSchema } from './referenceCapabilities';

const id = '11111111-1111-4111-8111-111111111111';
const at = '2026-11-22T09:00:00+00:00';

describe('reference capability storage contract', () => {
  it('requires a publication date for a published revision', () => {
    const row = { capability_id: id, revision: 1, name: 'Customer Contact', definition: 'Handle customer enquiries.',
      status: 'published', published_at: at, created_at: at };
    expect(referenceCapabilityRevisionRowSchema.parse(row)).toEqual(row);
    expect(referenceCapabilityRevisionRowSchema.safeParse({ ...row, published_at: null }).success).toBe(false);
  });

  it('records a reviewed link, not a sector/name inferred match', () => {
    const row = { map_item_id: id, capability_id: id, capability_revision: 1,
      review_basis: 'Same meaning in both reviewed maps.', mapped_by: id, mapped_at: at };
    expect(referenceMapItemLinkRowSchema.parse(row)).toEqual(row);
    expect(referenceMapItemLinkRowSchema.safeParse({ ...row, review_basis: '' }).success).toBe(false);
  });
});

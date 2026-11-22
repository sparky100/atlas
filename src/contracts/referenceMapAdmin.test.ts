import { describe, expect, it } from 'vitest';
import { referenceMapDraftAlignmentSchema, referenceMapDraftRowSchema, referenceMapEventRowSchema } from './referenceMapAdmin';

const id = 'ec11a3aa-d9a1-4b53-b084-e43ee74e37f0';

describe('platform map draft and audit contract', () => {
  it('allows incomplete drafts while preserving publication and revision invariants', () => {
    const draft = { id, sector: 'electricity_network', version: 5, base_map_id: null,
      content: { title: '' }, edit_revision: 1, status: 'draft', published_map_id: null,
      updated_at: '2026-11-22T12:00:00Z' };
    expect(referenceMapDraftRowSchema.safeParse(draft).success).toBe(true);
    expect(referenceMapDraftRowSchema.safeParse({ ...draft, status: 'published' }).success).toBe(false);
    expect(referenceMapDraftRowSchema.safeParse({ ...draft, edit_revision: 0 }).success).toBe(false);
  });
  it('accepts only named audit actions', () => {
    const event = { id, draft_id: id, actor_id: id, edit_revision: 2, happened_at: '2026-11-22T12:00:00Z' };
    expect(referenceMapEventRowSchema.safeParse({ ...event, action: 'saved' }).success).toBe(true);
    expect(referenceMapEventRowSchema.safeParse({ ...event, action: 'aligned' }).success).toBe(true);
    expect(referenceMapEventRowSchema.safeParse({ ...event, action: 'deleted' }).success).toBe(false);
  });
  it('requires an explicit new or existing identity choice', () => {
    const alignment = { draft_id: id, item_code: '1', kind: 'existing', capability_id: id,
      capability_revision: 1, stable_key: null, identity_definition: null,
      reviewed_name: 'Connect a customer', reviewed_description: '', review_basis: 'Reviewed meaning', aligned_by: id };
    expect(referenceMapDraftAlignmentSchema.safeParse(alignment).success).toBe(true);
    expect(referenceMapDraftAlignmentSchema.safeParse({ ...alignment, capability_id: null }).success).toBe(false);
  });
});

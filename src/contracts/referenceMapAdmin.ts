import { z } from 'zod';

/** The editor may save an incomplete map. It validates the existing
 * capability-map content contract before publication, not before saving. */
export const referenceMapDraftRowSchema = z.object({
  id: z.uuid(),
  sector: z.string().min(1),
  version: z.number().int().positive(),
  base_map_id: z.uuid().nullable(),
  content: z.record(z.string(), z.unknown()),
  edit_revision: z.number().int().positive(),
  status: z.enum(['draft', 'published']),
  published_map_id: z.uuid().nullable(),
  updated_at: z.iso.datetime({ offset: true }),
}).superRefine((row, ctx) => {
  if ((row.status === 'published') !== (row.published_map_id !== null))
    ctx.addIssue({ code: 'custom', message: 'Only a published draft has a published map ID.' });
});

export const referenceMapEventRowSchema = z.object({
  id: z.uuid(),
  draft_id: z.uuid(),
  actor_id: z.uuid(),
  action: z.enum(['created', 'saved', 'aligned', 'published']),
  edit_revision: z.number().int().positive(),
  happened_at: z.iso.datetime({ offset: true }),
});

export const referenceMapDraftAlignmentSchema = z.object({
  draft_id: z.uuid(),
  item_code: z.string().min(1),
  kind: z.enum(['existing', 'new']),
  capability_id: z.uuid().nullable(),
  capability_revision: z.number().int().positive().nullable(),
  stable_key: z.string().nullable(),
  identity_definition: z.string().nullable(),
  reviewed_name: z.string().min(1),
  reviewed_description: z.string(),
  review_basis: z.string().min(1),
  aligned_by: z.uuid(),
}).superRefine((row, ctx) => {
  const existing = row.capability_id !== null && row.capability_revision !== null && row.stable_key === null && row.identity_definition === null;
  const fresh = row.capability_id === null && row.capability_revision === null && row.stable_key !== null && row.identity_definition !== null;
  if ((row.kind === 'existing' && !existing) || (row.kind === 'new' && !fresh))
    ctx.addIssue({ code: 'custom', message: 'A choice must use one published identity or define one new identity.' });
});

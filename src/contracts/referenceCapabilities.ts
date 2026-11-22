/** Storage contract for the additive platform reference-capability tables.
 * The organisation's own capability elements and templateRef keep their
 * existing meaning. These identities are only assigned by reviewed links.
 */
import { z } from 'zod';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });

export const referenceCapabilityRowSchema = z.object({
  id: uuid,
  stable_key: z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/).max(100),
  created_at: timestamp,
});

export const referenceCapabilityRevisionRowSchema = z.object({
  capability_id: uuid,
  revision: z.number().int().positive(),
  name: z.string().min(1).max(200).refine((value) => value.trim() !== ''),
  definition: z.string().min(1).max(2000).refine((value) => value.trim() !== ''),
  status: z.enum(['draft', 'published']),
  published_at: timestamp.nullable(),
  created_at: timestamp,
}).refine((row) => (row.status === 'published') === (row.published_at !== null), 'Publication date must match status');

export const referenceMapItemLinkRowSchema = z.object({
  map_item_id: uuid,
  capability_id: uuid,
  capability_revision: z.number().int().positive(),
  review_basis: z.string().min(1).max(500).refine((value) => value.trim() !== ''),
  mapped_by: uuid,
  mapped_at: timestamp,
});

export type ReferenceCapabilityRow = z.infer<typeof referenceCapabilityRowSchema>;
export type ReferenceCapabilityRevisionRow = z.infer<typeof referenceCapabilityRevisionRowSchema>;
export type ReferenceMapItemLinkRow = z.infer<typeof referenceMapItemLinkRowSchema>;

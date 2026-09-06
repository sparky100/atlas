/**
 * The wire shape of a starter capability map content file
 * (`content/capability-maps/<sector>/<version>.json`, SPEC-data-model.md
 * §3.10, ADR-012) — what scripts/loadCapabilityMaps.ts reads and validates
 * before writing anything to `capability_maps`/`capability_map_items`/
 * `capability_map_sources`. Sprint U2 ships the loader and this shape with
 * an empty `content/` scaffold; real sector content is Prompt 9's job, not
 * this one's — see content/capability-maps/README.md for the exact format
 * a future author writes against.
 */
import { z } from 'zod';

export const SECTORS = ['local_government', 'nhs', 'housing', 'hei', 'generic'] as const;

const itemSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  parentCode: z.string().min(1).nullable(),
});

const sourceSchema = z.object({
  citation: z.string().min(1),
  url: z.string().optional(),
  reviewedBy: z.string().min(1),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'reviewedAt must be YYYY-MM-DD'),
});

export const capabilityMapContentSchema = z
  .object({
    sector: z.enum(SECTORS),
    version: z.number().int().positive(),
    status: z.enum(['draft', 'published', 'deprecated']),
    sourceDescription: z.string().min(1),
    sources: z.array(sourceSchema),
    items: z.array(itemSchema).min(1),
  })
  .superRefine((content, ctx) => {
    const codes = new Set(content.items.map((item) => item.code));
    if (codes.size !== content.items.length) ctx.addIssue({ code: 'custom', message: 'item codes must be unique within a map' });

    for (const item of content.items) {
      if (item.parentCode === null) {
        if (item.level !== 1) ctx.addIssue({ code: 'custom', message: `item "${item.code}": a root item (parentCode null) must have level 1` });
        continue;
      }
      const parent = content.items.find((candidate) => candidate.code === item.parentCode);
      if (!parent) {
        ctx.addIssue({ code: 'custom', message: `item "${item.code}": parentCode "${item.parentCode}" does not match any item's code` });
        continue;
      }
      if (item.level !== parent.level + 1) ctx.addIssue({ code: 'custom', message: `item "${item.code}": level must be exactly one more than its parent's level` });
    }
  });

export type CapabilityMapItemContent = z.infer<typeof itemSchema>;
export type CapabilityMapSourceContent = z.infer<typeof sourceSchema>;
export type CapabilityMapContent = z.infer<typeof capabilityMapContentSchema>;

/** Throws a single `Error` listing every problem found, rather than the first one — a content file worth flagging is usually worth flagging completely in one pass. */
export function parseCapabilityMapContent(raw: unknown, sourceLabel: string): CapabilityMapContent {
  const result = capabilityMapContentSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
    throw new Error(`${sourceLabel}: invalid capability map content:\n${issues}`);
  }
  return result.data;
}

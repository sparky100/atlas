/**
 * The wire shape of a starter capability map content file
 * (`content/capability-maps/<sector>/<version>.json`, SPEC-data-model.md
 * §3.10, ADR-012) — what scripts/loadCapabilityMaps.ts reads and validates
 * before writing anything to `capability_maps`/`capability_map_items`/
 * `capability_map_sources`, and what scripts/reviewCapabilityMaps.ts reads
 * through so the review document can never disagree with the loader.
 *
 * This file *is* the schema: there is deliberately no hand-written
 * schema.json alongside the content. The sector list lives here, not in a
 * database CHECK constraint — the same taxonomy-in-code choice ADR-001
 * makes for element and relationship types, so adding a sector is one
 * edit in one place with the tests that go with it, not a migration.
 * `supabase/migrations/20260906180000_capability_maps_sector_taxonomy_in_code.sql`
 * dropped the old CHECK that used to duplicate this list in the database.
 */
import { z } from 'zod';

export const SECTORS = ['local_government_scotland', 'local_government_england', 'nhs', 'housing', 'hei', 'public_body', 'utility', 'electricity_network'] as const;

export type Sector = (typeof SECTORS)[number];

/**
 * Deprecated sector names still accepted on the way in, mapped to their
 * canonical value. `local_government` predates the Scotland/England split
 * (its content was Scottish-authority-shaped); nothing writes it any more,
 * and a content file must live under its canonical directory
 * (`local_government_scotland/<version>.json`) — the loader checks the
 * path against the *parsed* sector, so a file left at
 * `local_government/1.json` still fails loudly there. The alias only
 * keeps old raw JSON parseable; it is not a second spelling to write.
 */
export const LEGACY_SECTOR_ALIASES: Readonly<Record<string, Sector>> = { local_government: 'local_government_scotland' };

const sectorSchema = z.preprocess((value) => (typeof value === 'string' && value in LEGACY_SECTOR_ALIASES ? LEGACY_SECTOR_ALIASES[value] : value), z.enum(SECTORS));

const itemSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  parentCode: z.string().min(1).nullable(),
  /**
   * Explicit display order among this item's siblings (Sprint U4-1 C1) —
   * independent of `code`, which stays a stable reference id
   * (`attributes.templateRef`/`aliases`) that must not change when an
   * item's position does. Not required to be contiguous or start at 1:
   * this repo's convention (README) is multiples of 10, so a later
   * manual insertion doesn't need every sibling renumbered.
   */
  order: z.number().int(),
});

const sourceSchema = z.object({
  citation: z.string().min(1),
  url: z.string().optional(),
  reviewedBy: z.string().min(1),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'reviewedAt must be YYYY-MM-DD'),
});

export const capabilityMapContentSchema = z
  .object({
    sector: sectorSchema,
    version: z.number().int().positive(),
    status: z.enum(['draft', 'published', 'deprecated']),
    /**
     * Sprint U4-2a item 4: the picker card's own display name — short,
     * e.g. "NHS Acute Trust", not a restatement of `sector`/`version`
     * (the card already shows those alongside it). Required on every
     * file, not optional: a picker with eight-plus maps needs a real name
     * to scan, search, and filter by (item 4's own "search/filter"), not
     * a sector code.
     */
    title: z.string().min(1),
    /**
     * Sprint U4-2a item 4: one or two plain-English sentences on the
     * card face — what this map covers, not how it was drafted or
     * reviewed (that stays `sourceDescription`, shown behind the card's
     * info affordance, not on its face).
     */
    summary: z.string().min(1),
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

    // Sprint U4-1 C1: order only has to be unique among siblings (the same
    // parentCode, or — for level-1 items — the shared null) — two items
    // under different parents are never compared against each other, so
    // reusing an order value across sibling groups is fine.
    const orderCollisions = new Map<string | null, Set<number>>();
    for (const item of content.items) {
      const seenOrders = orderCollisions.get(item.parentCode) ?? new Set<number>();
      if (seenOrders.has(item.order)) {
        ctx.addIssue({ code: 'custom', message: `item "${item.code}": order ${String(item.order)} is already used by another sibling under ${item.parentCode ?? '(top level)'}` });
      }
      seenOrders.add(item.order);
      orderCollisions.set(item.parentCode, seenOrders);
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

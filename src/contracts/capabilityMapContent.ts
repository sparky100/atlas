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

/**
 * F6 (ADR-023, SPEC §3.10): one of a starter map's value streams. `code`
 * is the stable reference id (like a capability item's own `code`, it
 * becomes a seeded element's `template_code` alias); `order` is display
 * order among sibling streams, the same multiples-of-ten convention items
 * use. A stream's stages are its children (`stages`), depth exactly two —
 * a stage never has stages of its own.
 */
const valueStreamStageSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int(),
  /**
   * The capabilities that deliver this stage, named by capability *name*
   * (not `code`) — a content author thinks in names; the loader resolves
   * each to a `capability_map_items.code`, failing loudly on zero or
   * ambiguous matches (superRefine below + the loader both check).
   */
  enables: z.array(z.string().min(1)),
});

const valueStreamSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int(),
  stages: z.array(valueStreamStageSchema),
});

/** A deterministic "did you mean" hint for a value-stream `enables` name that matches no capability — case-only mismatch first, then capabilities sharing a word (a content author's most likely slip is a spelling/plural drift, not a wholly unrelated name). */
function nearMissHint(name: string, items: readonly { name: string }[]): string {
  const normalized = name.trim().toLowerCase();
  const ciMatch = items.find((i) => i.name.trim().toLowerCase() === normalized);
  if (ciMatch) return ` (case differs from "${ciMatch.name}")`;
  const words = normalized.split(/\s+/).filter((w) => w.length > 3);
  const candidates = items.filter((i) => words.some((w) => i.name.toLowerCase().includes(w))).map((i) => i.name).slice(0, 3);
  return candidates.length > 0 ? ` (near matches: ${candidates.join(', ')})` : '';
}

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
    /** F6 (ADR-023): a map's value streams, defaulting to `[]` so every pre-F6 content file stays valid without editing. */
    valueStreams: z.array(valueStreamSchema).default([]),
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

    // F6 (ADR-023): value streams — codes unique across the whole map
    // (streams and stages share `capability_map_value_stream_items`'s own
    // `(map_id, code)` uniqueness), `order` unique among sibling streams
    // and among a stream's own stages, and every `enables` name resolves to
    // exactly one capability name.
    const valueStreamCodes = new Set<string>();
    const streamOrders = new Set<number>();
    for (const stream of content.valueStreams) {
      if (valueStreamCodes.has(stream.code)) {
        ctx.addIssue({ code: 'custom', message: `value stream "${stream.code}": code is already used by another value stream or stage` });
      }
      valueStreamCodes.add(stream.code);
      if (streamOrders.has(stream.order)) {
        ctx.addIssue({ code: 'custom', message: `value stream "${stream.code}": order ${String(stream.order)} is already used by another stream` });
      }
      streamOrders.add(stream.order);

      const stageCodes = new Set<string>();
      const stageOrders = new Set<number>();
      for (const stage of stream.stages) {
        if (valueStreamCodes.has(stage.code) || stageCodes.has(stage.code)) {
          ctx.addIssue({ code: 'custom', message: `value stream "${stream.code}" stage "${stage.code}": code is already used elsewhere in this map` });
        }
        stageCodes.add(stage.code);
        valueStreamCodes.add(stage.code);
        if (stageOrders.has(stage.order)) {
          ctx.addIssue({ code: 'custom', message: `value stream "${stream.code}": stage order ${String(stage.order)} is already used by another stage in this stream` });
        }
        stageOrders.add(stage.order);

        for (const name of stage.enables) {
          const matches = content.items.filter((item) => item.name === name);
          if (matches.length === 0) {
            ctx.addIssue({ code: 'custom', message: `value stream "${stream.code}" stage "${stage.code}": enables "${name}" matches no capability name${nearMissHint(name, content.items)}` });
          } else if (matches.length > 1) {
            ctx.addIssue({ code: 'custom', message: `value stream "${stream.code}" stage "${stage.code}": enables "${name}" is ambiguous — ${String(matches.length)} capabilities share that name` });
          }
        }
      }
    }
  });

export type CapabilityMapItemContent = z.infer<typeof itemSchema>;
export type CapabilityMapSourceContent = z.infer<typeof sourceSchema>;
export type CapabilityMapValueStreamStageContent = z.infer<typeof valueStreamStageSchema>;
export type CapabilityMapValueStreamContent = z.infer<typeof valueStreamSchema>;
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

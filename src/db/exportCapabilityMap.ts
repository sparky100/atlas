/**
 * Sprint U4-1 C6: "walks the capability tree at main head, writes
 * content/capability-maps/<sector>/<version>.json (names, definitions,
 * order, parent structure; model-specific attributes dropped)". Shared by
 * both callers named in the sprint item — the CLI
 * (scripts/exportCapabilityMap.ts, writing a real content file as
 * service_role) and the owner-only "Export as starter map" UI action
 * (`useExportCapabilityMap.ts`, calling `atlas.export_capability_map_as_draft`
 * as an authenticated session) — so a UI export and a CLI export of the
 * same model at the same commit produce byte-identical content.
 *
 * Codes are freshly generated from the resolved tree structure and
 * display order (`1`, `1.1`, `1.1.1`, …), not copied from a capability's
 * own `attributes.code` — that attribute is starter-map *seed* provenance
 * for this one model instance (src/db/seedFromMap.ts), and would go stale
 * the moment tailoring reorders siblings or restructures the tree, or is
 * simply absent on a hand-added capability. "Parent structure" is exactly
 * what these fresh codes/parentCode pairs preserve; nothing else about a
 * capability's model-specific attributes (templateRef, an alias, order's
 * own raw number) is copied at all.
 *
 * Orphans (a broken or too-deep parent chain — `computeCapabilityMapTree`'s
 * own `orphans`) are silently excluded: the content schema itself only
 * supports three levels, the same ceiling the map's own UI already
 * enforces, so there is nothing meaningful to export for one. Reusing
 * `computeCapabilityMapTree`/`compareCapabilities` here (rather than a
 * second, duplicated depth/order algorithm) is deliberate: the exported
 * tree and display order must never silently drift from what the map's
 * own UI actually shows.
 */
import { computeCapabilityMapTree } from '../ui/capabilityMap/layout';
import { attributesRecord } from '../ui/elements/attributesRecord';
import type { CapabilityMapContent, CapabilityMapItemContent, CapabilityMapSourceContent, Sector } from '../contracts/capabilityMapContent';
import type { ElementsHeadRow } from '../contracts/rows';
import type { UUID } from '../contracts/delta';
import { getMainBranch } from './branches';
import { listCapabilitiesForMap } from './capabilityMap';
import type { Client } from './client';

export interface BuildCapabilityMapExportInput {
  sector: Sector;
  version: number;
  sourceDescription: string;
  source: CapabilityMapSourceContent;
}

function itemFrom(capability: ElementsHeadRow, code: string, parentCode: string | null, level: 1 | 2 | 3, order: number): CapabilityMapItemContent {
  const description = attributesRecord(capability.attributes).description;
  return {
    code,
    name: capability.name,
    description: typeof description === 'string' && description.trim() !== '' ? description : undefined,
    level,
    parentCode,
    order,
  };
}

/**
 * Pure builder, independently testable: every capability at a commit ->
 * `CapabilityMapContent`. Order values are multiples of ten within each
 * sibling group (this repo's own authoring convention,
 * content/capability-maps/README.md), derived purely from
 * `compareCapabilities`'s own resolved position, not from any capability's
 * existing `attributes.order` value (which — same reasoning as `code`
 * above — is this model's own tailoring history, not something a fresh
 * starter map should carry forward verbatim).
 */
export function buildCapabilityMapExport(capabilities: readonly ElementsHeadRow[], input: BuildCapabilityMapExportInput): CapabilityMapContent {
  const tree = computeCapabilityMapTree(capabilities);
  const items: CapabilityMapItemContent[] = [];

  tree.l1.forEach((l1, l1Index) => {
    const l1Code = String(l1Index + 1);
    items.push(itemFrom(l1.capability, l1Code, null, 1, (l1Index + 1) * 10));
    l1.l2.forEach((l2, l2Index) => {
      const l2Code = `${l1Code}.${String(l2Index + 1)}`;
      items.push(itemFrom(l2.capability, l2Code, l1Code, 2, (l2Index + 1) * 10));
      l2.l3.forEach((l3, l3Index) => {
        const l3Code = `${l2Code}.${String(l3Index + 1)}`;
        items.push(itemFrom(l3, l3Code, l2Code, 3, (l3Index + 1) * 10));
      });
    });
  });

  return {
    sector: input.sector,
    version: input.version,
    status: 'draft',
    sourceDescription: input.sourceDescription,
    sources: [input.source],
    items,
  };
}

/** `reviewedAt` in the `YYYY-MM-DD` shape the content schema requires. */
export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The drafting placeholder every export ships with — same "not yet reviewed" convention content/capability-maps/README.md and scripts/publishCapabilityMap.ts's own `PENDING_REVIEW_PATTERN` (`/pending human review/i`) already establish, worded for an export rather than hand-authored content. */
export function exportPendingReviewPlaceholder(modelName: string): string {
  return `Pending human review — exported from model "${modelName}"`;
}

export interface ExportCapabilityMapInput {
  modelId: UUID;
  modelName: string;
  orgName: string;
  orgSlug: string;
  modelSlug: string;
  sector: Sector;
  version: number;
  now?: Date;
}

/**
 * The I/O half: fetches `modelId`'s capabilities at main head and builds
 * their `CapabilityMapContent`. Read-only — nothing here writes anything;
 * `scripts/exportCapabilityMap.ts` writes the file, `useExportCapabilityMap.ts`
 * calls the RPC, both against this same content.
 */
export async function exportCapabilityMap(supabase: Client, input: ExportCapabilityMapInput): Promise<CapabilityMapContent> {
  const main = await getMainBranch(supabase, input.modelId);
  if (!main) throw new Error(`model ${input.modelId} has no main branch`);

  const capabilities = await listCapabilitiesForMap(supabase, main.head_commit_id);
  if (capabilities.length === 0) throw new Error('this model has no capabilities to export');

  const now = input.now ?? new Date();
  const reviewedAt = todayIsoDate(now);
  return buildCapabilityMapExport(capabilities, {
    sector: input.sector,
    version: input.version,
    sourceDescription: `Exported from the "${input.modelName}" model (organisation "${input.orgName}") on ${reviewedAt}. Not yet reviewed against any external framework or reference model — review before publishing.`,
    source: {
      citation: `Exported from Atlas model "${input.modelName}" (${input.orgSlug}/${input.modelSlug})`,
      reviewedBy: exportPendingReviewPlaceholder(input.modelName),
      reviewedAt,
    },
  });
}

export type ExportCapabilityMapAsDraftResult = { ok: true; mapId: UUID; content: CapabilityMapContent } | { ok: false; message: string };

/**
 * The owner-only "Export as starter map" UI action (`useExportCapabilityMap.ts`):
 * builds the same content `exportCapabilityMap` above does, then hands it
 * to `atlas.export_capability_map_as_draft` — the privileged write this
 * session can't do directly (`capability_maps`/`capability_map_items`/
 * `capability_map_sources` have no `authenticated` grant at all, per
 * `20260906110000_capability_map_templates.sql`'s own comment). That
 * function re-checks owner/architect itself (ADR-015: never trust a
 * client-side gate alone for a privileged write) and always writes
 * `status: 'draft'`, regardless of anything this function passes.
 */
export async function exportCapabilityMapAsDraft(supabase: Client, input: ExportCapabilityMapInput): Promise<ExportCapabilityMapAsDraftResult> {
  const content = await exportCapabilityMap(supabase, input);

  // .schema('atlas'): this RPC lives in the atlas schema (SPEC §2), not
  // public — see src/db/commits.ts's own note on why this is required.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('export_capability_map_as_draft', {
    p_model_id: input.modelId,
    p_sector: content.sector,
    p_version: content.version,
    p_source_description: content.sourceDescription,
    p_items: content.items,
    p_sources: content.sources,
  } satisfies Record<string, unknown>);

  if (error) return { ok: false, message: error.message };
  return { ok: true, mapId: data as UUID, content };
}

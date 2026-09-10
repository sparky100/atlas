/**
 * Publishes a starter capability map: `pnpm content:publish-capability-map
 * <sector> <version>`. The one and only path from `draft` to `published`
 * (content/capability-maps/README.md's workflow: draft → review doc → a
 * human runs this). Once published, `capability_map_items_guard_immutable`
 * (`supabase/migrations/20260906190000_...sql`) rejects any further
 * edit — a map that needs to change becomes a new version, not a mutation
 * of this one.
 *
 * Requires at least one `capability_map_sources` row (the map's own
 * `reviewedBy`/`reviewedAt`, already `not null` columns). This script adds
 * one more check the schema can't express: at least one of those sources
 * must have moved past the "Pending human review" placeholder every
 * drafted map ships with (content/capability-maps/README.md,
 * src/contracts/capabilityMaps.content.test.ts's own "stays draft while
 * placeholder" rule) — a schema-valid source row is not the same thing as
 * a human having actually looked at the map, and publishing is the one
 * moment that difference has to matter.
 *
 * Publishing this (sector, version) also marks any other `published` map
 * of the same sector `deprecated` — a sector has at most one current
 * published map, matching `capability_map_templates`'s own "versioned
 * starter content" shape (ADR-012).
 */
import { createServiceRoleClient, type Client } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { SECTORS } from '../src/contracts/capabilityMapContent';
import { isCliEntrypoint } from './isCliEntrypoint';

const PENDING_REVIEW_PATTERN = /pending human review/i;

/**
 * The actual publish logic, exported so
 * src/db/repository.integration.test.ts can exercise it directly against a
 * real Supabase — the same reason scripts/loadCapabilityMaps.ts's `loadOne`
 * is a separate function from `main`. Returns the deprecated-version list
 * for the caller to log or assert on.
 */
export async function publishCapabilityMap(supabase: Client, sector: string, version: number): Promise<{ deprecated: number[] }> {
  const { data: target, error: targetError } = await supabase.from('capability_maps').select('id, status').eq('sector', sector).eq('version', version).maybeSingle();
  if (targetError) throw new Error(`looking up ${sector} v${String(version)}: ${targetError.message}`);
  if (!target) throw new Error(`${sector} v${String(version)}: no such map — has it been loaded (pnpm content:load-capability-maps)?`);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see src/db/branches.ts's module comment.
  const targetId: string = target.id;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see src/db/branches.ts's module comment.
  const targetStatus: string = target.status;
  if (targetStatus !== 'draft') throw new Error(`${sector} v${String(version)}: status is "${targetStatus}", not "draft" — only a draft map can be published.`);

  const { data: sources, error: sourcesError } = await supabase.from('capability_map_sources').select('reviewed_by').eq('map_id', targetId);
  if (sourcesError) throw new Error(`reading sources for ${sector} v${String(version)}: ${sourcesError.message}`);
  const sourceRows = sources as { reviewed_by: string }[];
  if (sourceRows.length === 0) {
    throw new Error(`${sector} v${String(version)}: has no capability_map_sources row — a published map must cite at least one reviewed source.`);
  }
  if (sourceRows.every((s) => PENDING_REVIEW_PATTERN.test(s.reviewed_by))) {
    throw new Error(
      `${sector} v${String(version)}: every source's reviewedBy is still the drafting placeholder ("Pending human review…") — replace at least one with the name of the person who actually reviewed this map before publishing.`,
    );
  }

  const { data: otherPublished, error: otherError } = await supabase.from('capability_maps').select('id, version').eq('sector', sector).eq('status', 'published');
  if (otherError) throw new Error(`checking for an existing published ${sector} map: ${otherError.message}`);
  const deprecated: number[] = [];
  for (const row of otherPublished as { id: string; version: number }[]) {
    const { error: deprecateError } = await supabase.from('capability_maps').update({ status: 'deprecated' }).eq('id', row.id);
    if (deprecateError) throw new Error(`deprecating ${sector} v${String(row.version)}: ${deprecateError.message}`);
    deprecated.push(row.version);
  }

  const { error: publishError } = await supabase.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', targetId);
  if (publishError) throw new Error(`publishing ${sector} v${String(version)}: ${publishError.message}`);

  return { deprecated };
}

function usageError(message: string): never {
  console.error(`${message}\n\nUsage: pnpm content:publish-capability-map <sector> <version>\nSectors: ${SECTORS.join(', ')}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [sectorArg, versionArg] = process.argv.slice(2);
  if (!sectorArg || !versionArg) usageError('sector and version are both required.');
  if (!(SECTORS as readonly string[]).includes(sectorArg)) usageError(`"${sectorArg}" is not a known sector.`);
  const version = Number(versionArg);
  if (!Number.isInteger(version) || version <= 0) usageError(`"${versionArg}" is not a valid version (a positive integer).`);

  const env = loadEnv();
  const supabase = createServiceRoleClient(env);
  const { deprecated } = await publishCapabilityMap(supabase, sectorArg, version);
  for (const v of deprecated) console.log(`${sectorArg} v${String(v)}: deprecated (superseded by v${String(version)}).`);
  console.log(`${sectorArg} v${String(version)}: published. Its items are now immutable — a future change means a new version.`);
}

// Only run main() when this is the CLI entrypoint, not when
// repository.integration.test.ts imports publishCapabilityMap.
if (isCliEntrypoint(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}

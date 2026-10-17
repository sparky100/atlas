/**
 * Reads every content/capability-maps/<sector>/<version>.json file,
 * validates it (src/contracts/capabilityMapContent.ts), and upserts it
 * into capability_maps/capability_map_items/capability_map_sources as
 * service_role (SPEC-data-model.md §3.10, ADR-012) — these tables have no
 * `authenticated` write grant at all (supabase/migrations/
 * 20260906110000_capability_map_templates.sql), so this script, not the
 * app, is the only writer.
 *
 * Run with `pnpm content:load-capability-maps`. Safe to re-run while a
 * map is still `draft`: it's looked up by its own (sector, version) and
 * replaced wholesale (its items/sources deleted and reinserted), never
 * duplicated. A map already `published` is skipped outright — it is fixed
 * history (SPEC §3.10, `capability_map_items_guard_immutable`,
 * 20260906190000), so a re-run has nothing to write for it and the fix
 * for wanting different content is a new version, not an edit.
 *
 * Node-only, not part of the Vite bundle or any Supabase edge function —
 * a one-off content-loading tool, run manually or from CI, the same
 * `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` environment every
 * integration test and other Node script in this repo already uses
 * (src/db/env.ts).
 */
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServiceRoleClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { parseCapabilityMapContent, type CapabilityMapContent } from '../src/contracts/capabilityMapContent';
import type { MapStatus } from '../src/db/capabilityMapTemplates';
import { isCliEntrypoint } from './isCliEntrypoint';

const CONTENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'capability-maps');

async function findContentFiles(): Promise<string[]> {
  let sectorDirs: string[];
  try {
    sectorDirs = await readdir(CONTENT_ROOT);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of sectorDirs) {
    const sectorPath = path.join(CONTENT_ROOT, entry);
    const stat = await readdir(sectorPath, { withFileTypes: true }).catch(() => null);
    if (!stat) continue;
    for (const file of stat) {
      if (file.isFile() && file.name.endsWith('.json')) files.push(path.join(sectorPath, file.name));
    }
  }
  return files;
}

async function loadOne(supabase: ReturnType<typeof createServiceRoleClient>, filePath: string): Promise<void> {
  const label = path.relative(CONTENT_ROOT, filePath);
  const raw: unknown = JSON.parse(await readFile(filePath, 'utf8'));
  const content: CapabilityMapContent = parseCapabilityMapContent(raw, label);

  // The path itself (<sector>/<version>.json) must agree with the file's
  // own fields — a copy-pasted file left with the wrong sector/version
  // inside it is exactly the kind of silent mismatch worth catching here
  // rather than at query time months later.
  const [sectorDir, versionFile] = label.split(path.sep);
  const versionFromPath = versionFile ? Number(versionFile.replace(/\.json$/, '')) : NaN;
  if (sectorDir !== content.sector || versionFromPath !== content.version) {
    throw new Error(`${label}: path implies sector/version "${sectorDir ?? '?'}"/${String(versionFromPath)}, but the file itself says "${content.sector}"/${String(content.version)}`);
  }

  const existing = await supabase.from('capability_maps').select('id, status').eq('sector', content.sector).eq('version', content.version).maybeSingle();
  if (existing.error) throw new Error(`${label}: ${existing.error.message}`);
  // A map already `published` is fixed history (SPEC §3.10,
  // capability_map_items_guard_immutable) — a re-run of this loader has
  // nothing to write for it, so skip it rather than let the wholesale
  // delete-then-reinsert below trip the immutability trigger. This is
  // what makes `pnpm content:load-capability-maps` safe to re-run against
  // a project that already has published maps on it.
  // `deprecated` is the same fixed history, one step on: publishing a later
  // version deprecates this one (scripts/publishCapabilityMap.ts), and a
  // re-run used to treat it as a draft and fail the table's check
  // constraint rewriting it — found when a second Playwright run's global
  // setup re-ran this loader after the first had published electricity v4.
  if (existing.data?.status === 'published' || existing.data?.status === 'deprecated') {
    console.log(`${label}: already ${String(existing.data.status)} — skipping (immutable; publish a new version to change it)`);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see src/db/branches.ts's module comment.
  const mapId: string = existing.data?.id ?? randomUUID();

  // Bug found while verifying Sprint U4-2a item 4 (confirmed pre-existing,
  // reproduced identically before that item's own changes via `git stash`):
  // `capability_map_items_guard_immutable` (20260906190000) rejects any
  // insert/update/delete on `capability_map_items` once its map's own
  // `status` is `'published'` — correct for a genuine re-edit of already-
  // published content (the trigger's whole point), but this function used
  // to write the map row with `content.status` *before* writing its items,
  // which meant the very first load of any file already declaring
  // `"status": "published"` (the common case: most of this repo's own
  // content files ship published from the start, never drafted-then-
  // published through this loader) failed outright — items can never be
  // inserted once the row they belong to says published, even on a brand
  // new row.
  //
  // Fix: write the row at its *existing* status (or `'draft'` for a
  // genuinely new row) first, write items/sources against that — still
  // correctly rejected if the row was already `published` from a prior
  // load, preserving the trigger's actual protection — then move it to
  // `content.status` as a separate update afterwards, once there's
  // nothing left in `capability_map_items` for that trigger to guard.
  const draftingStatus: MapStatus = (existing.data?.status as MapStatus | undefined) ?? 'draft';
  const mapRow = {
    id: mapId,
    sector: content.sector,
    version: content.version,
    status: draftingStatus,
    title: content.title,
    summary: content.summary,
    source_description: content.sourceDescription,
    published_at: draftingStatus === 'published' ? new Date().toISOString() : null,
  };
  const { error: upsertError } = await supabase.from('capability_maps').upsert(mapRow, { onConflict: 'id' });
  if (upsertError) throw new Error(`${label}: ${upsertError.message}`);

  // Wholesale replace, not a merge — the file is the source of truth for
  // this version, and a removed item should actually disappear, not
  // linger from a previous load.
  const { error: deleteItemsError } = await supabase.from('capability_map_items').delete().eq('map_id', mapId);
  if (deleteItemsError) throw new Error(`${label}: ${deleteItemsError.message}`);
  const { error: deleteSourcesError } = await supabase.from('capability_map_sources').delete().eq('map_id', mapId);
  if (deleteSourcesError) throw new Error(`${label}: ${deleteSourcesError.message}`);
  // F6 (ADR-023): value streams are part of the same wholesale replace —
  // enables first (their FK cascades anyway, but explicit is clearer), then
  // the streams/stages.
  const { error: deleteValueStreamEnablesError } = await supabase.from('capability_map_value_stream_enables').delete().eq('map_id', mapId);
  if (deleteValueStreamEnablesError) throw new Error(`${label}: ${deleteValueStreamEnablesError.message}`);
  const { error: deleteValueStreamItemsError } = await supabase.from('capability_map_value_stream_items').delete().eq('map_id', mapId);
  if (deleteValueStreamItemsError) throw new Error(`${label}: ${deleteValueStreamItemsError.message}`);

  // Two passes: every item gets an id first, then rows are built once
  // every code→id is known, so a child's parent_code can resolve to a
  // real capability_map_items.id (the level/parent-chain trigger only
  // needs parent_code, but the row itself still needs its own real id).
  const idByCode = new Map(content.items.map((item) => [item.code, randomUUID()]));
  const itemRows = content.items.map((item) => ({
    id: idByCode.get(item.code),
    map_id: mapId,
    code: item.code,
    parent_code: item.parentCode,
    name: item.name,
    description: item.description ?? null,
    level: item.level,
    item_order: item.order,
  }));
  // Insert parents before children so the level/parent-chain trigger
  // always finds the parent row it needs — items are already
  // level-ordered by construction (a child never has a lower level than
  // its parent), so sorting by level is sufficient.
  itemRows.sort((a, b) => a.level - b.level);
  if (itemRows.length > 0) {
    const { error: insertItemsError } = await supabase.from('capability_map_items').insert(itemRows);
    if (insertItemsError) throw new Error(`${label}: ${insertItemsError.message}`);
  }

  if (content.sources.length > 0) {
    const sourceRows = content.sources.map((source) => ({
      id: randomUUID(),
      map_id: mapId,
      citation: source.citation,
      url: source.url ?? null,
      reviewed_by: source.reviewedBy,
      reviewed_at: source.reviewedAt,
    }));
    const { error: insertSourcesError } = await supabase.from('capability_map_sources').insert(sourceRows);
    if (insertSourcesError) throw new Error(`${label}: ${insertSourcesError.message}`);
  }

  // F6 (ADR-023): value streams and their `enables` edges. `enables` names
  // capabilities by *name* (the brief's own wording) — resolved here to the
  // item code just written above; the parser's superRefine already refused
  // zero/ambiguous matches, so a miss here is unreachable rather than a
  // possible input. Streams first (parent_code null), then stages, so
  // guard_capability_map_value_stream_item_depth always finds the parent.
  if (content.valueStreams.length > 0) {
    const itemCodeByName = new Map(content.items.map((item) => [item.name, item.code]));

    const valueStreamRows = content.valueStreams.flatMap((stream) => [
      { id: randomUUID(), map_id: mapId, code: stream.code, parent_code: null, name: stream.name, description: stream.description ?? null, item_order: stream.order },
      ...stream.stages.map((stage) => ({ id: randomUUID(), map_id: mapId, code: stage.code, parent_code: stream.code, name: stage.name, description: stage.description ?? null, item_order: stage.order })),
    ]);
    valueStreamRows.sort((a, b) => (a.parent_code === null ? -1 : 1) - (b.parent_code === null ? -1 : 1));
    const { error: insertValueStreamsError } = await supabase.from('capability_map_value_stream_items').insert(valueStreamRows);
    if (insertValueStreamsError) throw new Error(`${label}: ${insertValueStreamsError.message}`);

    const enablesRows = content.valueStreams.flatMap((stream) =>
      stream.stages.flatMap((stage) =>
        stage.enables.map((name) => {
          const capabilityCode = itemCodeByName.get(name);
          if (capabilityCode === undefined) throw new Error(`${label}: value stream "${stream.code}" stage "${stage.code}": enables "${name}" matches no capability name`);
          return { map_id: mapId, stage_code: stage.code, capability_code: capabilityCode };
        }),
      ),
    );
    if (enablesRows.length > 0) {
      const { error: insertEnablesError } = await supabase.from('capability_map_value_stream_enables').insert(enablesRows);
      if (insertEnablesError) throw new Error(`${label}: ${insertEnablesError.message}`);
    }
  }

  // Now that capability_map_items/sources are written, move the row to
  // its real target status — never before now, per this function's own
  // comment above. A no-op update (content.status already matches
  // draftingStatus, the common re-run-against-a-draft case) still runs;
  // harmless, and simpler than a conditional for a rare-in-practice save.
  if (content.status !== draftingStatus) {
    const { error: statusError } = await supabase
      .from('capability_maps')
      .update({ status: content.status, published_at: content.status === 'published' ? new Date().toISOString() : null })
      .eq('id', mapId);
    if (statusError) throw new Error(`${label}: ${statusError.message}`);
  }

  const valueStreamCount = content.valueStreams.reduce((total, stream) => total + 1 + stream.stages.length, 0);
  console.log(`${label}: loaded ${String(itemRows.length)} item(s), ${String(valueStreamCount)} value stream(s)/stage(s), ${String(content.sources.length)} source(s) into ${content.sector} v${String(content.version)}`);
}

/** Every content file, loaded in turn — exported for Playwright's global setup (`e2e/globalSetup.ts`), which loads the real starter maps into a freshly reset local database. */
export async function loadAllCapabilityMaps(supabase: ReturnType<typeof createServiceRoleClient>): Promise<number> {
  const files = await findContentFiles();
  for (const file of files) {
    await loadOne(supabase, file);
  }
  return files.length;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const supabase = createServiceRoleClient(env);
  const loaded = await loadAllCapabilityMaps(supabase);
  if (loaded === 0) console.log('No content/capability-maps/<sector>/<version>.json files found — nothing to load (see content/capability-maps/README.md).');
}

// Only run main() when this is the CLI entrypoint, not when e2e/globalSetup.ts imports loadAllCapabilityMaps.
if (isCliEntrypoint(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}

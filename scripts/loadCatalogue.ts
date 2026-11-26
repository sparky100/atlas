/**
 * `pnpm content:load-catalogue` — D3 PR 2. Reads every
 * `content/catalogue/<sector>/<version>.json`, validates it against
 * `src/contracts/productCatalogue.ts`, and writes it as service_role:
 * the four product-content tables have no `authenticated` write grant.
 *
 * Safe to re-run while a catalogue is draft: it is looked up by
 * `(sector, version)` and replaced wholesale. A published catalogue is
 * skipped — published content is immutable, so a correction is a new
 * version, never an edit. A file that declares `status: published` is
 * inserted as draft, its children written, then moved to published in a
 * separate update so the child-immutability guard never blocks the first
 * write.
 */
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { productCatalogueContentSchema, type ProductCatalogueContent } from '../src/contracts/productCatalogue';
import { createServiceRoleClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { assertCatalogueFilesAllowed } from './catalogueFilesGuard';
import { isCliEntrypoint } from './isCliEntrypoint';

const CONTENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'catalogue');

async function contentFiles(): Promise<string[]> {
  const sectors = await readdir(CONTENT_ROOT, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const sector of sectors) {
    if (!sector.isDirectory()) continue;
    for (const file of await readdir(path.join(CONTENT_ROOT, sector.name), { withFileTypes: true }).catch(() => [])) {
      if (file.isFile() && file.name.endsWith('.json')) files.push(path.join(CONTENT_ROOT, sector.name, file.name));
    }
  }
  return files;
}

async function loadOne(supabase: ReturnType<typeof createServiceRoleClient>, file: string): Promise<void> {
  const label = path.relative(CONTENT_ROOT, file);
  const parsed = productCatalogueContentSchema.safeParse(JSON.parse(await readFile(file, 'utf8')) as unknown);
  if (!parsed.success) throw new Error(`${label}: invalid content — ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const content: ProductCatalogueContent = parsed.data;
  const [sectorDir, versionFile] = label.split(path.sep);
  const versionFromPath = versionFile ? Number(versionFile.replace(/\.json$/, '')) : NaN;
  if (sectorDir !== content.sector || versionFromPath !== content.version) {
    throw new Error(`${label}: path says ${sectorDir ?? '?'}/${String(versionFromPath)}, file says ${content.sector}/${String(content.version)}`);
  }

  const existing = await supabase.from('product_catalogues').select('id, status').eq('sector', content.sector).eq('version', content.version).maybeSingle();
  if (existing.error) throw new Error(`${label}: ${existing.error.message}`);
  const row = existing.data;
  if (row?.status === 'published') {
    console.log(`${label}: already published - skipping (immutable; publish a new version to change it)`);
    return;
  }
  const catalogueId: string = typeof row?.id === 'string' ? row.id : randomUUID();

  // Write the parent at draft first: children are immutable once the parent is
  // published, so a first load of a file that says "published" must not set
  // that status until its rows exist.
  const { error: upsertError } = await supabase.from('product_catalogues').upsert(
    {
      id: catalogueId,
      sector: content.sector,
      version: content.version,
      capability_map_version: content.capabilityMapVersion,
      status: 'draft',
      title: content.title,
      source_description: content.sourceDescription,
      licence: content.licence,
      published_at: null,
      withdrawn_at: null,
      withdrawn_reason: null,
    },
    { onConflict: 'id' },
  );
  if (upsertError) throw new Error(`${label}: ${upsertError.message}`);

  // Wholesale replace; entries cascade to capability links and claims.
  const { error: deleteError } = await supabase.from('catalogue_entries').delete().eq('catalogue_id', catalogueId);
  if (deleteError) throw new Error(`${label}: ${deleteError.message}`);

  const entryRows = content.entries.map((entry) => ({ id: randomUUID(), catalogue_id: catalogueId, code: entry.code, product: entry.product, vendor: entry.vendor, summary: entry.summary }));
  if (entryRows.length > 0) {
    const { error } = await supabase.from('catalogue_entries').insert(entryRows);
    if (error) throw new Error(`${label}: ${error.message}`);
  }
  const idByEntryCode = new Map(entryRows.map((e) => [e.code, e.id]));

  const capabilityRows = content.entries.flatMap((entry) =>
    entry.capabilities.map((capability) => ({
      entry_id: idByEntryCode.get(entry.code),
      capability_code: capability.code,
      capability_name: capability.name,
      how_it_supports: capability.howItSupports,
    })),
  );
  if (capabilityRows.length > 0) {
    const { error } = await supabase.from('catalogue_entry_capabilities').insert(capabilityRows);
    if (error) throw new Error(`${label}: ${error.message}`);
  }

  const claimRows = content.entries.flatMap((entry) =>
    entry.claims.map((claim) => ({
      id: randomUUID(),
      entry_id: idByEntryCode.get(entry.code),
      position: claim.position,
      kind: claim.kind,
      statement: claim.statement,
      source_url: claim.sourceUrl,
      source_date: claim.sourceDate,
      reviewed_by: claim.reviewedBy,
      reviewed_at: claim.reviewedAt,
    })),
  );
  if (claimRows.length > 0) {
    const { error } = await supabase.from('catalogue_claims').insert(claimRows);
    if (error) throw new Error(`${label}: ${error.message}`);
  }

  if (content.status === 'published') {
    const { error } = await supabase.from('product_catalogues').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', catalogueId);
    if (error) throw new Error(`${label}: ${error.message}`);
    console.log(`${label}: loaded and published.`);
  } else {
    console.log(`${label}: loaded as draft (${String(entryRows.length)} entries).`);
  }
}

/** One sector's catalogue file, loaded as a draft (or skipped when already published). Used by Playwright's global setup. */
export async function loadCatalogueVersion(supabase: ReturnType<typeof createServiceRoleClient>, sector: string, version: number): Promise<void> {
  await loadOne(supabase, path.join(CONTENT_ROOT, sector, `${String(version)}.json`));
}

async function main(): Promise<void> {
  const env = loadEnv();
  assertCatalogueFilesAllowed(env.SUPABASE_URL);
  const supabase = createServiceRoleClient(env);
  const files = await contentFiles();
  if (files.length === 0) {
    console.error('No catalogue content found under content/catalogue/<sector>/<version>.json.');
    process.exitCode = 1;
    return;
  }
  for (const file of files) await loadOne(supabase, file);
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}

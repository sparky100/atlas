/**
 * `pnpm content:review-catalogue` — D3 PR 2. Checks every
 * `content/catalogue/<sector>/<version>.json` before a person signs or
 * publishes it:
 *
 * - the file matches its own `<sector>/<version>` path;
 * - the pinned `capabilityMapVersion` is a **published** map of that sector;
 * - every capability link's code and name match that pinned map version;
 * - every claim carries a reviewer in `content/catalogue/reviewers.json`;
 * - no source date is in the future, and review is not before its source;
 * - the schema's own no-price and HTTPS URL rules hold.
 *
 * It reports every problem and exits 1. Nothing is published or written.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { productCatalogueContentSchema, type ProductCatalogueContent } from '../src/contracts/productCatalogue';
import { createServiceRoleClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { isCliEntrypoint } from './isCliEntrypoint';

const CONTENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'catalogue');
const REVIEWERS_FILE = path.join(CONTENT_ROOT, 'reviewers.json');

interface ReviewerFile {
  reviewers?: { name?: unknown }[];
}

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

async function reviewerNames(): Promise<Set<string>> {
  const raw: unknown = JSON.parse(await readFile(REVIEWERS_FILE, 'utf8'));
  const names = ((raw as ReviewerFile).reviewers ?? []).flatMap((r) => (typeof r.name === 'string' && r.name.trim() !== '' ? [r.name.trim()] : []));
  return new Set(names);
}

async function main(): Promise<void> {
  const reviewers = await reviewerNames();
  if (reviewers.size === 0) {
    console.error('reviewers.json lists no reviewers. Add a named person before reviewing content.');
    process.exitCode = 1;
    return;
  }
  const supabase = createServiceRoleClient(loadEnv());
  const files = await contentFiles();
  if (files.length === 0) {
    console.error('No catalogue content found under content/catalogue/<sector>/<version>.json.');
    process.exitCode = 1;
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  let problems = 0;
  for (const file of files) {
    const label = path.relative(CONTENT_ROOT, file);
    const parsed = productCatalogueContentSchema.safeParse(JSON.parse(await readFile(file, 'utf8')) as unknown);
    if (!parsed.success) {
      console.error(`${label}: invalid content — ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      problems += 1;
      continue;
    }
    const content: ProductCatalogueContent = parsed.data;
    const [sectorDir, versionFile] = label.split(path.sep);
    const versionFromPath = versionFile ? Number(versionFile.replace(/\.json$/, '')) : NaN;
    if (sectorDir !== content.sector || versionFromPath !== content.version) {
      console.error(`${label}: path says ${sectorDir ?? '?'}/${String(versionFromPath)}, file says ${content.sector}/${String(content.version)}`);
      problems += 1;
      continue;
    }

    const map = await supabase.from('capability_maps').select('id, status').eq('sector', content.sector).eq('version', content.capabilityMapVersion).maybeSingle();
    if (map.error) throw new Error(`${label}: ${map.error.message}`);
    const mapRow = map.data;
    if (mapRow?.status !== 'published') {
      console.error(`${label}: pinned map ${content.sector} v${String(content.capabilityMapVersion)} is not published${mapRow ? ` (it is ${String(mapRow.status)})` : ''}. A catalogue can only publish against a published map version.`);
      problems += 1;
      continue;
    }
    const items = await supabase.from('capability_map_items').select('code, name').eq('map_id', mapRow.id);
    if (items.error) throw new Error(`${label}: ${items.error.message}`);
    const nameByCode = new Map(((items.data as { code: string; name: string }[] | null) ?? []).map((i) => [i.code, i.name]));

    for (const entry of content.entries) {
      for (const capability of entry.capabilities) {
        const name = nameByCode.get(capability.code);
        if (name === undefined) {
          console.error(`${label}: entry "${entry.code}" cites capability ${capability.code}, which is not in ${content.sector} v${String(content.capabilityMapVersion)}.`);
          problems += 1;
        } else if (name !== capability.name) {
          console.error(`${label}: entry "${entry.code}" cites ${capability.code} as "${capability.name}", but the pinned map calls it "${name}".`);
          problems += 1;
        }
      }
      for (const claim of entry.claims) {
        if (!reviewers.has(claim.reviewedBy)) {
          console.error(`${label}: entry "${entry.code}" position ${String(claim.position)}: reviewer "${claim.reviewedBy}" is not in reviewers.json. A named person must sign every claim.`);
          problems += 1;
        }
        if (claim.sourceDate > today) {
          console.error(`${label}: entry "${entry.code}" position ${String(claim.position)}: source date ${claim.sourceDate} is in the future.`);
          problems += 1;
        }
        if (claim.reviewedAt < claim.sourceDate) {
          console.error(`${label}: entry "${entry.code}" position ${String(claim.position)}: review date ${claim.reviewedAt} is before the source date ${claim.sourceDate}.`);
          problems += 1;
        }
      }
    }
    if (problems === 0) console.log(`${label}: OK (${String(content.entries.length)} entries)`);
  }
  if (problems > 0) {
    console.error(`\n${String(problems)} problem(s). Nothing was published.`);
    process.exitCode = 1;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}

/**
 * `pnpm content:review-catalogue` — D3 PR 2. Checks
 * `content/catalogue/<sector>/<version>.json` before a person signs or
 * publishes it. By default it checks every file; `--sector` or `--file`
 * narrows it to one catalogue, so unsigned drafts in other sectors do not
 * block the gate.
 *
 * - the file matches its own `<sector>/<version>` path;
 * - the pinned `capabilityMapVersion` is a **published** map of that sector;
 * - every capability link's code and name match that pinned map version;
 * - every claim carries a reviewer in `content/catalogue/reviewers.json`;
 * - no source date is in the future, and review is not before its source;
 * - the schema's own no-price and HTTPS URL rules hold.
 *
 * It reports every problem and exits 1. Nothing is published or written.
 *
 * Usage:
 *   pnpm content:review-catalogue
 *   pnpm content:review-catalogue --sector electricity_network
 *   pnpm content:review-catalogue --file content/catalogue/electricity_network/2.json
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

const USAGE = [
  'Usage:',
  '  pnpm content:review-catalogue',
  '  pnpm content:review-catalogue --sector electricity_network',
  '  pnpm content:review-catalogue --file content/catalogue/electricity_network/2.json',
  '',
  'With neither option it reviews every catalogue file.',
].join('\n');

export interface ContentFilter {
  sector?: string;
  file?: string;
}

/** Pure: read `--sector` / `--file`, rejecting ambiguous or malformed input. */
export function parseArgs(args: readonly string[]): ContentFilter {
  const known = new Set(['--sector', '--file']);
  for (const arg of args) {
    if (arg.startsWith('--') && !known.has(arg)) throw new Error(`Unknown option ${arg}.\n\n${USAGE}`);
  }
  const valueOf = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value.\n\n${USAGE}`);
    return value;
  };
  const sector = valueOf('--sector');
  const file = valueOf('--file');
  if (sector !== undefined && file !== undefined) throw new Error(`Use either --sector or --file, not both.\n\n${USAGE}`);
  if (sector !== undefined && (sector.trim() === '' || sector.includes('/') || sector.includes('\\'))) {
    throw new Error(`--sector must be a sector folder name.\n\n${USAGE}`);
  }
  return { ...(sector !== undefined ? { sector } : {}), ...(file !== undefined ? { file } : {}) };
}

/**
 * Pure: narrow the discovered files to one sector or one file. A file may be
 * given from the repository root or relative to `content/catalogue`; it must
 * resolve inside the catalogue root.
 */
export function selectContentFiles(files: readonly string[], filter: ContentFilter, root: string = CONTENT_ROOT): string[] {
  if (filter.file !== undefined) {
    const candidates = [path.resolve(filter.file), path.resolve(root, filter.file)];
    const target = candidates.find((candidate) => {
      const relative = path.relative(root, candidate);
      return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
    if (target === undefined || path.extname(target).toLowerCase() !== '.json') {
      throw new Error(`--file must be a .json file under ${root}.`);
    }
    return files.filter((file) => path.resolve(file) === target);
  }
  if (filter.sector !== undefined) {
    return files.filter((file) => path.basename(path.dirname(path.resolve(file))) === filter.sector);
  }
  return [...files];
}

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
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const filter = parseArgs(process.argv.slice(2));
  const reviewers = await reviewerNames();
  if (reviewers.size === 0) {
    console.error('reviewers.json lists no reviewers. Add a named person before reviewing content.');
    process.exitCode = 1;
    return;
  }
  const supabase = createServiceRoleClient(loadEnv());
  const files = selectContentFiles(await contentFiles(), filter);
  if (files.length === 0) {
    const target = filter.file ?? (filter.sector !== undefined ? `sector "${filter.sector}"` : 'content/catalogue/<sector>/<version>.json');
    console.error(`No catalogue content matched ${target}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Reviewing ${String(files.length)} catalogue file(s).`);

  const today = new Date().toISOString().slice(0, 10);
  let problems = 0;
  for (const file of files) {
    const before = problems;
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
    if (problems === before) console.log(`${label}: OK (${String(content.entries.length)} entries)`);
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

/**
 * Read-only inventory for platform reference content. No writes, publication,
 * migration, or model import. `pnpm content:inventory` reports repository
 * content; `pnpm content:inventory --live` also compares the live database.
 * Only counts, stable identifiers, and content fingerprints are printed.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCapabilityMapContent } from '../src/contracts/capabilityMapContent';
import { productCatalogueContentSchema } from '../src/contracts/productCatalogue';
import { createServiceRoleClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { isCliEntrypoint } from './isCliEntrypoint';

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'content');
type Database = ReturnType<typeof createServiceRoleClient>;
type QueryRows = Record<string, unknown>;

export interface MapInventory {
  sector: string;
  version: number;
  status: string;
  itemCount: number;
  sourceCount: number;
  valueStreamCount: number;
  itemFingerprint: string;
  referenceFingerprint: string;
  seededModelCount?: number;
}

export interface CatalogueInventory {
  sector: string;
  version: number;
  capabilityMapVersion: number;
  status: string;
  entryCount: number;
  supportCount: number;
  claimCount: number;
  contentFingerprint: string;
  citedOptionCount?: number;
  withdrawn?: boolean;
}

export interface CandidateOccurrence { sector: string; version: number; code: string }
export interface DuplicateCandidate { label: string; occurrences: CandidateOccurrence[] }
export interface Inventory {
  maps: MapInventory[];
  catalogues: CatalogueInventory[];
  sharedCapabilityCandidates: DuplicateCandidate[];
  duplicateProductCandidates: DuplicateCandidate[];
}

const key = (sector: string, version: number) => `${sector}\u0000${String(version)}`;
const sorted = <T>(rows: readonly T[], select: (row: T) => string): T[] => [...rows].sort((a, b) => select(a).localeCompare(select(b)));
const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const number = (value: unknown): number => typeof value === 'number' ? value : 0;

/** A hash of the map facts, independent of database ids, status and dates. */
export function mapItemFingerprint(items: readonly { code: string; parent: string | null; name: string; description: string | null; level: number; order: number }[]): string {
  return fingerprint(sorted(items, (item) => item.code).map(({ code, parent, name, description, level, order }) =>
    ({ code, parent, name, description, level, order })));
}

function mapReferenceFingerprint(
  sources: readonly { citation: string; url: string | null; reviewedBy: string; reviewedAt: string }[],
  streams: readonly { code: string; parent: string | null; name: string; description: string | null; order: number }[],
  enables: readonly { stage: string; capability: string }[],
): string {
  return fingerprint({
    sources: sorted(sources, (source) => JSON.stringify(source)),
    streams: sorted(streams, (stream) => stream.code),
    enables: sorted(enables, (link) => `${link.stage}\u0000${link.capability}`),
  });
}

/** Same content shape for repository files and database rows. */
export function catalogueFingerprint(entries: readonly {
  code: string; product: string; vendor: string; summary: string;
  supports: readonly { code: string; name: string; how: string }[];
  claims: readonly { position: number; kind: string; statement: string; url: string; date: string }[];
}[]): string {
  return fingerprint(sorted(entries, (entry) => entry.code).map((entry) => ({
    code: entry.code, product: entry.product, vendor: entry.vendor, summary: entry.summary,
    supports: sorted(entry.supports, (support) => support.code),
    claims: sorted(entry.claims, (claim) => String(claim.position).padStart(6, '0')),
  })));
}

function candidates(rows: readonly { label: string; occurrence: CandidateOccurrence }[]): DuplicateCandidate[] {
  const byName = new Map<string, { label: string; occurrences: CandidateOccurrence[] }>();
  for (const row of rows) {
    const normalized = row.label.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
    const group = byName.get(normalized) ?? { label: row.label, occurrences: [] };
    group.occurrences.push(row.occurrence);
    byName.set(normalized, group);
  }
  return sorted([...byName.values()].filter((group) => new Set(group.occurrences.map((o) => o.sector)).size > 1), (group) => group.label)
    .map((group) => ({ ...group, occurrences: sorted(group.occurrences, (o) => `${o.sector}\u0000${String(o.version).padStart(5, '0')}\u0000${o.code}`) }));
}

async function filesIn(group: 'capability-maps' | 'catalogue'): Promise<string[]> {
  const root = path.join(CONTENT, group);
  const sectors = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const sector of sectors) {
    if (!sector.isDirectory()) continue;
    for (const file of await readdir(path.join(root, sector.name), { withFileTypes: true })) {
      if (file.isFile() && /^\d+\.json$/.test(file.name)) files.push(path.join(root, sector.name, file.name));
    }
  }
  return files.sort();
}

function checkPath(file: string, sector: string, version: number): void {
  if (path.basename(path.dirname(file)) !== sector || path.basename(file) !== `${String(version)}.json`) {
    throw new Error(`${file}: sector/version disagree with content`);
  }
}

export async function repositoryInventory(): Promise<Inventory> {
  const maps: MapInventory[] = [];
  const catalogues: CatalogueInventory[] = [];
  const capabilities: { label: string; occurrence: CandidateOccurrence }[] = [];
  const products: { label: string; occurrence: CandidateOccurrence }[] = [];

  for (const file of await filesIn('capability-maps')) {
    const content = parseCapabilityMapContent(JSON.parse(await readFile(file, 'utf8')) as unknown, file);
    checkPath(file, content.sector, content.version);
    maps.push({ sector: content.sector, version: content.version, status: content.status,
      itemCount: content.items.length, sourceCount: content.sources.length, valueStreamCount: content.valueStreams.length,
      itemFingerprint: mapItemFingerprint(content.items.map((item) => ({ code: item.code, parent: item.parentCode,
        name: item.name, description: item.description ?? null, level: item.level, order: item.order }))),
      referenceFingerprint: mapReferenceFingerprint(
        content.sources.map((source) => ({ citation: source.citation, url: source.url ?? null, reviewedBy: source.reviewedBy, reviewedAt: source.reviewedAt })),
        content.valueStreams.flatMap((stream) => [
          { code: stream.code, parent: null, name: stream.name, description: stream.description ?? null, order: stream.order },
          ...stream.stages.map((stage) => ({ code: stage.code, parent: stream.code, name: stage.name, description: stage.description ?? null, order: stage.order })),
        ]),
        content.valueStreams.flatMap((stream) => stream.stages.flatMap((stage) => stage.enables.map((name) => {
          const item = content.items.find((capability) => capability.name === name);
          if (!item) throw new Error(`${file}: stream ${stage.code} enables missing capability ${name}`);
          return { stage: stage.code, capability: item.code };
        }))),
      ) });
    for (const item of content.items) capabilities.push({ label: item.name, occurrence: { sector: content.sector, version: content.version, code: item.code } });
  }

  for (const file of await filesIn('catalogue')) {
    const content = productCatalogueContentSchema.parse(JSON.parse(await readFile(file, 'utf8')) as unknown);
    checkPath(file, content.sector, content.version);
    catalogues.push({ sector: content.sector, version: content.version, capabilityMapVersion: content.capabilityMapVersion,
      status: content.status, entryCount: content.entries.length,
      supportCount: content.entries.reduce((sum, entry) => sum + entry.capabilities.length, 0),
      claimCount: content.entries.reduce((sum, entry) => sum + entry.claims.length, 0),
      contentFingerprint: catalogueFingerprint(content.entries.map((entry) => ({
        code: entry.code, product: entry.product, vendor: entry.vendor, summary: entry.summary,
        supports: entry.capabilities.map((capability) => ({ code: capability.code, name: capability.name, how: capability.howItSupports })),
        claims: entry.claims.map((claim) => ({ position: claim.position, kind: claim.kind, statement: claim.statement, url: claim.sourceUrl, date: claim.sourceDate })),
      }))) });
    for (const entry of content.entries) products.push({ label: `${entry.vendor} / ${entry.product}`, occurrence: { sector: content.sector, version: content.version, code: entry.code } });
  }
  return { maps, catalogues, sharedCapabilityCandidates: candidates(capabilities), duplicateProductCandidates: candidates(products) };
}

/** PostgREST defaults to 1000 rows. Page explicitly so inventory cannot silently undercount. */
async function allRows(db: Database, table: string, columns: string, orderBy = 'id', column?: string, value?: string): Promise<QueryRows[]> {
  const rows: QueryRows[] = [];
  for (let start = 0; ; start += 500) {
    let query = db.from(table).select(columns);
    for (const field of orderBy.split(',')) query = query.order(field);
    query = query.range(start, start + 499);
    if (column && value) query = query.eq(column, value);
    const { data, error } = await query;
    if (error) throw new Error(`${table} inventory read failed: ${error.message}`);
    // Dynamic table names make postgrest-js infer GenericStringError rows.
    const page = data as unknown as QueryRows[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

export async function liveInventory(db: Database): Promise<Pick<Inventory, 'maps' | 'catalogues'>> {
  const [mapRows, catalogueRows, seeded, cited] = await Promise.all([
    allRows(db, 'capability_maps', 'id,sector,version,status'),
    allRows(db, 'product_catalogues', 'id,sector,version,capability_map_version,status,withdrawn_at'),
    allRows(db, 'sources', 'id,capability_map_id,model_id', 'id', 'kind', 'template'),
    allRows(db, 'option_catalogue_sources', 'catalogue_sector,catalogue_version,decision_id,branch_id,entry_code', 'decision_id,branch_id,catalogue_sector,catalogue_version,entry_code'),
  ]);
  const maps: MapInventory[] = [];
  const catalogues: CatalogueInventory[] = [];
  for (const map of mapRows) {
    const id = text(map.id);
    const [items, sources, streams, enables] = await Promise.all([
      allRows(db, 'capability_map_items', 'code,parent_code,name,description,level,item_order', 'code', 'map_id', id),
      allRows(db, 'capability_map_sources', 'id,citation,url,reviewed_by,reviewed_at', 'id', 'map_id', id),
      allRows(db, 'capability_map_value_stream_items', 'id,code,parent_code,name,description,item_order', 'id', 'map_id', id),
      allRows(db, 'capability_map_value_stream_enables', 'stage_code,capability_code', 'stage_code,capability_code', 'map_id', id),
    ]);
    maps.push({ sector: text(map.sector), version: number(map.version), status: text(map.status),
      itemCount: items.length, sourceCount: sources.length, valueStreamCount: streams.filter((item) => item.parent_code === null).length,
      itemFingerprint: mapItemFingerprint(items.map((item) => ({ code: text(item.code), parent: item.parent_code === null ? null : text(item.parent_code),
        name: text(item.name), description: item.description === null ? null : text(item.description), level: number(item.level), order: number(item.item_order) }))),
      referenceFingerprint: mapReferenceFingerprint(
        sources.map((source) => ({ citation: text(source.citation), url: source.url === null ? null : text(source.url),
          reviewedBy: text(source.reviewed_by), reviewedAt: text(source.reviewed_at) })),
        streams.map((stream) => ({ code: text(stream.code), parent: stream.parent_code === null ? null : text(stream.parent_code),
          name: text(stream.name), description: stream.description === null ? null : text(stream.description), order: number(stream.item_order) })),
        enables.map((link) => ({ stage: text(link.stage_code), capability: text(link.capability_code) })),
      ),
      seededModelCount: new Set(seeded.filter((source) => source.capability_map_id === id).map((source) => text(source.model_id))).size });
  }
  for (const catalogue of catalogueRows) {
    const id = text(catalogue.id);
    const entries = await allRows(db, 'catalogue_entries', 'id,code,product,vendor,summary', 'id', 'catalogue_id', id);
    let supportCount = 0;
    let claimCount = 0;
    const detail = [];
    for (const entry of entries) {
      const [supports, claims] = await Promise.all([
        allRows(db, 'catalogue_entry_capabilities', 'capability_code,capability_name,how_it_supports', 'capability_code', 'entry_id', text(entry.id)),
        allRows(db, 'catalogue_claims', 'position,kind,statement,source_url,source_date', 'position', 'entry_id', text(entry.id)),
      ]);
      supportCount += supports.length;
      claimCount += claims.length;
      detail.push({ code: text(entry.code), product: text(entry.product), vendor: text(entry.vendor), summary: text(entry.summary),
        supports: supports.map((support) => ({ code: text(support.capability_code), name: text(support.capability_name), how: text(support.how_it_supports) })),
        claims: claims.map((claim) => ({ position: number(claim.position), kind: text(claim.kind), statement: text(claim.statement), url: text(claim.source_url), date: text(claim.source_date) })),
      });
    }
    catalogues.push({ sector: text(catalogue.sector), version: number(catalogue.version), capabilityMapVersion: number(catalogue.capability_map_version),
      status: text(catalogue.status), withdrawn: catalogue.withdrawn_at !== null,
      entryCount: entries.length, supportCount, claimCount, contentFingerprint: catalogueFingerprint(detail),
      citedOptionCount: cited.filter((source) => source.catalogue_sector === catalogue.sector && source.catalogue_version === catalogue.version).length });
  }
  return { maps: sorted(maps, (map) => key(map.sector, map.version)), catalogues: sorted(catalogues, (catalogue) => key(catalogue.sector, catalogue.version)) };
}

export function reconcile(repo: Inventory, live: Pick<Inventory, 'maps' | 'catalogues'>): { maps: string[]; catalogues: string[] } {
  const compare = <T extends { sector: string; version: number; status: string }>(kind: 'map' | 'catalogue', local: T[], remote: T[], signature: (row: T) => string): string[] => {
    const left = new Map(local.map((row) => [key(row.sector, row.version), row]));
    const right = new Map(remote.map((row) => [key(row.sector, row.version), row]));
    const differences: string[] = [];
    for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
      const file = left.get(id), database = right.get(id);
      const label = `${kind} ${id.replace('\u0000', ' v')}`;
      if (!file) differences.push(`${label}: live only`);
      else if (!database) differences.push(`${label}: repository only`);
      else {
        if (file.status !== database.status) differences.push(`${label}: repository ${file.status}, live ${database.status}`);
        if (signature(file) !== signature(database)) differences.push(`${label}: content differs`);
      }
    }
    return differences;
  };
  return {
    maps: compare('map', repo.maps, live.maps, (row) => JSON.stringify([row.itemCount, row.sourceCount, row.valueStreamCount, row.itemFingerprint, row.referenceFingerprint])),
    catalogues: compare('catalogue', repo.catalogues, live.catalogues, (row) => JSON.stringify([
      row.capabilityMapVersion, row.entryCount, row.supportCount, row.claimCount, row.contentFingerprint,
    ])),
  };
}

async function main(): Promise<void> {
  const repo = await repositoryInventory();
  if (process.argv.includes('--live')) {
    const live = await liveInventory(createServiceRoleClient(loadEnv()));
    process.stdout.write(`${JSON.stringify({ repository: repo, live, differences: reconcile(repo, live) }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ repository: repo, live: 'not queried; pass --live with server-side Supabase credentials' }, null, 2)}\n`);
  }
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}

import type { DecisionOptionMark } from '../contracts/decisionOptionMark';
import type { CatalogueCitation, CatalogueSnapshot, ProductCatalogueContent, ProductCatalogueRow, CatalogueEntryRow, CatalogueCapabilityRow, CatalogueClaimRow, OptionCatalogueSourceRow, CatalogueStanding } from '../contracts/productCatalogue';
import type { OptionSource } from '../contracts/optionSource';
import { productCatalogueContentSchema } from '../contracts/productCatalogue';
import type { Client } from './client';

export type { CatalogueStanding };

export interface CatalogueRows {
  catalogue: ProductCatalogueRow;
  entries: CatalogueEntryRow[];
  capabilities: CatalogueCapabilityRow[];
  claims: CatalogueClaimRow[];
}

/** Pure storage conversion; the caller supplies identities and the clock. */
export function catalogueToRows(content: ProductCatalogueContent, id: () => string, at: string): CatalogueRows {
  const catalogueId = id();
  const rows: CatalogueRows = {
    catalogue: { id: catalogueId, sector: content.sector, version: content.version, capability_map_version: content.capabilityMapVersion,
      status: content.status, title: content.title, source_description: content.sourceDescription, licence: content.licence,
      published_at: content.status === 'published' ? at : null, created_at: at, withdrawn_at: null, withdrawn_reason: null },
    entries: [], capabilities: [], claims: [],
  };
  for (const entry of content.entries) {
    const entryId = id();
    rows.entries.push({ id: entryId, catalogue_id: catalogueId, code: entry.code, product: entry.product, vendor: entry.vendor, summary: entry.summary, created_at: at });
    rows.capabilities.push(...entry.capabilities.map((c) => ({ entry_id: entryId, capability_code: c.code, capability_name: c.name, how_it_supports: c.howItSupports })));
    rows.claims.push(...entry.claims.map((c) => ({ id: id(), entry_id: entryId, position: c.position, kind: c.kind, statement: c.statement,
      source_url: c.sourceUrl, source_date: c.sourceDate, reviewed_by: c.reviewedBy, reviewed_at: c.reviewedAt, created_at: at })));
  }
  return rows;
}

export function catalogueFromRows(rows: CatalogueRows): ProductCatalogueContent {
  const c = rows.catalogue;
  return productCatalogueContentSchema.parse({ sector: c.sector, version: c.version, capabilityMapVersion: c.capability_map_version,
    status: c.status, title: c.title, sourceDescription: c.source_description, licence: c.licence,
    entries: rows.entries.map((e) => ({ code: e.code, product: e.product, vendor: e.vendor, summary: e.summary,
      capabilities: rows.capabilities.filter((l) => l.entry_id === e.id).map((l) => ({ code: l.capability_code, name: l.capability_name, howItSupports: l.how_it_supports })),
      claims: rows.claims.filter((q) => q.entry_id === e.id).map((q) => ({ position: q.position, kind: q.kind, statement: q.statement,
        sourceUrl: q.source_url, sourceDate: q.source_date, reviewedBy: q.reviewed_by, reviewedAt: q.reviewed_at })),
    })),
  });
}

/** The branch is created first using its stable card ID. Nothing is linked until this transaction succeeds. */
export async function addOptionWithCatalogueSources(client: Client, mark: DecisionOptionMark, sources: readonly CatalogueCitation[]): Promise<void> {
  const { decisionId, branchId, ...provenance } = mark;
  const { error } = await client.rpc('add_option_with_catalogue_sources', {
    p_decision: decisionId, p_branch: branchId, p_mark: provenance, p_sources: sources,
  });
  if (error) throw new Error(`addOptionWithCatalogueSources: ${error.message}`);
}

/** Decision-scoped read, not an unbounded list of branch IDs. Rendering arrives with the source contract. */
export async function listCatalogueSources(client: Client, decisionId: string): Promise<OptionCatalogueSourceRow[]> {
  const { data, error } = await client.from('option_catalogue_sources').select('*').eq('decision_id', decisionId)
    .order('branch_id').order('catalogue_sector').order('catalogue_version').order('entry_code');
  if (error) throw new Error(`listCatalogueSources: ${error.message}`);
  return data as OptionCatalogueSourceRow[];
}

/** Shared expected shape for a catalogue citation, useful for export/round-trip validation. */
export function catalogueSnapshotFromRows(rows: CatalogueRows, entryId: string): CatalogueSnapshot {
  const entry = rows.entries.find((e) => e.id === entryId);
  if (!entry) throw new Error('Catalogue entry does not exist');
  const content = catalogueFromRows({ ...rows, entries: [entry] });
  const e = content.entries[0];
  if (!e) throw new Error('Catalogue entry does not exist');
  return { sector: content.sector, version: content.version, capabilityMapVersion: content.capabilityMapVersion,
    catalogueTitle: content.title, licence: content.licence, entryCode: e.code, product: e.product, vendor: e.vendor,
    summary: e.summary, capabilities: [...e.capabilities].sort((a, b) => a.code.localeCompare(b.code)), claims: [...e.claims].sort((a, b) => a.position - b.position) };
}

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- untyped Supabase client; see src/db/branches.ts's module comment. */

// ---------------------------------------------------------------------------
// D3 PR 3: reading the current published catalogue. The one query path the
// capability-page section, the citation panel and (later) the Designer tool
// use, so they cannot disagree about "the current version". "Current" is the
// highest published, non-withdrawn version of a sector.
// ---------------------------------------------------------------------------

export interface CapabilityCatalogueMatch {
  sector: string;
  /** The catalogue's pinned starter-map version (not the catalogue's own version). */
  capabilityMapVersion: number;
  capabilityCode: string;
  capabilityName: string;
}

export interface CatalogueClaim {
  statement: string;
  kind: 'functional' | 'deployment' | 'licensing_model' | 'support_end' | 'integration';
  sourceUrl: string;
  sourceDate: string;
  reviewedBy: string;
  reviewedAt: string;
}

export interface CatalogueEntry {
  id: string;
  code: string;
  product: string;
  vendor: string;
  summary: string;
  howItSupports: string;
  claims: CatalogueClaim[];
}

export interface CitedCatalogueEntry extends CatalogueEntry {
  sector: string;
  version: number;
  title: string;
  licence: string;
  publishedAt: string | null;
  standing: CatalogueStanding;
  withdrawnReason: string | null;
  newerVersion: number | null;
}

/** The live standing of every cited catalogue, so saved citations can be marked without one query per source. */
export async function catalogueStandingByCitation(client: Client, citations: readonly { sector: string; version: number }[]): Promise<Map<string, CatalogueStanding>> {
  const sectors = [...new Set(citations.map((c) => c.sector))];
  if (sectors.length === 0) return new Map();
  const { data, error } = await client
    .from('product_catalogues')
    .select('sector, version, status, withdrawn_at')
    .in('sector', sectors);
  if (error) throw new Error(`catalogueStandingByCitation: ${error.message}`);
  const rows = (data as { sector: string; version: number; status: 'draft' | 'published'; withdrawn_at: string | null }[] | null) ?? [];
  const currentVersion = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== 'published' || row.withdrawn_at !== null) continue;
    if ((currentVersion.get(row.sector) ?? 0) < row.version) currentVersion.set(row.sector, row.version);
  }
  const standing = new Map<string, CatalogueStanding>();
  for (const citation of citations) {
    const row = rows.find((r) => r.sector === citation.sector && r.version === citation.version);
    // A published catalogue cannot be deleted. If it cannot be read at all, treat the saved citation as no longer current rather than presenting it as current.
    const value: CatalogueStanding = row?.withdrawn_at !== null
      ? 'withdrawn'
      : (currentVersion.get(citation.sector) ?? 0) > citation.version ? 'replaced' : 'current';
    standing.set(`${citation.sector}\u0000${String(citation.version)}`, value);
  }
  return standing;
}

/** Pure mapping from saved rows plus live standing; no fetch, so it is unit-testable. */
export function optionSourcesFromRows(rows: readonly OptionCatalogueSourceRow[], standingByCitation: ReadonlyMap<string, CatalogueStanding>): OptionSource[] {
  return rows.map((row) => ({
    kind: 'catalogue' as const,
    id: `${row.branch_id}\u0000${row.catalogue_sector}\u0000${String(row.catalogue_version)}\u0000${row.entry_code}`,
    branchId: row.branch_id,
    sector: row.catalogue_sector,
    version: row.catalogue_version,
    entryCode: row.entry_code,
    product: row.snapshot.product,
    vendor: row.snapshot.vendor,
    summary: row.snapshot.summary,
    licence: row.snapshot.licence,
    standing: standingByCitation.get(`${row.catalogue_sector}\u0000${String(row.catalogue_version)}`) ?? 'withdrawn',
    citedBy: row.cited_by,
    citedAt: row.cited_at,
    claims: row.snapshot.claims,
  }));
}

/** Every saved catalogue citation on a decision, ready for the option blocks and the pack. */
export async function listOptionSources(client: Client, decisionId: string): Promise<OptionSource[]> {
  const rows = await listCatalogueSources(client, decisionId);
  if (rows.length === 0) return [];
  const standing = await catalogueStandingByCitation(client, rows.map((r) => ({ sector: r.catalogue_sector, version: r.catalogue_version })));
  return optionSourcesFromRows(rows, standing);
}

/** The map item a seeded capability came from, via `attributes.templateRef`. */
export async function capabilityMapMatch(client: Client, templateRef: string): Promise<CapabilityCatalogueMatch | null> {
  const item = await client.from('capability_map_items').select('map_id, code, name').eq('id', templateRef).maybeSingle();
  if (item.error) throw new Error(`capabilityMapMatch: ${item.error.message}`);
  const row = item.data;
  if (!row) return null;
  const map = await client.from('capability_maps').select('sector, version').eq('id', row.map_id).maybeSingle();
  if (map.error) throw new Error(`capabilityMapMatch: ${map.error.message}`);
  const mapRow = map.data;
  if (!mapRow) return null;
  return { sector: mapRow.sector, capabilityMapVersion: mapRow.version, capabilityCode: row.code, capabilityName: row.name };
}

async function currentCatalogue(client: Client, sector: string): Promise<{ id: string; version: number; title: string; published_at: string | null } | null> {
  const { data, error } = await client
    .from('product_catalogues')
    .select('id, version, title, published_at')
    .eq('sector', sector)
    .eq('status', 'published')
    .is('withdrawn_at', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`currentCatalogue: ${error.message}`);
  return data;
}

async function claimsForEntries(client: Client, entryIds: readonly string[]): Promise<Map<string, CatalogueClaim[]>> {
  const byEntry = new Map<string, CatalogueClaim[]>();
  if (entryIds.length === 0) return byEntry;
  const { data, error } = await client
    .from('catalogue_claims')
    .select('entry_id, statement, kind, source_url, source_date, reviewed_by, reviewed_at, position')
    .in('entry_id', entryIds)
    .order('position', { ascending: true });
  if (error) throw new Error(`claimsForEntries: ${error.message}`);
  for (const row of (data as { entry_id: string; statement: string; kind: CatalogueClaim['kind']; source_url: string; source_date: string; reviewed_by: string; reviewed_at: string }[] | null) ?? []) {
    const list = byEntry.get(row.entry_id) ?? [];
    list.push({ statement: row.statement, kind: row.kind, sourceUrl: row.source_url, sourceDate: row.source_date, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at });
    byEntry.set(row.entry_id, list);
  }
  return byEntry;
}

/** Current published entries that support this capability code, with their claims. */
export async function listCurrentCatalogueEntriesForCapability(client: Client, match: { sector: string; capabilityCode: string }): Promise<CatalogueEntry[]> {
  const catalogue = await currentCatalogue(client, match.sector);
  if (!catalogue) return [];
  const links = await client.from('catalogue_entry_capabilities').select('entry_id, how_it_supports').eq('capability_code', match.capabilityCode);
  if (links.error) throw new Error(`listCurrentCatalogueEntriesForCapability: ${links.error.message}`);
  const linkRows = (links.data as { entry_id: string; how_it_supports: string }[] | null) ?? [];
  if (linkRows.length === 0) return [];
  const entryIds = linkRows.map((l) => l.entry_id);
  const entries = await client.from('catalogue_entries').select('id, code, product, vendor, summary').eq('catalogue_id', catalogue.id).in('id', entryIds);
  if (entries.error) throw new Error(`listCurrentCatalogueEntriesForCapability: ${entries.error.message}`);
  const entryRows = (entries.data as { id: string; code: string; product: string; vendor: string; summary: string }[] | null) ?? [];
  const howByEntry = new Map(linkRows.map((l) => [l.entry_id, l.how_it_supports]));
  const claims = await claimsForEntries(client, entryRows.map((e) => e.id));
  return entryRows
    .map((e) => ({ id: e.id, code: e.code, product: e.product, vendor: e.vendor, summary: e.summary, howItSupports: howByEntry.get(e.id) ?? '', claims: claims.get(e.id) ?? [] }))
    .sort((a, b) => a.product.localeCompare(b.product));
}

/** One entry by the citation stored on an option or a pack, with its standing. */
export async function catalogueEntryByCitation(client: Client, citation: CatalogueCitation): Promise<CitedCatalogueEntry | null> {
  const catalogue = await client
    .from('product_catalogues')
    .select('id, version, title, licence, published_at, withdrawn_at, withdrawn_reason')
    .eq('sector', citation.sector)
    .eq('version', citation.version)
    .eq('status', 'published')
    .maybeSingle();
  if (catalogue.error) throw new Error(`catalogueEntryByCitation: ${catalogue.error.message}`);
  const cat = catalogue.data;
  if (!cat) return null;
  const entry = await client.from('catalogue_entries').select('id, code, product, vendor, summary').eq('catalogue_id', cat.id).eq('code', citation.entryCode).maybeSingle();
  if (entry.error) throw new Error(`catalogueEntryByCitation: ${entry.error.message}`);
  const row = entry.data;
  if (!row) return null;
  const link = await client.from('catalogue_entry_capabilities').select('how_it_supports').eq('entry_id', row.id).limit(1).maybeSingle();
  if (link.error) throw new Error(`catalogueEntryByCitation: ${link.error.message}`);
  const claims = (await claimsForEntries(client, [row.id])).get(row.id) ?? [];
  const current = await currentCatalogue(client, citation.sector);
  const newer = current !== null && current.version > cat.version ? current.version : null;
  const standing: CatalogueStanding = cat.withdrawn_at !== null ? 'withdrawn' : newer !== null ? 'replaced' : 'current';
  return {
    id: row.id, code: row.code, product: row.product, vendor: row.vendor, summary: row.summary,
    howItSupports: (link.data)?.how_it_supports ?? '', claims,
    sector: citation.sector, version: cat.version, title: cat.title, licence: cat.licence, publishedAt: cat.published_at,
    standing, withdrawnReason: cat.withdrawn_reason, newerVersion: newer,
  };
}

/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */

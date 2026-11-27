import type { DecisionOptionMark } from '../contracts/decisionOptionMark';
import type { CatalogueCitation, CatalogueSnapshot, ProductCatalogueContent, ProductCatalogueRow, CatalogueEntryRow, CatalogueCapabilityRow, CatalogueClaimRow, OptionCatalogueSourceRow, CatalogueStanding } from '../contracts/productCatalogue';
import type { OptionSource } from '../contracts/optionSource';
import { productCatalogueContentSchema } from '../contracts/productCatalogue';
import type { Client } from './client';
import { queryInChunks } from './inFilterLimit';
import { listOptionWebSources } from './optionWebSources';
import { listPublishedProductsForCapability } from './publishedProducts';

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

export interface InsertOptionCatalogueSourceInput {
  decisionId: string;
  optionId: string;
  sector: string;
  version: number;
  entryCode: string;
  citedBy: string;
}

/**
 * Saves one reviewed catalogue product with a candidate option that already
 * exists. RLS checks the caller may add options to the proposed decision
 * (option_catalogue_sources_insert); a repeat is reported plainly.
 */
export async function insertOptionCatalogueSource(client: Client, input: InsertOptionCatalogueSourceInput): Promise<void> {
  const { error } = await client.from('option_catalogue_sources').insert({
    decision_id: input.decisionId,
    option_id: input.optionId,
    branch_id: null,
    catalogue_sector: input.sector,
    catalogue_version: input.version,
    entry_code: input.entryCode,
    cited_by: input.citedBy,
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('This product is already saved with this option.');
    throw new Error(`insertOptionCatalogueSource: ${error.message}`);
  }
}

/** Decision-scoped read, not an unbounded list of branch IDs. Rendering arrives with the source contract. */
export async function listCatalogueSources(client: Client, decisionId: string): Promise<OptionCatalogueSourceRow[]> {
  const { data, error } = await client.from('option_catalogue_sources').select('*').eq('decision_id', decisionId)
    .order('option_id').order('catalogue_sector').order('catalogue_version').order('entry_code');
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

/**
 * A product the user can cite, with the citation that would be saved for it.
 * A published product revision cites as sector 'product', its revision number
 * and the product's code (20261126240000); a sector catalogue entry cites as
 * its sector, catalogue version and entry code.
 */
export interface CitableCatalogueEntry extends CatalogueEntry {
  citation: { sector: string; version: number };
  /** Where a published product sits, as recorded when it was published. Absent for a sector catalogue entry. */
  platform?: { partOf: string | null; components: string[] };
}

/** The sector name a citation to a published product revision carries. Not a sector. */
export const PRODUCT_CITATION_SECTOR = 'product';

/** What stands for a citation in a map of standings. A product's version is its own revision number, so its code is part of the key. */
export function citationStandingKey(citation: { sector: string; version: number; entryCode?: string }): string {
  return citation.sector === PRODUCT_CITATION_SECTOR
    ? `${citation.sector}\u0000${String(citation.version)}\u0000${citation.entryCode ?? ''}`
    : `${citation.sector}\u0000${String(citation.version)}`;
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

/** The live standing of every cited catalogue or product revision, so saved citations can be marked without one query per source. */
export async function catalogueStandingByCitation(client: Client, citations: readonly { sector: string; version: number; entryCode?: string }[]): Promise<Map<string, CatalogueStanding>> {
  const standing = new Map<string, CatalogueStanding>();
  const sectorCitations = citations.filter((c) => c.sector !== PRODUCT_CITATION_SECTOR);
  const productCitations = citations.filter((c) => c.sector === PRODUCT_CITATION_SECTOR);
  const sectors = [...new Set(sectorCitations.map((c) => c.sector))];
  if (sectors.length > 0) {
    const rows = await queryInChunks<string, { sector: string; version: number; status: 'draft' | 'published'; withdrawn_at: string | null }>('catalogueStandingByCitation', 'sector', sectors, (chunk) =>
      client.from('product_catalogues').select('sector, version, status, withdrawn_at').in('sector', chunk),
    );
    const currentVersion = new Map<string, number>();
    for (const row of rows) {
      if (row.status !== 'published' || row.withdrawn_at !== null) continue;
      if ((currentVersion.get(row.sector) ?? 0) < row.version) currentVersion.set(row.sector, row.version);
    }
    for (const citation of sectorCitations) {
      const row = rows.find((r) => r.sector === citation.sector && r.version === citation.version);
      // A published catalogue cannot be deleted. If it cannot be read at all, treat the saved citation as no longer current rather than presenting it as current.
      const value: CatalogueStanding = row?.withdrawn_at !== null
        ? 'withdrawn'
        : (currentVersion.get(citation.sector) ?? 0) > citation.version ? 'replaced' : 'current';
      standing.set(citationStandingKey(citation), value);
    }
  }
  const codes = [...new Set(productCitations.map((c) => c.entryCode ?? ''))].filter((code) => code !== '');
  if (codes.length > 0) {
    const revisions = await queryInChunks<string, { code: string; revision: number; withdrawn_at: string | null; superseded_at: string | null }>('catalogueStandingByCitation', 'code', codes, (chunk) =>
      client.from('catalogue_product_revisions').select('code, revision, withdrawn_at, superseded_at').in('code', chunk),
    );
    for (const citation of productCitations) {
      const code = citation.entryCode ?? '';
      const cited = revisions.find((r) => r.code === code && r.revision === citation.version);
      let value: CatalogueStanding;
      if (cited?.withdrawn_at !== null) value = 'withdrawn';
      else if (cited.superseded_at === null) value = 'current';
      else {
        // Replaced only if the newer revision is itself published; a product whose newer revision was withdrawn is no longer published at all.
        const newer = revisions.some((r) => r.code === code && r.revision > citation.version && r.withdrawn_at === null && r.superseded_at === null);
        value = newer ? 'replaced' : 'withdrawn';
      }
      standing.set(citationStandingKey(citation), value);
    }
  }
  return standing;
}

/** Pure mapping from saved rows plus live standing; no fetch, so it is unit-testable. */
export function optionSourcesFromRows(rows: readonly OptionCatalogueSourceRow[], standingByCitation: ReadonlyMap<string, CatalogueStanding>): OptionSource[] {
  return rows.map((row) => ({
    kind: 'catalogue' as const,
    id: `${row.option_id}\u0000${row.catalogue_sector}\u0000${String(row.catalogue_version)}\u0000${row.entry_code}`,
    optionId: row.option_id,
    branchId: row.branch_id,
    sector: row.catalogue_sector,
    version: row.catalogue_version,
    entryCode: row.entry_code,
    product: row.snapshot.product,
    vendor: row.snapshot.vendor,
    summary: row.snapshot.summary,
    licence: row.snapshot.licence,
    standing: standingByCitation.get(citationStandingKey({ sector: row.catalogue_sector, version: row.catalogue_version, entryCode: row.entry_code })) ?? 'withdrawn',
    citedBy: row.cited_by,
    citedAt: row.cited_at,
    claims: row.snapshot.claims,
  }));
}

/** Every source saved with a decision's options: reviewed catalogue claims first, then web pages. */
export async function listOptionSources(client: Client, decisionId: string): Promise<OptionSource[]> {
  const [rows, web] = await Promise.all([listCatalogueSources(client, decisionId), listOptionWebSources(client, decisionId)]);
  if (rows.length === 0) return web;
  const standing = await catalogueStandingByCitation(client, rows.map((r) => ({ sector: r.catalogue_sector, version: r.catalogue_version, entryCode: r.entry_code })));
  return [...optionSourcesFromRows(rows, standing), ...web];
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

/** The sectors of the starter maps this model was seeded from. A draft map can be reloaded and its item ids replaced, so the sector is also the durable part of the link. */
export async function templateSectorsForModel(client: Client, modelId: string): Promise<string[]> {
  const sources = await client.from('sources').select('capability_map_id').eq('model_id', modelId).eq('kind', 'template').not('capability_map_id', 'is', null);
  if (sources.error) throw new Error(`templateSectorsForModel: ${sources.error.message}`);
  const ids = [...new Set(((sources.data as { capability_map_id: string | null }[] | null) ?? []).flatMap((s) => (s.capability_map_id === null ? [] : [s.capability_map_id])))];
  if (ids.length === 0) return [];
  const maps = await queryInChunks<string, { sector: string }>('templateSectorsForModel', 'id', ids, (chunk) => client.from('capability_maps').select('sector').in('id', chunk));
  return [...new Set(maps.map((m) => m.sector))];
}

/** A capability code's item in the current published map for one sector. Codes are stable across map versions; item ids are not. */
export async function publishedMapItemForCapability(client: Client, sector: string, code: string): Promise<CapabilityCatalogueMatch | null> {
  const map = await client
    .from('capability_maps')
    .select('id, sector, version')
    .eq('sector', sector)
    .eq('status', 'published')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (map.error) throw new Error(`publishedMapItemForCapability: ${map.error.message}`);
  const mapRow = map.data;
  if (!mapRow) return null;
  const item = await client.from('capability_map_items').select('code, name').eq('map_id', mapRow.id).eq('code', code).maybeSingle();
  if (item.error) throw new Error(`publishedMapItemForCapability: ${item.error.message}`);
  const row = item.data;
  if (!row) return null;
  return { sector: mapRow.sector, capabilityMapVersion: mapRow.version, capabilityCode: row.code, capabilityName: row.name };
}

/**
 * The fallback for a capability whose stored `templateRef` no longer resolves:
 * the capability's code in the current published map for the sector the model
 * was seeded from. When the model has been seeded from more than one sector,
 * only a single unambiguous match is accepted.
 */
export async function publishedCapabilityMatchForModel(client: Client, modelId: string, code: string): Promise<CapabilityCatalogueMatch | null> {
  const sectors = await templateSectorsForModel(client, modelId);
  const matches: CapabilityCatalogueMatch[] = [];
  for (const sector of sectors) {
    const match = await publishedMapItemForCapability(client, sector, code);
    if (match) matches.push(match);
  }
  return matches.length === 1 ? matches[0] ?? null : null;
}

export async function currentCatalogue(client: Client, sector: string): Promise<{ id: string; version: number; title: string; published_at: string | null } | null> {
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
  // Pieces of at most 50 ids (build rule 8). Each entry's claims all come from one piece, so their order by position is kept.
  const data = await queryInChunks<string, { entry_id: string; statement: string; kind: CatalogueClaim['kind']; source_url: string; source_date: string; reviewed_by: string; reviewed_at: string }>('claimsForEntries', 'entry_id', entryIds, (chunk) =>
    client.from('catalogue_claims').select('entry_id, statement, kind, source_url, source_date, reviewed_by, reviewed_at, position').in('entry_id', chunk).order('position', { ascending: true }),
  );
  for (const row of data) {
    const list = byEntry.get(row.entry_id) ?? [];
    list.push({ statement: row.statement, kind: row.kind, sourceUrl: row.source_url, sourceDate: row.source_date, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at });
    byEntry.set(row.entry_id, list);
  }
  return byEntry;
}

/** Published sector-catalogue entries only (the history kept from before products were published on their own). */
async function listSectorCatalogueEntriesForCapability(client: Client, match: { sector: string; capabilityCode: string }): Promise<CitableCatalogueEntry[]> {
  const catalogue = await currentCatalogue(client, match.sector);
  if (!catalogue) return [];
  const links = await client.from('catalogue_entry_capabilities').select('entry_id, how_it_supports').eq('capability_code', match.capabilityCode);
  if (links.error) throw new Error(`listCurrentCatalogueEntriesForCapability: ${links.error.message}`);
  const linkRows = (links.data as { entry_id: string; how_it_supports: string }[] | null) ?? [];
  if (linkRows.length === 0) return [];
  const entryIds = linkRows.map((l) => l.entry_id);
  const entryRows = await queryInChunks<string, { id: string; code: string; product: string; vendor: string; summary: string }>('listCurrentCatalogueEntriesForCapability', 'id', entryIds, (chunk) =>
    client.from('catalogue_entries').select('id, code, product, vendor, summary').eq('catalogue_id', catalogue.id).in('id', chunk),
  );
  const howByEntry = new Map(linkRows.map((l) => [l.entry_id, l.how_it_supports]));
  const claims = await claimsForEntries(client, entryRows.map((e) => e.id));
  return entryRows.map((e) => ({
    id: e.id, code: e.code, product: e.product, vendor: e.vendor, summary: e.summary, howItSupports: howByEntry.get(e.id) ?? '', claims: claims.get(e.id) ?? [],
    citation: { sector: match.sector, version: catalogue.version },
  }));
}

/** The same product, whichever list it came from: vendor and product name, ignoring case and spacing. */
const productIdentity = (entry: { vendor: string; product: string }): string => `${entry.vendor.trim().toLowerCase()}\u0000${entry.product.trim().toLowerCase()}`;

/**
 * Current published products that support this capability, each with the
 * citation to save for it (step 4b-2). Products published on their own come
 * first and win; an entry from a sector catalogue that is the same product is
 * not listed a second time. A product that is only in a sector catalogue
 * (electricity v1, until it is re-published as a product) keeps showing from it.
 */
export async function listCurrentCatalogueEntriesForCapability(client: Client, match: { sector: string; capabilityCode: string }): Promise<CitableCatalogueEntry[]> {
  const [published, sector] = await Promise.all([
    listPublishedProductsForCapability(client, match),
    listSectorCatalogueEntriesForCapability(client, match),
  ]);
  return mergeCatalogueEntries(published.map((p) => ({
    id: p.revisionId, code: p.code, product: p.product, vendor: p.vendor, summary: p.summary, howItSupports: p.howItSupports,
    claims: p.claims.map((c) => ({ statement: c.statement, kind: c.kind, sourceUrl: c.sourceUrl, sourceDate: c.sourceDate, reviewedBy: c.reviewedBy, reviewedAt: c.reviewedAt })),
    citation: { sector: PRODUCT_CITATION_SECTOR, version: p.revision },
    platform: { partOf: p.partOf, components: p.components },
  })), sector);
}

/** Pure: products published on their own first; a sector entry that is the same product is dropped; sorted by product name. */
export function mergeCatalogueEntries(fromProducts: readonly CitableCatalogueEntry[], fromSectors: readonly CitableCatalogueEntry[]): CitableCatalogueEntry[] {
  const seen = new Set(fromProducts.map(productIdentity));
  return [...fromProducts, ...fromSectors.filter((entry) => !seen.has(productIdentity(entry)))]
    .sort((a, b) => a.product.localeCompare(b.product));
}

/**
 * Current published products for the capability an element is, resolved from
 * the element's own starter-map link (or its stable code when that link is
 * stale). Used to recognise a returned web page as a product the catalogue
 * already holds; it never creates a product or a recommendation.
 */
export async function currentCatalogueEntriesForCapabilityElement(
  client: Client,
  modelId: string,
  attributes: unknown,
): Promise<CitableCatalogueEntry[]> {
  if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) return [];
  const attrs = attributes as Record<string, unknown>;
  const templateRef = typeof attrs.templateRef === 'string' && attrs.templateRef.trim() !== '' ? attrs.templateRef : null;
  const code = typeof attrs.code === 'string' && attrs.code.trim() !== '' ? attrs.code.trim() : '';
  const match = templateRef !== null ? await capabilityMapMatch(client, templateRef) : null;
  const resolved = match ?? (code !== '' ? await publishedCapabilityMatchForModel(client, modelId, code) : null);
  if (resolved === null) return [];
  return listCurrentCatalogueEntriesForCapability(client, { sector: resolved.sector, capabilityCode: resolved.capabilityCode });
}

/**
 * The same products, with the citation each would be saved under, so they can
 * be saved as an option's source. Empty when the capability has no starter-map
 * link or nothing is published for it.
 */
export async function citableCatalogueProductsForCapabilityElement(
  client: Client,
  modelId: string,
  attributes: unknown,
): Promise<{ sector: string; version: number; entry: CatalogueEntry }[]> {
  const entries = await currentCatalogueEntriesForCapabilityElement(client, modelId, attributes);
  return entries.map((entry) => ({ sector: entry.citation.sector, version: entry.citation.version, entry }));
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

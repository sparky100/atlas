import type { DecisionOptionMark } from '../contracts/decisionOptionMark';
import type { CatalogueCitation, CatalogueSnapshot, ProductCatalogueContent, ProductCatalogueRow, CatalogueEntryRow, CatalogueCapabilityRow, CatalogueClaimRow, OptionCatalogueSourceRow } from '../contracts/productCatalogue';
import { productCatalogueContentSchema } from '../contracts/productCatalogue';
import type { Client } from './client';

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

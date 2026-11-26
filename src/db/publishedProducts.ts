import type { Client } from './client';
import { assertInFilterSize, queryInChunks } from './inFilterLimit';

/**
 * Catalogue step 4b-1: the products a platform admin has published, read for
 * one capability. A product is published when its newest revision is not
 * withdrawn; row security (20261126230000) lets a signed-in user see exactly
 * those revisions, so this reader cannot show a draft or a withdrawn product.
 * Not used by a screen yet (step 4b-2).
 */

export interface PublishedProductClaim {
  statement: string;
  kind: 'functional' | 'deployment' | 'licensing_model' | 'support_end' | 'integration';
  sourceUrl: string;
  sourceDate: string;
  reviewedBy: string;
  reviewedAt: string;
  origin: 'person' | 'researcher' | 'imported';
}

export interface PublishedProduct {
  revisionId: string;
  productId: string;
  revision: number;
  code: string;
  product: string;
  vendor: string;
  summary: string;
  howItSupports: string;
  approvedByName: string | null;
  approvedAt: string;
  claims: PublishedProductClaim[];
}

/** The general capabilities that published map items for this sector and code are aligned to. */
async function sharedCapabilityIds(client: Client, sector: string, capabilityCode: string): Promise<string[]> {
  const maps = await client.from('capability_maps').select('id').eq('sector', sector).eq('status', 'published');
  if (maps.error) throw new Error(`listPublishedProductsForCapability: ${maps.error.message}`);
  const mapIds = ((maps.data as { id: string }[] | null) ?? []).map((m) => m.id);
  if (mapIds.length === 0) return [];
  const items = await queryInChunks<string, { id: string }>('listPublishedProductsForCapability', 'map_id', mapIds, (chunk) =>
    client.from('capability_map_items').select('id').eq('code', capabilityCode).in('map_id', chunk));
  if (items.length === 0) return [];
  const links = await queryInChunks<string, { capability_id: string }>('listPublishedProductsForCapability', 'map_item_id', items.map((i) => i.id), (chunk) =>
    client.from('reference_map_item_links').select('capability_id').in('map_item_id', chunk));
  return [...new Set(links.map((l) => l.capability_id))];
}

/**
 * Published products that support a capability: those linked to its shared
 * identity (any sector) and those linked to its code in its own sector.
 * One entry per product, with the newest published revision and its claims.
 */
export async function listPublishedProductsForCapability(client: Client, match: { sector: string; capabilityCode: string }): Promise<PublishedProduct[]> {
  const capabilityIds = await sharedCapabilityIds(client, match.sector, match.capabilityCode);
  assertInFilterSize('listPublishedProductsForCapability', 'capability_id', capabilityIds);
  const sectorLinks = client.from('catalogue_product_revision_links').select('revision_id, how_it_supports')
    .eq('kind', 'sector').eq('sector', match.sector).eq('capability_code', match.capabilityCode);
  const sharedLinks = capabilityIds.length === 0 ? null
    : client.from('catalogue_product_revision_links').select('revision_id, how_it_supports').eq('kind', 'shared').in('capability_id', capabilityIds);
  const [sector, shared] = await Promise.all([sectorLinks, sharedLinks]);
  if (sector.error) throw new Error(`listPublishedProductsForCapability: ${sector.error.message}`);
  if (shared?.error) throw new Error(`listPublishedProductsForCapability: ${shared.error.message}`);
  const howByRevision = new Map<string, string>();
  // A link in the capability's own sector is worded for it, so it wins over a shared one.
  for (const row of [...((shared?.data as { revision_id: string; how_it_supports: string }[] | null) ?? []), ...((sector.data as { revision_id: string; how_it_supports: string }[] | null) ?? [])]) {
    howByRevision.set(row.revision_id, row.how_it_supports);
  }
  const revisionIds = [...howByRevision.keys()];
  if (revisionIds.length === 0) return [];
  // Row security keeps only each product's newest, not-withdrawn revision.
  const revisions = await queryInChunks<string, { id: string; product_id: string; revision: number; code: string; product: string; vendor: string; summary: string; published_by_name: string | null; published_at: string }>('listPublishedProductsForCapability', 'id', revisionIds, (chunk) =>
    client.from('catalogue_product_revisions').select('id, product_id, revision, code, product, vendor, summary, published_by_name, published_at').in('id', chunk));
  const claimRows = await queryInChunks<string, { revision_id: string; position: number; statement: string; kind: PublishedProductClaim['kind']; source_url: string; source_date: string; reviewed_by: string; reviewed_at: string; origin: PublishedProductClaim['origin'] }>('listPublishedProductsForCapability', 'revision_id', revisions.map((r) => r.id), (chunk) =>
    client.from('catalogue_product_revision_claims').select('revision_id, position, statement, kind, source_url, source_date, reviewed_by, reviewed_at, origin').in('revision_id', chunk).order('position', { ascending: true }));
  const claimsByRevision = new Map<string, PublishedProductClaim[]>();
  for (const row of claimRows) {
    const list = claimsByRevision.get(row.revision_id) ?? [];
    list.push({ statement: row.statement, kind: row.kind, sourceUrl: row.source_url, sourceDate: row.source_date, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, origin: row.origin });
    claimsByRevision.set(row.revision_id, list);
  }
  return revisions
    .map((r) => ({
      revisionId: r.id, productId: r.product_id, revision: r.revision, code: r.code, product: r.product, vendor: r.vendor, summary: r.summary,
      howItSupports: howByRevision.get(r.id) ?? '', approvedByName: r.published_by_name, approvedAt: r.published_at,
      claims: claimsByRevision.get(r.id) ?? [],
    }))
    .sort((a, b) => a.product.localeCompare(b.product));
}

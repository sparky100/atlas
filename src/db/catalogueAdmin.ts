/**
 * Platform-admin catalogue reads/writes. The browser never writes the
 * reference tables directly: every mutation is one of the guarded RPCs in
 * `20261122120000_catalogue_admin.sql`, which re-check platform-admin status
 * and optimistic revisions. This module only maps rows and calls those RPCs.
 */
import type { UUID } from '../contracts/delta';
import {
  catalogueDraftContentSchema,
  catalogueProductContentSchema,
  type CapabilitySetItem,
  type CapabilitySetOption,
  type CatalogueDraftContent,
  type CatalogueDraftRow,
  type CatalogueProductContent,
  type CatalogueProductRow,
  type CatalogueProductSummary,
  type CatalogueVersionSummary,
} from '../contracts/catalogueAdmin';
import type { Client } from './client';

interface ProductRow {
  id: string;
  code: string;
  product: string;
  vendor: string;
  summary: string;
  edit_revision: number;
  created_at: string;
  updated_at: string;
}

interface LinkRow {
  product_id: string;
  capability_map_id: string;
  capability_code: string;
  capability_name: string;
  how_it_supports: string;
}

interface ClaimRow {
  id: string;
  product_id: string;
  position: number;
  kind: CatalogueProductContent['claims'][number]['kind'];
  statement: string;
  source_url: string;
  source_date: string;
  reviewed_by: string;
  reviewed_at: string;
}

export interface CatalogueProductDetail {
  product: CatalogueProductRow;
  content: CatalogueProductContent;
}

export async function listCatalogueProducts(client: Client): Promise<CatalogueProductSummary[]> {
  const [products, links, claims] = await Promise.all([
    client.from('catalogue_products').select('id,code,product,vendor,summary,edit_revision,created_at,updated_at').order('product'),
    client.from('catalogue_product_capabilities').select('product_id,capability_map_id'),
    client.from('catalogue_product_claims').select('product_id'),
  ]);
  if (products.error) throw new Error(`listCatalogueProducts: ${products.error.message}`);
  if (links.error) throw new Error(`listCatalogueProducts: ${links.error.message}`);
  if (claims.error) throw new Error(`listCatalogueProducts: ${claims.error.message}`);

  const capabilityCount = new Map<string, number>();
  const sets = new Map<string, Set<string>>();
  const countsByMap = new Map<string, Record<string, number>>();
  for (const row of (links.data as { product_id: string; capability_map_id: string }[] | null) ?? []) {
    capabilityCount.set(row.product_id, (capabilityCount.get(row.product_id) ?? 0) + 1);
    const set = sets.get(row.product_id) ?? new Set<string>();
    set.add(row.capability_map_id);
    sets.set(row.product_id, set);
    const byMap = countsByMap.get(row.product_id) ?? {};
    byMap[row.capability_map_id] = (byMap[row.capability_map_id] ?? 0) + 1;
    countsByMap.set(row.product_id, byMap);
  }
  const claimCount = new Map<string, number>();
  for (const row of (claims.data as { product_id: string }[] | null) ?? []) {
    claimCount.set(row.product_id, (claimCount.get(row.product_id) ?? 0) + 1);
  }

  return ((products.data as ProductRow[] | null) ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    product: row.product,
    vendor: row.vendor,
    summary: row.summary,
    revision: row.edit_revision,
    updatedAt: row.updated_at,
    capabilityCount: capabilityCount.get(row.id) ?? 0,
    capabilitySetCount: sets.get(row.id)?.size ?? 0,
    claimCount: claimCount.get(row.id) ?? 0,
    capabilityCountsByMap: countsByMap.get(row.id) ?? {},
  }));
}

export async function readCatalogueProduct(client: Client, productId: UUID): Promise<CatalogueProductDetail> {
  const [product, links, claims] = await Promise.all([
    client.from('catalogue_products').select('id,code,product,vendor,summary,edit_revision,created_at,updated_at').eq('id', productId).maybeSingle(),
    client.from('catalogue_product_capabilities').select('product_id,capability_map_id,capability_code,capability_name,how_it_supports').eq('product_id', productId),
    client.from('catalogue_product_claims').select('id,product_id,position,kind,statement,source_url,source_date,reviewed_by,reviewed_at')
      .eq('product_id', productId).order('position'),
  ]);
  if (product.error) throw new Error(`readCatalogueProduct: ${product.error.message}`);
  if (links.error) throw new Error(`readCatalogueProduct: ${links.error.message}`);
  if (claims.error) throw new Error(`readCatalogueProduct: ${claims.error.message}`);
  const row: ProductRow | null = product.data;
  if (!row) throw new Error('readCatalogueProduct: that product is no longer available');

  const content = catalogueProductContentSchema.parse({
    code: row.code,
    product: row.product,
    vendor: row.vendor,
    summary: row.summary,
    capabilities: ((links.data as LinkRow[] | null) ?? []).map((link) => ({
      capabilityMapId: link.capability_map_id,
      capabilityCode: link.capability_code,
      capabilityName: link.capability_name,
      howItSupports: link.how_it_supports,
    })),
    claims: ((claims.data as ClaimRow[] | null) ?? []).map((claim) => ({
      position: claim.position,
      kind: claim.kind,
      statement: claim.statement,
      sourceUrl: claim.source_url,
      sourceDate: claim.source_date,
      reviewedBy: claim.reviewed_by,
      reviewedAt: claim.reviewed_at,
    })),
  });
  return {
    product: {
      id: row.id, code: row.code, product: row.product, vendor: row.vendor, summary: row.summary,
      edit_revision: row.edit_revision, created_at: row.created_at, updated_at: row.updated_at,
    },
    content,
  };
}

export async function saveCatalogueProduct(
  client: Client,
  productId: UUID | null,
  expectedRevision: number,
  content: CatalogueProductContent,
): Promise<{ productId: UUID; revision: number }> {
  const parsed = catalogueProductContentSchema.parse(content);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('save_catalogue_product', {
    p_id: productId, p_expected_revision: expectedRevision, p_content: parsed,
  });
  if (error) throw new Error(`saveCatalogueProduct: ${error.message}`);
  const result = data as { productId: UUID; revision: number };
  return result;
}

export async function validateCatalogueProduct(client: Client, content: CatalogueProductContent): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('catalogue_product_issues', { p_content: content });
  if (error) throw new Error(`validateCatalogueProduct: ${error.message}`);
  return data as string[];
}

export async function listCapabilitySets(client: Client): Promise<CapabilitySetOption[]> {
  const { data, error } = await client.from('capability_maps')
    .select('id,sector,version,status,title')
    .order('sector')
    .order('version', { ascending: false });
  if (error) throw new Error(`listCapabilitySets: ${error.message}`);
  return data;
}

export async function listCapabilitySetItems(client: Client, mapId: UUID): Promise<CapabilitySetItem[]> {
  const { data, error } = await client.from('capability_map_items')
    .select('id,code,name,parent_code,level,item_order')
    .eq('map_id', mapId)
    .order('level')
    .order('item_order');
  if (error) throw new Error(`listCapabilitySetItems: ${error.message}`);
  return ((data as { id: string; code: string; name: string; parent_code: string | null; level: number; item_order: number }[] | null) ?? [])
    .map((item) => ({ id: item.id, code: item.code, name: item.name, parentCode: item.parent_code, level: item.level, order: item.item_order }));
}

export async function listCatalogueVersions(client: Client): Promise<CatalogueVersionSummary[]> {
  const { data, error } = await client.from('product_catalogues')
    .select('id,sector,version,capability_map_version,status,title,published_at,withdrawn_at,withdrawn_reason')
    .order('sector')
    .order('version', { ascending: false });
  if (error) throw new Error(`listCatalogueVersions: ${error.message}`);
  return data;
}

export interface CatalogueEntryDetail {
  id: string;
  code: string;
  product: string;
  vendor: string;
  summary: string;
  capabilities: { code: string; name: string; howItSupports: string }[];
  claims: { statement: string; kind: string; sourceUrl: string; sourceDate: string; reviewedBy: string; reviewedAt: string }[];
}

/** One published version's fixed entry snapshots, for the admin's read-only view. */
export async function listCatalogueEntries(client: Client, catalogueId: UUID): Promise<CatalogueEntryDetail[]> {
  const entries = await client.from('catalogue_entries')
    .select('id,code,product,vendor,summary')
    .eq('catalogue_id', catalogueId)
    .order('product');
  if (entries.error) throw new Error(`listCatalogueEntries: ${entries.error.message}`);
  const rows = (entries.data as { id: string; code: string; product: string; vendor: string; summary: string }[] | null) ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [links, claims] = await Promise.all([
    client.from('catalogue_entry_capabilities').select('entry_id,capability_code,capability_name,how_it_supports').in('entry_id', ids),
    client.from('catalogue_claims').select('entry_id,position,kind,statement,source_url,source_date,reviewed_by,reviewed_at').in('entry_id', ids).order('position'),
  ]);
  if (links.error) throw new Error(`listCatalogueEntries: ${links.error.message}`);
  if (claims.error) throw new Error(`listCatalogueEntries: ${claims.error.message}`);
  const linkRows = (links.data as { entry_id: string; capability_code: string; capability_name: string; how_it_supports: string }[] | null) ?? [];
  const claimRows = (claims.data as { entry_id: string; kind: string; statement: string; source_url: string; source_date: string; reviewed_by: string; reviewed_at: string }[] | null) ?? [];
  return rows.map((row) => ({
    ...row,
    capabilities: linkRows.filter((link) => link.entry_id === row.id)
      .map((link) => ({ code: link.capability_code, name: link.capability_name, howItSupports: link.how_it_supports })),
    claims: claimRows.filter((claim) => claim.entry_id === row.id)
      .map((claim) => ({ statement: claim.statement, kind: claim.kind, sourceUrl: claim.source_url, sourceDate: claim.source_date, reviewedBy: claim.reviewed_by, reviewedAt: claim.reviewed_at })),
  }));
}

/** The canonical product IDs already in one published catalogue, used to start the next draft. */
export async function listCatalogueProductIds(client: Client, catalogueId: UUID): Promise<UUID[]> {
  const [entries, products] = await Promise.all([
    client.from('catalogue_entries').select('product_id,code,product,vendor').eq('catalogue_id', catalogueId),
    client.from('catalogue_products').select('id,code,product,vendor'),
  ]);
  if (entries.error) throw new Error(`listCatalogueProductIds: ${entries.error.message}`);
  if (products.error) throw new Error(`listCatalogueProductIds: ${products.error.message}`);
  const productRows = (products.data as { id: string; code: string; product: string; vendor: string }[] | null) ?? [];
  const byCode = new Map(productRows.map((row) => [row.code, row.id]));
  const normalise = (value: string) => value.trim().toLowerCase();
  const byName = new Map(productRows.map((row) => [`${normalise(row.vendor)}\u0000${normalise(row.product)}`, row.id]));
  return ((entries.data as { product_id: string | null; code: string; product: string; vendor: string }[] | null) ?? [])
    .flatMap((row) => {
      const id = row.product_id ?? byCode.get(row.code) ?? byName.get(`${normalise(row.vendor)}\u0000${normalise(row.product)}`);
      return id === undefined ? [] : [id];
    });
}

export async function listCatalogueDrafts(client: Client): Promise<CatalogueDraftRow[]> {
  const { data, error } = await client.from('catalogue_drafts')
    .select('id,base_catalogue_id,sector,version,content,edit_revision,status,published_catalogue_id,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`listCatalogueDrafts: ${error.message}`);
  return ((data as { id: string; base_catalogue_id: string | null; sector: string; version: number; content: unknown; edit_revision: number; status: 'draft' | 'published'; published_catalogue_id: string | null; updated_at: string }[] | null) ?? [])
    .map((row) => ({ ...row, content: catalogueDraftContentSchema.parse(row.content) }));
}

export async function createCatalogueDraft(
  client: Client,
  sector: string,
  version: number,
  baseCatalogueId: UUID | null,
  content: CatalogueDraftContent,
): Promise<UUID> {
  const parsed = catalogueDraftContentSchema.parse(content);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('create_catalogue_draft', {
    p_sector: sector, p_version: version, p_base_catalogue_id: baseCatalogueId, p_content: parsed,
  });
  if (error) throw new Error(`createCatalogueDraft: ${error.message}`);
  return data as UUID;
}

export async function saveCatalogueDraft(client: Client, draft: CatalogueDraftRow, content: CatalogueDraftContent): Promise<number> {
  const parsed = catalogueDraftContentSchema.parse(content);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('save_catalogue_draft', {
    p_id: draft.id, p_expected_revision: draft.edit_revision, p_content: parsed,
  });
  if (error) throw new Error(`saveCatalogueDraft: ${error.message}`);
  return data as number;
}

export async function validateCatalogueDraft(client: Client, content: CatalogueDraftContent): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('catalogue_draft_issues', { p_content: content });
  if (error) throw new Error(`validateCatalogueDraft: ${error.message}`);
  return data as string[];
}

export async function publishCatalogueDraft(client: Client, draft: CatalogueDraftRow): Promise<UUID> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('publish_catalogue_draft', {
    p_id: draft.id, p_expected_revision: draft.edit_revision,
  });
  if (error) throw new Error(`publishCatalogueDraft: ${error.message}`);
  return data as UUID;
}

export async function withdrawCatalogue(client: Client, catalogueId: UUID, reason: string): Promise<void> {
  const { error } = await client.schema('atlas').rpc('withdraw_catalogue', { p_id: catalogueId, p_reason: reason });
  if (error) throw new Error(`withdrawCatalogue: ${error.message}`);
}

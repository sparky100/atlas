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
  type CatalogueClaimReview,
  type CatalogueDraftRow,
  type CatalogueProductContent,
  type CatalogueProductRow,
  type CatalogueProductSummary,
  type GeneralCapabilityOption,
  type CatalogueVersionSummary,
  type ClaimOrigin,
  type ClaimReviewState,
  type ClaimWaitingForReview,
  type ProductPublicationState,
  productPublicationLabel,
} from '../contracts/catalogueAdmin';
import type { Client } from './client';
import { queryInChunks } from './inFilterLimit';

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
  review_state: ClaimReviewState;
  origin: ClaimOrigin;
  drafted_by_name: string | null;
  drafted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

const CLAIM_COLUMNS = 'id,product_id,position,kind,statement,source_url,source_date,review_state,origin,drafted_by_name,drafted_at,reviewed_by,reviewed_at';

export interface CatalogueProductDetail {
  product: CatalogueProductRow;
  content: CatalogueProductContent;
  /** Each saved claim's review record. The editor's own claims carry no reviewer. */
  claimReviews: CatalogueClaimReview[];
  /** The latest published revision, or null when the product has never been published. */
  publication: ProductPublicationState | null;
}

interface RevisionRow {
  product_id?: string;
  revision: number;
  product_edit_revision: number;
  published_by_name: string | null;
  published_at: string;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
  withdrawn_by_name: string | null;
}

function publicationState(row: RevisionRow, editRevision: number): ProductPublicationState {
  return {
    revision: row.revision,
    approvedByName: row.published_by_name,
    approvedAt: row.published_at,
    withdrawnAt: row.withdrawn_at,
    withdrawnReason: row.withdrawn_reason,
    withdrawnByName: row.withdrawn_by_name,
    unpublishedChanges: editRevision > row.product_edit_revision,
  };
}

export async function listCatalogueProducts(client: Client): Promise<CatalogueProductSummary[]> {
  const [products, links, claims, shared, revisions] = await Promise.all([
    client.from('catalogue_products').select('id,code,product,vendor,summary,edit_revision,created_at,updated_at').order('product'),
    client.from('catalogue_product_capabilities').select('product_id,capability_map_id'),
    client.from('catalogue_product_claims').select('product_id,review_state'),
    client.from('catalogue_product_general_links').select('product_id'),
    client.from('catalogue_product_revisions').select('product_id,revision,product_edit_revision,published_by_name,published_at,withdrawn_at,withdrawn_reason,withdrawn_by_name'),
  ]);
  if (revisions.error) throw new Error(`listCatalogueProducts: ${revisions.error.message}`);
  if (products.error) throw new Error(`listCatalogueProducts: ${products.error.message}`);
  if (shared.error) throw new Error(`listCatalogueProducts: ${shared.error.message}`);
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
  const latestRevision = new Map<string, RevisionRow>();
  for (const row of (revisions.data as (RevisionRow & { product_id: string })[] | null) ?? []) {
    const current = latestRevision.get(row.product_id);
    if (!current || row.revision > current.revision) latestRevision.set(row.product_id, row);
  }
  const sharedCount = new Map<string, number>();
  for (const row of (shared.data as { product_id: string }[] | null) ?? []) {
    sharedCount.set(row.product_id, (sharedCount.get(row.product_id) ?? 0) + 1);
  }
  const claimCount = new Map<string, number>();
  const waitingCount = new Map<string, number>();
  for (const row of (claims.data as { product_id: string; review_state: ClaimReviewState }[] | null) ?? []) {
    claimCount.set(row.product_id, (claimCount.get(row.product_id) ?? 0) + 1);
    if (row.review_state === 'drafted') waitingCount.set(row.product_id, (waitingCount.get(row.product_id) ?? 0) + 1);
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
    sharedCapabilityCount: sharedCount.get(row.id) ?? 0,
    capabilitySetCount: sets.get(row.id)?.size ?? 0,
    claimCount: claimCount.get(row.id) ?? 0,
    claimsWaitingForReview: waitingCount.get(row.id) ?? 0,
    publication: productPublicationLabel((() => { const latest = latestRevision.get(row.id); return latest ? publicationState(latest, row.edit_revision) : null; })()),
    capabilityCountsByMap: countsByMap.get(row.id) ?? {},
  }));
}

export async function readCatalogueProduct(client: Client, productId: UUID): Promise<CatalogueProductDetail> {
  const [product, links, claims, shared, revision] = await Promise.all([
    client.from('catalogue_products').select('id,code,product,vendor,summary,edit_revision,created_at,updated_at').eq('id', productId).maybeSingle(),
    client.from('catalogue_product_capabilities').select('product_id,capability_map_id,capability_code,capability_name,how_it_supports').eq('product_id', productId),
    client.from('catalogue_product_claims').select(CLAIM_COLUMNS)
      .eq('product_id', productId).order('position'),
    client.from('catalogue_product_general_links').select('capability_id,how_it_supports')
      .eq('product_id', productId).order('capability_id'),
    client.from('catalogue_product_revisions')
      .select('revision,product_edit_revision,published_by_name,published_at,withdrawn_at,withdrawn_reason,withdrawn_by_name')
      .eq('product_id', productId).order('revision', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (revision.error) throw new Error(`readCatalogueProduct: ${revision.error.message}`);
  if (product.error) throw new Error(`readCatalogueProduct: ${product.error.message}`);
  if (shared.error) throw new Error(`readCatalogueProduct: ${shared.error.message}`);
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
    generalCapabilities: ((shared.data as { capability_id: string; how_it_supports: string }[] | null) ?? []).map((link) => ({
      capabilityId: link.capability_id,
      howItSupports: link.how_it_supports,
    })),
    claims: ((claims.data as ClaimRow[] | null) ?? []).map((claim) => ({
      position: claim.position,
      kind: claim.kind,
      statement: claim.statement,
      sourceUrl: claim.source_url,
      sourceDate: claim.source_date,
    })),
  });
  const claimReviews: CatalogueClaimReview[] = ((claims.data as ClaimRow[] | null) ?? []).map((claim) => ({
    claimId: claim.id,
    position: claim.position,
    reviewState: claim.review_state,
    origin: claim.origin,
    draftedByName: claim.drafted_by_name,
    draftedAt: claim.drafted_at,
    reviewedByName: claim.reviewed_by,
    reviewedAt: claim.reviewed_at,
  }));
  return {
    product: {
      id: row.id, code: row.code, product: row.product, vendor: row.vendor, summary: row.summary,
      edit_revision: row.edit_revision, created_at: row.created_at, updated_at: row.updated_at,
    },
    content,
    claimReviews,
    publication: revision.data ? publicationState(revision.data, row.edit_revision) : null,
  };
}

export async function saveCatalogueProduct(
  client: Client,
  productId: UUID | null,
  expectedRevision: number,
  content: CatalogueProductContent,
): Promise<{ productId: UUID; revision: number; reviewed: number; published: number | null; withdrawn: boolean }> {
  const parsed = catalogueProductContentSchema.parse(content);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('save_catalogue_product', {
    p_id: productId, p_expected_revision: expectedRevision, p_content: parsed,
  });
  if (error) throw new Error(`saveCatalogueProduct: ${error.message}`);
  const result = data as { productId: UUID; revision: number; reviewed: number; published: number | null; withdrawn: boolean };
  return result;
}

/**
 * Publishes the product as it is saved: freezes a new revision for users and
 * records who approved it. The server refuses while any claim is waiting for
 * review, and nothing is saved if it refuses.
 */
export async function publishCatalogueProduct(client: Client, productId: UUID): Promise<number> {
  const detail = await readCatalogueProduct(client, productId);
  const result = await saveCatalogueProduct(client, productId, detail.product.edit_revision, { ...detail.content, publication: { action: 'publish' } });
  if (result.published === null) throw new Error('publishCatalogueProduct: the product was not published');
  return result.published;
}

/** Withdraws the latest published revision from users, with a written reason. It stays readable for saved citations. */
export async function withdrawCatalogueProduct(client: Client, productId: UUID, reason: string): Promise<void> {
  const detail = await readCatalogueProduct(client, productId);
  await saveCatalogueProduct(client, productId, detail.product.edit_revision, { ...detail.content, publication: { action: 'withdraw', reason } });
}

export async function validateCatalogueProduct(client: Client, content: CatalogueProductContent): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('catalogue_product_issues', { p_content: content });
  if (error) throw new Error(`validateCatalogueProduct: ${error.message}`);
  return data as string[];
}

/** The most waiting claims the queue loads at once. The screen says so when there are more. */
export const REVIEW_QUEUE_PAGE = 500;

/**
 * Every claim still waiting for review, with its product, oldest product name
 * first. Claims are read first and their products second, in pieces of at most
 * 50 ids (build rule 8).
 */
export async function listClaimsWaitingForReview(client: Client): Promise<{ claims: ClaimWaitingForReview[]; total: number }> {
  const waiting = await client.from('catalogue_product_claims')
    .select('id,product_id,position,kind,statement,source_url,source_date,origin,drafted_by_name,drafted_at', { count: 'exact' })
    .eq('review_state', 'drafted')
    .order('product_id').order('position')
    .limit(REVIEW_QUEUE_PAGE);
  if (waiting.error) throw new Error(`listClaimsWaitingForReview: ${waiting.error.message}`);
  const rows = (waiting.data as Omit<ClaimRow, 'review_state' | 'reviewed_by' | 'reviewed_at'>[] | null) ?? [];
  const productIds = [...new Set(rows.map((row) => row.product_id))];
  const products = await queryInChunks<string, { id: string; product: string; vendor: string }>('listClaimsWaitingForReview', 'id', productIds, (chunk) =>
    client.from('catalogue_products').select('id,product,vendor').in('id', chunk));
  const byId = new Map(products.map((product) => [product.id, product]));
  const claims = rows.map((row) => ({
    claimId: row.id,
    productId: row.product_id,
    productName: byId.get(row.product_id)?.product ?? 'Unknown product',
    vendor: byId.get(row.product_id)?.vendor ?? '',
    position: row.position,
    kind: row.kind,
    statement: row.statement,
    sourceUrl: row.source_url,
    sourceDate: row.source_date,
    origin: row.origin,
    draftedByName: row.drafted_by_name,
    draftedAt: row.drafted_at,
  }));
  claims.sort((a, b) => a.productName.localeCompare(b.productName) || a.position - b.position);
  return { claims, total: waiting.count ?? rows.length };
}

/**
 * Mark some of a product's claims reviewed by the signed-in admin. The server
 * records the name and the date; this only says which claims. It saves the
 * product as it stands, so an edit someone else made in the meantime is
 * reported (the revision check) and nothing is overwritten.
 */
export async function reviewProductClaims(client: Client, productId: UUID, claimIds: readonly string[]): Promise<number> {
  const detail = await readCatalogueProduct(client, productId);
  const positions = new Set(detail.claimReviews.filter((review) => claimIds.includes(review.claimId) && review.reviewState === 'drafted').map((review) => review.position));
  if (positions.size === 0) return 0;
  const content: CatalogueProductContent = {
    ...detail.content,
    claims: detail.content.claims.map((claim) => (positions.has(claim.position) ? { ...claim, review: true } : claim)),
  };
  const result = await saveCatalogueProduct(client, productId, detail.product.edit_revision, content);
  return result.reviewed;
}

/**
 * The shared capabilities a product can link to: the general capabilities
 * (codes 1 to 8) of the newest published any-organisation set, each with its
 * published identity. A capability appears only if its item is aligned.
 */
export async function listGeneralCapabilities(client: Client): Promise<GeneralCapabilityOption[]> {
  const map = await client.from('capability_maps').select('id')
    .eq('sector', 'any_organisation').eq('status', 'published')
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (map.error) throw new Error(`listGeneralCapabilities: ${map.error.message}`);
  const mapRow = map.data;
  if (!mapRow) return [];
  const items = await client.from('capability_map_items').select('id,code,level,item_order')
    .eq('map_id', mapRow.id).order('item_order');
  if (items.error) throw new Error(`listGeneralCapabilities: ${items.error.message}`);
  const general = ((items.data as { id: string; code: string; level: number }[] | null) ?? []).filter((item) => /^[1-8](\.|$)/.test(item.code));
  const links = await queryInChunks<string, { map_item_id: string; capability_id: string; capability_revision: number }>(
    'listGeneralCapabilities', 'map_item_id', general.map((item) => item.id), (chunk) =>
      client.from('reference_map_item_links').select('map_item_id,capability_id,capability_revision').in('map_item_id', chunk));
  const linkByItem = new Map(links.map((link) => [link.map_item_id, link]));
  const identityIds = [...new Set(links.map((link) => link.capability_id))];
  const revisions = await queryInChunks<string, { capability_id: string; revision: number; name: string; definition: string }>(
    'listGeneralCapabilities', 'capability_id', identityIds, (chunk) =>
      client.from('reference_capability_revisions').select('capability_id,revision,name,definition').eq('status', 'published').in('capability_id', chunk));
  const revision = new Map(revisions.map((row) => [`${row.capability_id}:${String(row.revision)}`, row]));
  const options: GeneralCapabilityOption[] = [];
  for (const item of general) {
    const link = linkByItem.get(item.id);
    const meaning = link ? revision.get(`${link.capability_id}:${String(link.capability_revision)}`) : undefined;
    if (!link || !meaning) continue;
    options.push({ capabilityId: link.capability_id, code: item.code, name: meaning.name, definition: meaning.definition, level: item.level });
  }
  return options;
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
  // A catalogue can hold many entries and these two tables have no catalogue column to filter on, so the entry ids go in pieces of at most 50 (build rule 8).
  const [linkRows, claimRows] = await Promise.all([
    queryInChunks<string, { entry_id: string; capability_code: string; capability_name: string; how_it_supports: string }>('listCatalogueEntries', 'entry_id', ids, (chunk) =>
      client.from('catalogue_entry_capabilities').select('entry_id,capability_code,capability_name,how_it_supports').in('entry_id', chunk),
    ),
    queryInChunks<string, { entry_id: string; position: number; kind: string; statement: string; source_url: string; source_date: string; reviewed_by: string; reviewed_at: string }>('listCatalogueEntries', 'entry_id', ids, (chunk) =>
      client.from('catalogue_claims').select('entry_id,position,kind,statement,source_url,source_date,reviewed_by,reviewed_at').in('entry_id', chunk).order('position'),
    ),
  ]);
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

export async function readCatalogueDraft(client: Client, draftId: UUID): Promise<CatalogueDraftRow> {
  const { data, error } = await client.from('catalogue_drafts')
    .select('id,base_catalogue_id,sector,version,content,edit_revision,status,published_catalogue_id,updated_at')
    .eq('id', draftId)
    .single();
  if (error) throw new Error(`readCatalogueDraft: ${error.message}`);
  return {
    ...(data as Omit<CatalogueDraftRow, 'content'> & { content: unknown }),
    content: catalogueDraftContentSchema.parse((data as { content: unknown }).content),
  };
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

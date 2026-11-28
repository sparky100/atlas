/**
 * Platform-admin catalogue reads/writes. The browser never writes the
 * reference tables directly: every mutation is one of the guarded RPCs in
 * `20261122120000_catalogue_admin.sql`, which re-check platform-admin status
 * and optimistic revisions. This module only maps rows and calls those RPCs.
 * One exception, steps 5a and 5b-1: the source-link and claim check results
 * (`catalogue_source_checks`, `catalogue_claim_checks`) are plain records that
 * platform admins write directly under row-level security, with who and when
 * stamped by the server. The same goes for the run record and the monthly
 * switch (step 5b-2, `catalogue_check_runs`, `catalogue_check_schedule`).
 */
import type { UUID } from '../contracts/delta';
import { addDays, mergeProductContent } from '../tools/catalogueResultActions';
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
  type CheckRunRow,
  type CheckRunScope,
  type CheckRunStatus,
  type CheckSchedule,
  type ClaimOrigin,
  type ClaimReviewState,
  type ClaimWaitingForReview,
  type ProductMergeRow,
  type ProductPublicationState,
  type ClaimCheckRow,
  type ClaimForCheck,
  type SourceCheckInput,
  type SourceCheckRow,
  productPublicationLabel,
  sourceCheckSchema,
} from '../contracts/catalogueAdmin';
import { claimCheckResultSchema, type ClaimCheckResult } from '../tools/catalogueClaimCheck';
import { proposalKey, type LinkProposal, type ProductLinkRow, type ProposalProduct, type RejectedLinkRow } from '../tools/catalogueLinkProposals';
import { suggestPlatforms, type PlatformSuggestion } from '../tools/cataloguePlatformSuggestions';
import { findResultSchema, foundComponentContent, foundProductContent, nameMatchKey, type FindComponentsRequest, type FindPlatformsRequest, splitByLibrary, productCode, type FindRequest, type FindResult, type FoundProduct } from '../tools/catalogueFindProducts';
import type { Client } from './client';
import { queryInChunks } from './inFilterLimit';

interface ProductRow {
  id: string;
  code: string;
  product: string;
  vendor: string;
  summary: string;
  part_of_product_id: string | null;
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
  /** The platform this product is part of, with its name. */
  partOf: { id: string; product: string } | null;
  /** The products that are part of this one. */
  components: { id: string; product: string }[];
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
  const merged = await mergedInto(client);
  const [products, links, claims, shared, revisions] = await Promise.all([
    client.from('catalogue_products').select('id,code,product,vendor,summary,part_of_product_id,edit_revision,created_at,updated_at').order('product'),
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
  const componentCount = new Map<string, number>();
  for (const row of (products.data as ProductRow[] | null) ?? []) {
    if (row.part_of_product_id !== null && !merged.has(row.id)) componentCount.set(row.part_of_product_id, (componentCount.get(row.part_of_product_id) ?? 0) + 1);
  }
  const claimCount = new Map<string, number>();
  const waitingCount = new Map<string, number>();
  for (const row of (claims.data as { product_id: string; review_state: ClaimReviewState }[] | null) ?? []) {
    claimCount.set(row.product_id, (claimCount.get(row.product_id) ?? 0) + 1);
    if (row.review_state === 'drafted') waitingCount.set(row.product_id, (waitingCount.get(row.product_id) ?? 0) + 1);
  }

  return ((products.data as ProductRow[] | null) ?? []).filter((row) => !merged.has(row.id)).map((row) => ({
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
    partOfProductId: row.part_of_product_id,
    componentCount: componentCount.get(row.id) ?? 0,
  }));
}

export async function readCatalogueProduct(client: Client, productId: UUID): Promise<CatalogueProductDetail> {
  const [product, links, claims, shared, revision, componentRows] = await Promise.all([
    client.from('catalogue_products').select('id,code,product,vendor,summary,part_of_product_id,edit_revision,created_at,updated_at').eq('id', productId).maybeSingle(),
    client.from('catalogue_product_capabilities').select('product_id,capability_map_id,capability_code,capability_name,how_it_supports').eq('product_id', productId),
    client.from('catalogue_product_claims').select(CLAIM_COLUMNS)
      .eq('product_id', productId).order('position'),
    client.from('catalogue_product_general_links').select('capability_id,how_it_supports')
      .eq('product_id', productId).order('capability_id'),
    client.from('catalogue_product_revisions')
      .select('revision,product_edit_revision,published_by_name,published_at,withdrawn_at,withdrawn_reason,withdrawn_by_name')
      .eq('product_id', productId).order('revision', { ascending: false }).limit(1).maybeSingle(),
    client.from('catalogue_products').select('id,product').eq('part_of_product_id', productId).order('product'),
  ]);
  if (componentRows.error) throw new Error(`readCatalogueProduct: ${componentRows.error.message}`);
  const mergedIds = new Set((await listProductMerges(client)).map((merge) => merge.mergedProductId));
  if (revision.error) throw new Error(`readCatalogueProduct: ${revision.error.message}`);
  if (product.error) throw new Error(`readCatalogueProduct: ${product.error.message}`);
  if (shared.error) throw new Error(`readCatalogueProduct: ${shared.error.message}`);
  if (links.error) throw new Error(`readCatalogueProduct: ${links.error.message}`);
  if (claims.error) throw new Error(`readCatalogueProduct: ${claims.error.message}`);
  const row: ProductRow | null = product.data;
  if (!row) throw new Error('readCatalogueProduct: that product is no longer available');
  let partOf: { id: string; product: string } | null = null;
  if (row.part_of_product_id !== null) {
    const parent = await client.from('catalogue_products').select('id,product').eq('id', row.part_of_product_id).maybeSingle();
    if (parent.error) throw new Error(`readCatalogueProduct: ${parent.error.message}`);
    partOf = parent.data ?? null;
  }

  const content = catalogueProductContentSchema.parse({
    code: row.code,
    product: row.product,
    vendor: row.vendor,
    summary: row.summary,
    partOfProductId: row.part_of_product_id,
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
      part_of_product_id: row.part_of_product_id,
      edit_revision: row.edit_revision, created_at: row.created_at, updated_at: row.updated_at,
    },
    content,
    claimReviews,
    publication: revision.data ? publicationState(revision.data, row.edit_revision) : null,
    partOf,
    // A product merged into another is a record, not a component, so it is left out here as it is in the list.
    components: componentRows.data.filter((component: { id: string }) => !mergedIds.has(component.id)),
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
  const merged = await mergedInto(client);
  const allRows = (waiting.data as Omit<ClaimRow, 'review_state' | 'reviewed_by' | 'reviewed_at'>[] | null) ?? [];
  const rows = allRows.filter((row) => !merged.has(row.product_id));
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
  return { claims, total: Math.max(rows.length, (waiting.count ?? allRows.length) - (allRows.length - rows.length)) };
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
    .select('id,code,name,description,parent_code,level,item_order')
    .eq('map_id', mapId)
    .order('level')
    .order('item_order');
  if (error) throw new Error(`listCapabilitySetItems: ${error.message}`);
  return ((data as { id: string; code: string; name: string; description: string | null; parent_code: string | null; level: number; item_order: number }[] | null) ?? [])
    .map((item) => ({ id: item.id, code: item.code, name: item.name, description: item.description, parentCode: item.parent_code, level: item.level, order: item.item_order }));
}

export async function listCatalogueVersions(client: Client): Promise<CatalogueVersionSummary[]> {
  const { data, error } = await client.from('product_catalogues')
    .select('id,sector,version,capability_map_version,status,title,published_at,withdrawn_at,withdrawn_reason')
    .order('sector')
    .order('version', { ascending: false });
  if (error) throw new Error(`listCatalogueVersions: ${error.message}`);
  return data;
}

/** Vendor and name of every product that is published now (newest revision, not withdrawn), for the check before a sector catalogue is withdrawn. */
export async function listPublishedProductNames(client: Client): Promise<{ vendor: string; product: string }[]> {
  const { data, error } = await client.from('catalogue_product_revisions')
    .select('vendor,product')
    .is('withdrawn_at', null)
    .is('superseded_at', null);
  if (error) throw new Error(`listPublishedProductNames: ${error.message}`);
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

interface MergeDbRow { merged_product_id: string; kept_product_id: string; reason: string | null; merged_by_name: string | null; merged_at: string }

/** Every product merged into another, newest first. The merged products are kept as records and left out of lists. */
export async function listProductMerges(client: Client): Promise<ProductMergeRow[]> {
  const { data, error }: { data: MergeDbRow[] | null; error: { message: string } | null } =
    await client.from('catalogue_product_merges').select('merged_product_id,kept_product_id,reason,merged_by_name,merged_at').order('merged_at', { ascending: false }).limit(5000);
  if (error) throw new Error(`listProductMerges: ${error.message}`);
  return (data ?? []).map((row) => ({ mergedProductId: row.merged_product_id, keptProductId: row.kept_product_id, reason: row.reason, mergedByName: row.merged_by_name, mergedAt: row.merged_at }));
}

/** Merged products with their names, for the list of merges that can be undone. */
export async function listMergedProducts(client: Client): Promise<(ProductMergeRow & { mergedName: string; keptName: string; vendor: string })[]> {
  const merges = await listProductMerges(client);
  const ids = [...new Set(merges.flatMap((row) => [row.mergedProductId, row.keptProductId]))];
  const products = await queryInChunks<string, { id: string; product: string; vendor: string }>('listMergedProducts', 'id', ids, (chunk) =>
    client.from('catalogue_products').select('id,product,vendor').in('id', chunk));
  const byId = new Map(products.map((product) => [product.id, product]));
  return merges.map((row) => ({ ...row, mergedName: byId.get(row.mergedProductId)?.product ?? 'Unknown product', keptName: byId.get(row.keptProductId)?.product ?? 'Unknown product', vendor: byId.get(row.mergedProductId)?.vendor ?? '' }));
}

/** Merged product id to the product it was merged into. */
async function mergedInto(client: Client): Promise<Map<string, string>> {
  return new Map((await listProductMerges(client)).map((row) => [row.mergedProductId, row.keptProductId]));
}

/**
 * Merge one product into another: everything the kept product lacks (capability
 * links, shared links, claims as new drafts) is added to it through the guarded
 * save, then the merge is recorded with who and when. The merged product is
 * kept, not deleted, and "undo" simply lifts the record. A merged product that
 * is published must be withdrawn first.
 */
export async function mergeProducts(client: Client, keptId: UUID, mergedId: UUID, reason: string): Promise<{ addedLinks: number; addedSharedLinks: number; addedClaims: number }> {
  if (keptId === mergedId) throw new Error('Choose two different products.');
  const existing = await listProductMerges(client);
  if (existing.some((row) => row.mergedProductId === keptId || row.keptProductId === mergedId)) {
    throw new Error('Keep the product that was kept before, and do not merge a product other products were merged into.');
  }
  const [kept, merged] = await Promise.all([readCatalogueProduct(client, keptId), readCatalogueProduct(client, mergedId)]);
  if (merged.publication !== null && merged.publication.withdrawnAt === null) {
    throw new Error(`${merged.product.product} is published. Withdraw it first, then merge.`);
  }
  const result = mergeProductContent(kept.content, merged.content);
  if ('error' in result) throw new Error(result.error);
  await saveCatalogueProduct(client, keptId, kept.product.edit_revision, result.content);
  const { error } = await client.from('catalogue_product_merges').insert({ merged_product_id: mergedId, kept_product_id: keptId, reason: reason.trim() === '' ? null : reason.trim().slice(0, 300) });
  if (error) throw new Error(`The links and claims were added to ${kept.product.product}, but the merge could not be recorded: ${error.message}`);
  return { addedLinks: result.addedLinks, addedSharedLinks: result.addedSharedLinks, addedClaims: result.addedClaims };
}

/** Undo a merge: the product comes back into the lists. What was added to the kept product stays there, to edit like anything else. */
export async function undoProductMerge(client: Client, mergedId: UUID): Promise<void> {
  const { error } = await client.from('catalogue_product_merges').delete().eq('merged_product_id', mergedId);
  if (error) throw new Error(`undoProductMerge: ${error.message}`);
}

/** Products that look like components of one platform, minus the pairs a person already turned down. */
export async function listPlatformSuggestions(client: Client): Promise<PlatformSuggestion[]> {
  const [products, rejected] = await Promise.all([
    listCatalogueProducts(client),
    client.from('catalogue_rejected_platform_pairs').select('product_id,platform_key'),
  ]);
  if (rejected.error) throw new Error(`listPlatformSuggestions: ${rejected.error.message}`);
  const turnedDown = new Set(((rejected.data as { product_id: string; platform_key: string }[] | null) ?? []).map((row) => `${row.product_id}|${row.platform_key}`));
  return suggestPlatforms(products.map((row) => ({
    id: row.id, product: row.product, vendor: row.vendor, partOfProductId: row.partOfProductId, componentCount: row.componentCount,
  })), turnedDown);
}

/** Say these products are not components of the platform a suggestion named. Nothing in the library changes. */
export async function rejectPlatformSuggestion(client: Client, platformKey: string, productIds: readonly UUID[]): Promise<void> {
  if (productIds.length === 0) return;
  const { error } = await client.from('catalogue_rejected_platform_pairs')
    .insert(productIds.map((productId) => ({ product_id: productId, platform_key: platformKey })));
  if (error) throw new Error(`rejectPlatformSuggestion: ${error.message}`);
}

/**
 * Make the chosen products components of the suggested platform. When the
 * platform is not in the library yet it is added first as a draft with no links
 * and no claims (it needs a sourced description before it can be published).
 * Each component is saved through the guarded save, so the server records who
 * and when.
 */
/** A draft platform with no links and no claims: its components carry the capabilities, and it needs a sourced description before it can be published. */
async function createDraftPlatform(client: Client, vendor: string, name: string, taken: ReadonlySet<string>): Promise<UUID> {
  const saved = await saveCatalogueProduct(client, null, 0, {
    code: productCode(vendor, name, taken),
    product: name,
    vendor,
    summary: `The platform that groups ${vendor}'s ${name} products. Capabilities are linked on its components. It needs a sourced description before it can be published.`,
    capabilities: [],
    claims: [],
  });
  return saved.productId;
}

/**
 * Add a platform by name and vendor: search the library first (rule I1) and, when
 * it is already there, say so and add nothing. Otherwise add it as a draft with
 * no links and no claims, through the guarded save, so the server records who
 * and when.
 */
export async function addPlatform(client: Client, vendor: string, name: string): Promise<{ platformId: UUID; existing: boolean; product: string }> {
  const cleanVendor = vendor.trim();
  const cleanName = name.trim();
  if (cleanVendor === '' || cleanName === '') throw new Error('Enter the platform name and its vendor.');
  const library = await listCatalogueProducts(client);
  const key = nameMatchKey(cleanVendor, cleanName);
  const found = library.find((row) => nameMatchKey(row.vendor, row.product) === key);
  if (found) return { platformId: found.id, existing: true, product: found.product };
  const platformId = await createDraftPlatform(client, cleanVendor, cleanName, new Set(library.map((row) => row.code)));
  return { platformId, existing: false, product: cleanName };
}

export async function acceptPlatformSuggestion(
  client: Client,
  suggestion: PlatformSuggestion,
  productIds: readonly UUID[],
): Promise<{ platformId: UUID; created: boolean; linked: number }> {
  if (productIds.length === 0) throw new Error('Choose at least one product.');
  let platformId = suggestion.platformId;
  let created = false;
  if (platformId === null) {
    const taken = new Set((await listCatalogueProducts(client)).map((row) => row.code));
    platformId = await createDraftPlatform(client, suggestion.vendor, suggestion.platformName, taken);
    created = true;
  }
  let linked = 0;
  for (const productId of productIds) {
    const detail = await readCatalogueProduct(client, productId);
    try {
      await saveCatalogueProduct(client, productId, detail.product.edit_revision, { ...detail.content, partOfProductId: platformId });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`${String(linked)} of ${String(productIds.length)} products were linked. ${detail.product.product} could not be: ${reason}`);
    }
    linked += 1;
  }
  return { platformId, created, linked };
}

/** Keep a flagged link out of the list for some days, with a short reason. The server stamps who and when. */
export async function keepSourceLink(client: Client, url: string, days: number, reason: string): Promise<void> {
  const { error } = await client.from('catalogue_source_checks')
    .update({ hidden_until: addDays(new Date(), days), hidden_reason: reason.trim().slice(0, 200) }).eq('url', url);
  if (error) throw new Error(`keepSourceLink: ${error.message}`);
}

/** Bring a kept link back into the list. */
export async function unkeepSourceLink(client: Client, url: string): Promise<void> {
  const { error } = await client.from('catalogue_source_checks').update({ hidden_until: null }).eq('url', url);
  if (error) throw new Error(`unkeepSourceLink: ${error.message}`);
}

/** Check one link again and save the answer. */
export async function recheckSourceLink(client: Client, url: string): Promise<SourceCheckInput | undefined> {
  const results = await checkSourceLinks(client, [url]);
  await saveSourceChecks(client, results);
  return results[0];
}

/**
 * Point the claims of some products that cite `oldUrl` at `newUrl`, as an edit
 * through the guarded save (so the server records who and when, and a published
 * product shows "published, with changes"). One save per product; a product
 * that fails is skipped and named. The new address is then checked.
 */
export async function replaceClaimSource(
  client: Client,
  oldUrl: string,
  newUrl: string,
  products: readonly { productId: UUID; productName: string }[],
): Promise<{ changed: string[]; failed: { product: string; message: string }[] }> {
  const changed: string[] = [];
  const failed: { product: string; message: string }[] = [];
  for (const { productId, productName } of products) {
    try {
      const detail = await readCatalogueProduct(client, productId);
      const claims = detail.content.claims.map((claim) => (claim.sourceUrl.trim() === oldUrl ? { ...claim, sourceUrl: newUrl } : claim));
      await saveCatalogueProduct(client, productId, detail.product.edit_revision, { ...detail.content, claims });
      changed.push(productName);
    } catch (cause) {
      failed.push({ product: productName, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  if (changed.length > 0) await recheckSourceLink(client, newUrl).catch(() => undefined);
  return { changed, failed };
}

const SOURCE_PAGE = 1000;

/** Every distinct claim source link in the library, each once however many claims cite it. Read in pages so a large library is not cut off. */
export async function listDistinctSourceUrls(client: Client): Promise<string[]> {
  const merged = await mergedInto(client);
  const urls = new Set<string>();
  for (let from = 0; ; from += SOURCE_PAGE) {
    const { data, error } = await client.from('catalogue_product_claims')
      .select('product_id,source_url').order('id').range(from, from + SOURCE_PAGE - 1);
    if (error) throw new Error(`listDistinctSourceUrls: ${error.message}`);
    const rows = (data as { product_id: string; source_url: string }[] | null) ?? [];
    for (const row of rows) if (row.source_url.trim() !== '' && !merged.has(row.product_id)) urls.add(row.source_url.trim());
    if (rows.length < SOURCE_PAGE) break;
  }
  return [...urls];
}

interface SourceCheckDbRow {
  url: string;
  result: SourceCheckInput['result'];
  http_status: number | null;
  final_url: string | null;
  note: string | null;
  checked_at: string;
  checked_by_name: string | null;
  hidden_until: string | null;
  hidden_by_name: string | null;
  hidden_reason: string | null;
}

/** The latest saved check of every link, newest first. */
export async function listSourceChecks(client: Client): Promise<SourceCheckRow[]> {
  const rows: SourceCheckDbRow[] = [];
  for (let from = 0; ; from += SOURCE_PAGE) {
    const { data, error } = await client.from('catalogue_source_checks')
      .select('url,result,http_status,final_url,note,checked_at,checked_by_name,hidden_until,hidden_by_name,hidden_reason')
      .order('checked_at', { ascending: false }).order('url').range(from, from + SOURCE_PAGE - 1);
    if (error) throw new Error(`listSourceChecks: ${error.message}`);
    const page = (data as SourceCheckDbRow[] | null) ?? [];
    rows.push(...page);
    if (page.length < SOURCE_PAGE) break;
  }
  return rows.map((row) => ({
    url: row.url, result: row.result, httpStatus: row.http_status, finalUrl: row.final_url, note: row.note,
    checkedAt: row.checked_at, checkedByName: row.checked_by_name,
    hiddenUntil: row.hidden_until, hiddenByName: row.hidden_by_name, hiddenReason: row.hidden_reason,
  }));
}

/** Ask the link checker about a few links (at most 25). It writes nothing; the answers are saved by `saveSourceChecks`. */
export async function checkSourceLinks(client: Client, urls: readonly string[]): Promise<SourceCheckInput[]> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped Supabase function response
  const { data, error } = await client.functions.invoke('catalogue-link-check', { body: { urls } });
  if (error) throw new Error('The link checker is not available right now. If it has not been deployed yet, deploy catalogue-link-check, then try again.');
  const result = data as { status?: string; message?: string; results?: unknown } | null;
  if (!result) throw new Error('The link checker gave no answer.');
  if (result.status === 'error') throw new Error(result.message ?? 'The link check failed.');
  const parsed = sourceCheckSchema.array().safeParse(result.results);
  if (!parsed.success) throw new Error('The link checker gave an answer this page does not understand.');
  return parsed.data;
}

/** Save results. The server stamps who and when; a later check of the same link replaces the earlier one. */
export async function saveSourceChecks(client: Client, checks: readonly SourceCheckInput[]): Promise<void> {
  if (checks.length === 0) return;
  const { error } = await client.from('catalogue_source_checks').upsert(
    checks.map((check) => ({ url: check.url, result: check.result, http_status: check.httpStatus, final_url: check.finalUrl, note: check.note })),
    { onConflict: 'url' },
  );
  if (error) throw new Error(`saveSourceChecks: ${error.message}`);
}

/** A link whose last check was not "works", with the claims that cite it. */
export interface FlaggedSourceLink {
  check: SourceCheckRow;
  claims: { productId: string; productName: string; vendor: string; position: number; statement: string }[];
}

/**
 * Links whose latest check found a problem, newest first, each with the claims
 * citing it. Claims are read in pages and matched here (a long list of links
 * must not go into one filter, build rule 8); products are then read in pieces
 * of at most 50.
 */
export async function listFlaggedSourceLinks(client: Client, checks: readonly SourceCheckRow[]): Promise<FlaggedSourceLink[]> {
  const flagged = checks.filter((check) => check.result !== 'works');
  if (flagged.length === 0) return [];
  const wanted = new Set(flagged.map((check) => check.url));
  const merged = await mergedInto(client);
  const matched: { product_id: string; position: number; statement: string; source_url: string }[] = [];
  for (let from = 0; ; from += SOURCE_PAGE) {
    const { data, error } = await client.from('catalogue_product_claims')
      .select('product_id,position,statement,source_url').order('id').range(from, from + SOURCE_PAGE - 1);
    if (error) throw new Error(`listFlaggedSourceLinks: ${error.message}`);
    const rows = (data as { product_id: string; position: number; statement: string; source_url: string }[] | null) ?? [];
    matched.push(...rows.filter((row) => wanted.has(row.source_url.trim()) && !merged.has(row.product_id)));
    if (rows.length < SOURCE_PAGE) break;
  }
  const productIds = [...new Set(matched.map((row) => row.product_id))];
  const products = await queryInChunks<string, { id: string; product: string; vendor: string }>('listFlaggedSourceLinks', 'id', productIds, (chunk) =>
    client.from('catalogue_products').select('id,product,vendor').in('id', chunk));
  const byId = new Map(products.map((product) => [product.id, product]));
  // A link no claim cites any more (its claims were pointed elsewhere, or their product was merged away) has nothing left to look at.
  return flagged.map((check) => ({
    check,
    claims: matched.filter((row) => row.source_url.trim() === check.url)
      .map((row) => ({ productId: row.product_id, productName: byId.get(row.product_id)?.product ?? 'Unknown product', vendor: byId.get(row.product_id)?.vendor ?? '', position: row.position, statement: row.statement }))
      .sort((a, b) => a.productName.localeCompare(b.productName) || a.position - b.position),
  })).filter((item) => item.claims.length > 0);
}

/** The function's own sentence when it sent one (a daily limit, a missing key), instead of a generic message. */
async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    const body = (await context.json().catch(() => null)) as { message?: unknown } | null;
    if (typeof body?.message === 'string' && body.message !== '') return body.message;
  }
  return fallback;
}

/** Every claim with its product, for the claim check. Claims are read in pages and products in pieces of at most 50 (build rule 8). */
export async function listClaimsForCheck(client: Client): Promise<ClaimForCheck[]> {
  const merged = await mergedInto(client);
  const rows: { product_id: string; statement: string; source_url: string }[] = [];
  for (let from = 0; ; from += SOURCE_PAGE) {
    const { data, error } = await client.from('catalogue_product_claims')
      .select('product_id,statement,source_url').order('id').range(from, from + SOURCE_PAGE - 1);
    if (error) throw new Error(`listClaimsForCheck: ${error.message}`);
    const page = (data as { product_id: string; statement: string; source_url: string }[] | null) ?? [];
    rows.push(...page.filter((row) => !merged.has(row.product_id)));
    if (page.length < SOURCE_PAGE) break;
  }
  const productIds = [...new Set(rows.map((row) => row.product_id))];
  const products = await queryInChunks<string, { id: string; product: string; vendor: string }>('listClaimsForCheck', 'id', productIds, (chunk) =>
    client.from('catalogue_products').select('id,product,vendor').in('id', chunk));
  const byId = new Map(products.map((product) => [product.id, product]));
  return rows.flatMap((row) => {
    const product = byId.get(row.product_id);
    return product === undefined ? [] : [{ productId: row.product_id, product: product.product, vendor: product.vendor, sourceUrl: row.source_url.trim(), statement: row.statement }];
  });
}

interface ClaimCheckDbRow {
  product_id: string;
  source_url: string;
  statement: string;
  verdict: ClaimCheckRow['verdict'];
  quote: string | null;
  note: string | null;
  model: string | null;
  checked_at: string;
  checked_by_name: string | null;
  dismissed_at: string | null;
  dismissed_by_name: string | null;
}

/** The latest saved claim check of every claim, newest first. */
const LEGACY_AI_FAILURE_NOTE = 'The AI could not be reached.';

export async function listClaimChecks(client: Client): Promise<ClaimCheckRow[]> {
  const rows: ClaimCheckDbRow[] = [];
  for (let from = 0; ; from += SOURCE_PAGE) {
    const { data, error } = await client.from('catalogue_claim_checks')
      .select('product_id,source_url,statement,verdict,quote,note,model,checked_at,checked_by_name,dismissed_at,dismissed_by_name')
      .order('checked_at', { ascending: false }).order('product_id').order('statement').range(from, from + SOURCE_PAGE - 1);
    if (error) throw new Error(`listClaimChecks: ${error.message}`);
    const page = (data as ClaimCheckDbRow[] | null) ?? [];
    rows.push(...page);
    if (page.length < SOURCE_PAGE) break;
  }
  // Early runs saved a failed call to the AI as a check. That was not a check, so it is left out and the claim counts as unchecked.
  return rows.filter((row) => row.note !== LEGACY_AI_FAILURE_NOTE).map((row) => ({
    productId: row.product_id, sourceUrl: row.source_url, statement: row.statement, verdict: row.verdict, quote: row.quote, note: row.note, model: row.model,
    checkedAt: row.checked_at, checkedByName: row.checked_by_name, dismissedAt: row.dismissed_at, dismissedByName: row.dismissed_by_name,
  }));
}

/** Ask the claim checker about a few claims (at most 5). It writes nothing; the answers are saved by `saveClaimChecks`. */
export async function checkClaims(client: Client, claims: readonly ClaimForCheck[]): Promise<ClaimCheckResult[]> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped Supabase function response
  const { data, error } = await client.functions.invoke('catalogue-claim-check', { body: { claims } });
  if (error) throw new Error(await functionErrorMessage(error, 'The claim checker is not available right now. If it has not been deployed yet, deploy catalogue-claim-check, then try again.'));
  const result = data as { status?: string; message?: string; results?: unknown } | null;
  if (!result) throw new Error('The claim checker gave no answer.');
  if (result.status === 'error') throw new Error(result.message ?? 'The claim check failed.');
  const parsed = claimCheckResultSchema.array().safeParse(result.results);
  if (!parsed.success) throw new Error('The claim checker gave an answer this page does not understand.');
  return parsed.data;
}

/** Save results. The server stamps who and when; a later check of the same claim replaces the earlier one and clears any "I looked". */
export async function saveClaimChecks(client: Client, results: readonly ClaimCheckResult[]): Promise<void> {
  if (results.length === 0) return;
  const { error } = await client.from('catalogue_claim_checks').upsert(
    results.map((result) => ({
      product_id: result.productId, source_url: result.sourceUrl, statement: result.statement, verdict: result.verdict, quote: result.quote,
      note: result.note, model: result.model, input_tokens: result.inputTokens, output_tokens: result.outputTokens,
    })),
    { onConflict: 'product_id,source_url,statement' },
  );
  if (error) throw new Error(`saveClaimChecks: ${error.message}`);
}

/** "I looked: it still stands". The server records who and when. */
export async function dismissClaimCheck(client: Client, check: Pick<ClaimCheckRow, 'productId' | 'sourceUrl' | 'statement'>): Promise<void> {
  const { data, error } = await client.from('catalogue_claim_checks')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('product_id', check.productId).eq('source_url', check.sourceUrl).eq('statement', check.statement)
    .is('dismissed_at', null)
    .select('product_id');
  if (error) throw new Error(`dismissClaimCheck: ${error.message}`);
  if (((data as unknown[] | null) ?? []).length === 0) throw new Error('That check was replaced or already cleared. Reload the page.');
}

/** The monthly check's switch: on or off, and who last changed it. */
export async function getCheckSchedule(client: Client): Promise<CheckSchedule> {
  const { data: row, error }: { data: { enabled: boolean; switched_by_name: string | null; switched_at: string | null } | null; error: { message: string } | null } =
    await client.from('catalogue_check_schedule').select('enabled,switched_by_name,switched_at').maybeSingle();
  if (error) throw new Error(`getCheckSchedule: ${error.message}`);
  return { enabled: row?.enabled ?? false, switchedByName: row?.switched_by_name ?? null, switchedAt: row?.switched_at ?? null };
}

/** Switch the monthly check on or off. The server records who and when. */
export async function setCheckSchedule(client: Client, enabled: boolean): Promise<void> {
  const { data, error } = await client.from('catalogue_check_schedule').update({ enabled }).eq('id', true).select('id');
  if (error) throw new Error(`setCheckSchedule: ${error.message}`);
  if (((data as unknown[] | null) ?? []).length === 0) throw new Error('setCheckSchedule: the switch could not be changed. Only platform admins can change it.');
}

interface CheckRunDbRow {
  id: string;
  kind: 'manual' | 'monthly';
  scope: CheckRunScope;
  status: CheckRunStatus;
  started_at: string;
  finished_at: string | null;
  started_by_name: string | null;
  links_checked: number;
  claims_checked: number;
  flagged: number;
  searches: number;
  products_found: number;
  input_tokens: number;
  output_tokens: number;
  note: string | null;
}

/** The latest check runs, manual and monthly, newest first. */
export async function listCheckRuns(client: Client, limit = 5): Promise<CheckRunRow[]> {
  const { data, error } = await client.from('catalogue_check_runs')
    .select('id,kind,scope,status,started_at,finished_at,started_by_name,links_checked,claims_checked,flagged,searches,products_found,input_tokens,output_tokens,note')
    .order('started_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`listCheckRuns: ${error.message}`);
  return ((data as CheckRunDbRow[] | null) ?? []).map((row) => ({
    id: row.id, kind: row.kind, scope: row.scope, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at, startedByName: row.started_by_name,
    linksChecked: row.links_checked, claimsChecked: row.claims_checked, flagged: row.flagged, searches: row.searches, productsFound: row.products_found, tokens: row.input_tokens + row.output_tokens, note: row.note,
  }));
}

/** Record that a person started a check. The server stamps who and when. */
export async function startCheckRun(client: Client, scope: CheckRunScope): Promise<string> {
  const { data, error }: { data: { id: string } | null; error: { message: string } | null } =
    await client.from('catalogue_check_runs').insert({ kind: 'manual', scope }).select('id').single();
  if (error || data === null) throw new Error(`startCheckRun: ${error?.message ?? 'no row came back'}`);
  return data.id;
}

export interface CheckRunOutcome {
  status: CheckRunStatus;
  linksChecked: number;
  claimsChecked: number;
  flagged: number;
  searches?: number;
  productsFound?: number;
  tokens: { input: number; output: number };
  note: string | null;
}

/** Record how a check ended. The server stamps the end time. */
export async function finishCheckRun(client: Client, id: string, outcome: CheckRunOutcome): Promise<void> {
  const { error } = await client.from('catalogue_check_runs').update({
    status: outcome.status, links_checked: outcome.linksChecked, claims_checked: outcome.claimsChecked, flagged: outcome.flagged,
    searches: outcome.searches ?? 0, products_found: outcome.productsFound ?? 0,
    input_tokens: outcome.tokens.input, output_tokens: outcome.tokens.output, note: outcome.note === null ? null : outcome.note.slice(0, 300),
  }).eq('id', id);
  if (error) throw new Error(`finishCheckRun: ${error.message}`);
}

/** Ask the product finder about one capability. It searches the web and writes nothing; new products are saved by `saveFoundProducts`. */
export async function findProductsForCapability(client: Client, request: FindRequest): Promise<FindResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped Supabase function response
  const { data, error } = await client.functions.invoke('catalogue-find-products', { body: request });
  if (error) throw new Error(await functionErrorMessage(error, 'Finding products is not available right now. If it has not been deployed yet, deploy catalogue-find-products, then try again.'));
  const result = data as { status?: string; message?: string } | null;
  if (!result) throw new Error('The product finder gave no answer.');
  if (result.status === 'error') throw new Error(result.message ?? 'Finding products failed.');
  const parsed = findResultSchema.safeParse(result);
  if (!parsed.success) throw new Error('The product finder gave an answer this page does not understand.');
  return parsed.data;
}

/** Ask the product finder for the modules of one platform. It searches the web and writes nothing; new modules are saved by `saveFoundComponents`. */
export async function findComponentsOfPlatform(client: Client, request: FindComponentsRequest): Promise<FindResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped Supabase function response
  const { data, error } = await client.functions.invoke('catalogue-find-products', { body: request });
  if (error) throw new Error(await functionErrorMessage(error, 'Finding components is not available right now. If it has not been deployed yet, deploy catalogue-find-products, then try again.'));
  const result = data as { status?: string; message?: string } | null;
  if (!result) throw new Error('The product finder gave no answer.');
  if (result.status === 'error') throw new Error(result.message ?? 'Finding components failed.');
  const parsed = findResultSchema.safeParse(result);
  if (!parsed.success) throw new Error('The product finder gave an answer this page does not understand.');
  return parsed.data;
}

/** Ask the product finder for the main platforms of one sector. It searches the web and writes nothing; the admin picks which to add. */
export async function findPlatformsForSector(client: Client, request: FindPlatformsRequest): Promise<FindResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped Supabase function response
  const { data, error } = await client.functions.invoke('catalogue-find-products', { body: request });
  if (error) throw new Error(await functionErrorMessage(error, 'Finding platforms is not available right now. If it has not been deployed yet, deploy catalogue-find-products, then try again.'));
  const result = data as { status?: string; message?: string } | null;
  if (!result) throw new Error('The product finder gave no answer.');
  if (result.status === 'error') throw new Error(result.message ?? 'Finding platforms failed.');
  const parsed = findResultSchema.safeParse(result);
  if (!parsed.success) throw new Error('The product finder gave an answer this page does not understand.');
  return parsed.data;
}

export interface ComponentSearchOutcome {
  searched: number;
  found: number;
  existing: { productId: string; product: string }[];
  saved: { productId: string; product: string }[];
  failed: { product: string; message: string }[];
  dropped: number;
  note: string | null;
}

/**
 * One platform's component search, end to end: search (skipping the modules it
 * already has), keep what is not yet in the library, save each as a draft
 * component, and record the run so the daily limit counts it. A failure is
 * recorded and rethrown; nothing is half-saved silently.
 */
export async function findAndSaveComponents(
  client: Client,
  platform: { id: string; product: string; vendor: string },
  knownComponents: readonly string[],
  today: string,
): Promise<ComponentSearchOutcome> {
  const runId = await startCheckRun(client, 'find').catch(() => null);
  let status: CheckRunStatus = 'finished';
  let note: string | null = null;
  let result: FindResult | null = null;
  let savedCount = 0;
  try {
    result = await findComponentsOfPlatform(client, { platformName: platform.product, vendor: platform.vendor, alreadyKnown: knownComponents.slice(0, 60) });
    const library = await listLibraryProductKeys(client);
    const split = splitByLibrary(result.found, library.map((row) => ({ id: row.id, vendor: row.vendor, product: row.product })));
    // The platform's own name is not one of its components.
    const platformKey = nameMatchKey(platform.vendor, platform.product);
    const added = split.added.filter((item) => nameMatchKey(item.vendor, item.product) !== platformKey);
    const saving = await saveFoundComponents(client, platform.id, added, library, today);
    savedCount = saving.saved.length;
    if (saving.failed.length > 0) note = `${String(saving.failed.length)} could not be saved.`;
    return {
      searched: result.searches, found: result.found.length,
      existing: split.existing.filter((row) => row.productId !== platform.id).map((row) => ({ productId: row.productId, product: row.product })),
      saved: saving.saved, failed: saving.failed, dropped: result.dropped.length, note: result.note ?? null,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    status = message.includes('daily AI limit') ? 'limit_reached' : 'failed';
    note = message;
    throw cause;
  } finally {
    if (runId !== null) {
      await finishCheckRun(client, runId, {
        status, linksChecked: 0, claimsChecked: 0, flagged: 0, searches: result?.searches ?? 0, productsFound: savedCount,
        tokens: { input: result?.inputTokens ?? 0, output: result?.outputTokens ?? 0 }, note,
      }).catch(() => undefined);
    }
  }
}

/**
 * Save each found module as a draft component of the platform, with no
 * capability links (that gap stays visible), through the one guarded save
 * function. The server records who saved it and when; the claims are marked as
 * found by the Researcher. A module that fails is skipped and named.
 */
export async function saveFoundComponents(
  client: Client,
  platformId: UUID,
  products: readonly FoundProduct[],
  library: readonly { code: string }[],
  today: string,
): Promise<{ saved: { productId: UUID; product: string; vendor: string }[]; failed: { product: string; message: string }[] }> {
  const taken = new Set(library.map((row) => row.code));
  const saved: { productId: UUID; product: string; vendor: string }[] = [];
  const failed: { product: string; message: string }[] = [];
  for (const item of products) {
    const content = foundComponentContent(item, platformId, taken, today);
    taken.add(content.code);
    try {
      const result = await saveCatalogueProduct(client, null, 0, content);
      saved.push({ productId: result.productId, product: item.product, vendor: item.vendor });
    } catch (cause) {
      failed.push({ product: item.product, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { saved, failed };
}

/** The product codes and the vendor and name of every product in the library, for the check before anything is created (rule I1). */
export async function listLibraryProductKeys(client: Client): Promise<{ id: string; code: string; vendor: string; product: string }[]> {
  const { data, error }: { data: { id: string; code: string; vendor: string; product: string }[] | null; error: { message: string } | null } =
    await client.from('catalogue_products').select('id,code,vendor,product').limit(5000);
  if (error) throw new Error(`listLibraryProductKeys: ${error.message}`);
  // A merged product still counts as in the library, under the product it was merged into, so finding it again offers that one.
  const merged = await mergedInto(client);
  return (data ?? []).map((row) => ({ ...row, id: merged.get(row.id) ?? row.id }));
}

/**
 * Save each found product as a draft, linked to the capability it was found
 * for, through the one guarded save function. The server records who saved it
 * and when; the claims are marked as found by the Researcher. Returns the ids
 * of the products saved. A product that fails is skipped and named.
 */
export async function saveFoundProducts(
  client: Client,
  products: readonly FoundProduct[],
  link: { capabilityMapId: UUID; capabilityCode: string; capabilityName: string },
  library: readonly { id: string; code: string; vendor: string; product: string }[],
  today: string,
): Promise<{ saved: { productId: UUID; product: string; vendor: string; platform: string | null }[]; failed: { product: string; message: string }[]; platformsCreated: string[] }> {
  const taken = new Set(library.map((row) => row.code));
  const saved: { productId: UUID; product: string; vendor: string; platform: string | null }[] = [];
  const failed: { product: string; message: string }[] = [];
  const platformsCreated: string[] = [];
  const platformIds = new Map<string, UUID>();
  const foundKeys = new Set(products.map((item) => nameMatchKey(item.vendor, item.product)));
  for (const item of products) {
    // A platform the page named: reuse the library product of that name, or make a draft. Never when the platform is itself one of these new products.
    let platformId: UUID | undefined;
    const platformName = (item.platform ?? '').trim();
    if (platformName !== '') {
      const key = nameMatchKey(item.vendor, platformName);
      platformId = platformIds.get(key);
      if (platformId === undefined && !foundKeys.has(key)) {
        const existing = library.find((row) => nameMatchKey(row.vendor, row.product) === key);
        try {
          if (existing !== undefined) platformId = existing.id;
          else {
            platformId = await createDraftPlatform(client, item.vendor, platformName, taken);
            platformsCreated.push(platformName);
          }
          platformIds.set(key, platformId);
          taken.add(productCode(item.vendor, platformName, taken));
        } catch {
          platformId = undefined;
        }
      }
    }
    const content = foundProductContent(item, link, taken, today, platformId);
    taken.add(content.code);
    try {
      let result;
      try {
        result = await saveCatalogueProduct(client, null, 0, content);
      } catch (cause) {
        // The library's own product is itself a component, so it cannot be a platform. Save the product on its own.
        if (platformId === undefined) throw cause;
        platformId = undefined;
        result = await saveCatalogueProduct(client, null, 0, foundProductContent(item, link, taken, today));
      }
      saved.push({ productId: result.productId, product: item.product, vendor: item.vendor, platform: platformId === undefined ? null : platformName });
    } catch (cause) {
      failed.push({ product: item.product, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { saved, failed, platformsCreated };
}

/** Everything the link proposals are worked out from: the library's products, every capability link they have, and the pairs a person rejected. Read in pages of 1,000 rows. */
export async function listLinkProposalInputs(client: Client): Promise<{ products: ProposalProduct[]; links: ProductLinkRow[]; rejected: RejectedLinkRow[] }> {
  const products: ProposalProduct[] = [];
  const links: ProductLinkRow[] = [];
  const merged = await mergedInto(client);
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error }: { data: { id: string; product: string; vendor: string }[] | null; error: { message: string } | null } =
      await client.from('catalogue_products').select('id,product,vendor').order('id').range(from, from + page - 1);
    if (error) throw new Error(`listLinkProposalInputs: ${error.message}`);
    products.push(...(data ?? []).filter((row) => !merged.has(row.id)));
    if ((data ?? []).length < page) break;
  }
  for (let from = 0; ; from += page) {
    const { data, error }: { data: { product_id: string; capability_map_id: string; capability_code: string; capability_name: string; how_it_supports: string }[] | null; error: { message: string } | null } =
      await client.from('catalogue_product_capabilities').select('product_id,capability_map_id,capability_code,capability_name,how_it_supports')
        .order('product_id').order('capability_map_id').order('capability_code').range(from, from + page - 1);
    if (error) throw new Error(`listLinkProposalInputs: ${error.message}`);
    for (const row of (data ?? []).filter((link) => !merged.has(link.product_id))) links.push({ productId: row.product_id, mapId: row.capability_map_id, code: row.capability_code, name: row.capability_name, howItSupports: row.how_it_supports });
    if ((data ?? []).length < page) break;
  }
  const rejected: RejectedLinkRow[] = [];
  for (let from = 0; ; from += page) {
    const { data, error }: { data: { product_id: string; capability_map_id: string; capability_code: string; capability_name: string }[] | null; error: { message: string } | null } =
      await client.from('catalogue_rejected_links').select('product_id,capability_map_id,capability_code,capability_name').order('id').range(from, from + page - 1);
    if (error) throw new Error(`listLinkProposalInputs: ${error.message}`);
    for (const row of data ?? []) rejected.push({ productId: row.product_id, mapId: row.capability_map_id, code: row.capability_code, name: row.capability_name });
    if ((data ?? []).length < page) break;
  }
  return { products, links, rejected };
}

/** Record that proposed links were turned down, with a reason. The server stamps who and when. Nothing in the library changes. */
export async function rejectLinkProposals(client: Client, mapId: UUID, proposals: readonly LinkProposal[], reason: string): Promise<void> {
  const trimmed = reason.trim().slice(0, 300);
  if (trimmed === '') throw new Error('Say briefly why these links are rejected.');
  const rows = proposals.map((proposal) => ({ product_id: proposal.productId, capability_map_id: mapId, capability_code: proposal.code, capability_name: proposal.name, reason: trimmed }));
  const { error } = await client.from('catalogue_rejected_links').upsert(rows, { onConflict: 'product_id,capability_map_id,capability_code', ignoreDuplicates: true });
  if (error) throw new Error(`rejectLinkProposals: ${error.message}`);
}

/**
 * Accept proposed links: each product gets the new links as an edit through the
 * one guarded save function, so the server records who and when, and a published
 * product shows "published, with changes" until a person republishes it. One save
 * per product. A product that fails is skipped and named.
 */
export async function acceptLinkProposals(
  client: Client,
  mapId: UUID,
  proposals: readonly LinkProposal[],
): Promise<{ accepted: string[]; failed: { product: string; message: string }[] }> {
  const byProduct = new Map<string, LinkProposal[]>();
  for (const proposal of proposals) byProduct.set(proposal.productId, [...(byProduct.get(proposal.productId) ?? []), proposal]);
  const accepted: string[] = [];
  const failed: { product: string; message: string }[] = [];
  for (const [productId, list] of byProduct) {
    const first = list[0];
    if (first === undefined) continue;
    try {
      const detail = await readCatalogueProduct(client, productId);
      const have = new Set(detail.content.capabilities.map((link) => `${link.capabilityMapId}\u0000${link.capabilityCode}`));
      const added = list.filter((proposal) => !have.has(`${mapId}\u0000${proposal.code}`));
      await saveCatalogueProduct(client, productId, detail.product.edit_revision, {
        ...detail.content,
        capabilities: [...detail.content.capabilities, ...added.map((proposal) => ({ capabilityMapId: mapId, capabilityCode: proposal.code, capabilityName: proposal.name, howItSupports: proposal.howItSupports }))],
      });
      accepted.push(...list.map((proposal) => proposalKey(productId, proposal.code)));
    } catch (cause) {
      failed.push({ product: first.product, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { accepted, failed };
}

/** Tokens product discovery has used since midnight UTC, from the run record. */
export async function findTokensUsedToday(client: Client): Promise<number> {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const { data, error }: { data: { input_tokens: number; output_tokens: number }[] | null; error: { message: string } | null } =
    await client.from('catalogue_check_runs').select('input_tokens,output_tokens').in('scope', ['find', 'find_set']).gte('started_at', midnight.toISOString()).limit(5000);
  if (error) throw new Error(`findTokensUsedToday: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0);
}

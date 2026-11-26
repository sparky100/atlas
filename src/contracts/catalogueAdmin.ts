/**
 * Platform-admin product library and sector-catalogue drafts.
 *
 * One product row per real product, with capability links to any number of
 * capability-set versions. A sector catalogue is a publication snapshot: it
 * selects products and pins one published capability set. This is deliberately
 * separate from `productCatalogue.ts`, which is the end-user reader contract.
 */
import { z } from 'zod';
import { SECTORS } from './capabilityMapContent';
import { CATALOGUE_CLAIM_KINDS, catalogueClaimTextSchema, catalogueSourceUrlSchema, containsCataloguePrice } from './productCatalogue';

export const CATALOGUE_PRODUCT_LIMITS = {
  code: 61,
  product: 120,
  vendor: 120,
  summary: 500,
  capabilities: 200,
  generalCapabilities: 60,
  claims: 200,
  title: 120,
  sourceDescription: 1000,
} as const;

const text = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0 && !containsCataloguePrice(value), 'Required text without prices');

export const catalogueProductCapabilitySchema = z.object({
  capabilityMapId: z.uuid(),
  capabilityCode: text(40),
  capabilityName: text(200),
  howItSupports: text(300),
}).strict();
export type CatalogueProductCapability = z.infer<typeof catalogueProductCapabilitySchema>;

/**
 * A link to a shared capability (ADR-036): one of the general capabilities
 * that every sector set carries with the same meaning. One link makes the
 * product apply in every sector whose set aligns to that capability.
 */
export const catalogueProductGeneralCapabilitySchema = z.object({
  capabilityId: z.uuid(),
  howItSupports: text(300),
}).strict();
export type CatalogueProductGeneralCapability = z.infer<typeof catalogueProductGeneralCapabilitySchema>;

/** A shared capability the picker offers, with the code it has in current sector sets. */
export interface GeneralCapabilityOption {
  capabilityId: string;
  code: string;
  name: string;
  definition: string;
  level: number;
}

/**
 * What the editor sends for one claim. There is no reviewer here on purpose:
 * the server records who drafted a claim and who reviewed it. `review: true`
 * asks the server to mark the claim reviewed by the person saving; it is
 * ignored for a claim that is already reviewed and unchanged.
 */
export const catalogueProductClaimSchema = z.object({
  position: z.number().int().positive(),
  kind: z.enum(CATALOGUE_CLAIM_KINDS),
  statement: catalogueClaimTextSchema,
  sourceUrl: catalogueSourceUrlSchema,
  sourceDate: z.iso.date(),
  review: z.boolean().optional(),
}).strict();
export type CatalogueProductClaim = z.infer<typeof catalogueProductClaimSchema>;

/** Where a claim stands. Drafted and reviewed are different things (rule P4). */
export type ClaimReviewState = 'drafted' | 'reviewed';
/** Who wrote a claim: a person in the editor, the Researcher (a later step), or a file. */
export type ClaimOrigin = 'person' | 'researcher' | 'imported';

/** A saved claim's review record, shown to platform admins only. */
export interface CatalogueClaimReview {
  claimId: string;
  position: number;
  reviewState: ClaimReviewState;
  origin: ClaimOrigin;
  draftedByName: string | null;
  draftedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
}

/**
 * Publishing or withdrawing a product is an action sent with a save, so it
 * goes through the one guarded save function. The server records who and when;
 * the browser cannot name an approver.
 */
export const catalogueProductPublicationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish') }).strict(),
  z.object({ action: z.literal('withdraw'), reason: text(500) }).strict(),
]);
export type CatalogueProductPublication = z.infer<typeof catalogueProductPublicationSchema>;

/** The latest published revision of a product, for platform admins. */
export interface ProductPublicationState {
  revision: number;
  approvedByName: string | null;
  approvedAt: string;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  withdrawnByName: string | null;
  /** The product has been edited or reviewed since this revision was published. */
  unpublishedChanges: boolean;
}

/** Where a product stands for users, in plain words. */
export type ProductPublicationLabel = 'not_published' | 'published' | 'published_with_changes' | 'withdrawn';

export function productPublicationLabel(state: ProductPublicationState | null): ProductPublicationLabel {
  if (state === null) return 'not_published';
  if (state.withdrawnAt !== null) return 'withdrawn';
  return state.unpublishedChanges ? 'published_with_changes' : 'published';
}

export const catalogueProductContentSchema = z.object({
  code: text(CATALOGUE_PRODUCT_LIMITS.code).regex(/^[a-z0-9][a-z0-9-]{1,60}$/, 'Use lowercase letters, numbers and hyphens'),
  product: text(CATALOGUE_PRODUCT_LIMITS.product),
  vendor: text(CATALOGUE_PRODUCT_LIMITS.vendor),
  summary: text(CATALOGUE_PRODUCT_LIMITS.summary),
  capabilities: z.array(catalogueProductCapabilitySchema).max(CATALOGUE_PRODUCT_LIMITS.capabilities),
  generalCapabilities: z.array(catalogueProductGeneralCapabilitySchema).max(CATALOGUE_PRODUCT_LIMITS.generalCapabilities).optional(),
  claims: z.array(catalogueProductClaimSchema).max(CATALOGUE_PRODUCT_LIMITS.claims),
  publication: catalogueProductPublicationSchema.optional(),
}).strict().superRefine((value, ctx) => {
  const links = new Set(value.capabilities.map((link) => `${link.capabilityMapId}\u0000${link.capabilityCode}`));
  if (links.size !== value.capabilities.length) ctx.addIssue({ code: 'custom', message: 'A capability can appear only once for a product' });
  const shared = value.generalCapabilities ?? [];
  if (new Set(shared.map((link) => link.capabilityId)).size !== shared.length) ctx.addIssue({ code: 'custom', message: 'A shared capability can appear only once for a product' });
  const positions = new Set(value.claims.map((claim) => claim.position));
  if (positions.size !== value.claims.length) ctx.addIssue({ code: 'custom', message: 'Claim positions must be unique' });
});
export type CatalogueProductContent = z.infer<typeof catalogueProductContentSchema>;

export const catalogueDraftContentSchema = z.object({
  sector: z.enum(SECTORS),
  version: z.number().int().positive(),
  capabilityMapVersion: z.number().int().positive(),
  title: text(CATALOGUE_PRODUCT_LIMITS.title),
  sourceDescription: text(CATALOGUE_PRODUCT_LIMITS.sourceDescription),
  productIds: z.array(z.uuid()),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.productIds).size !== value.productIds.length) ctx.addIssue({ code: 'custom', message: 'A product can appear only once in a catalogue version' });
});
export type CatalogueDraftContent = z.infer<typeof catalogueDraftContentSchema>;

export interface CatalogueProductRow {
  id: string;
  code: string;
  product: string;
  vendor: string;
  summary: string;
  edit_revision: number;
  created_at: string;
  updated_at: string;
}

export interface CatalogueProductSummary {
  id: string;
  code: string;
  product: string;
  vendor: string;
  summary: string;
  revision: number;
  updatedAt: string;
  capabilityCount: number;
  /** Links to shared capabilities (every sector). Counted apart from sector links. */
  sharedCapabilityCount: number;
  capabilitySetCount: number;
  claimCount: number;
  claimsWaitingForReview: number;
  publication: ProductPublicationLabel;
  capabilityCountsByMap: Record<string, number>;
}

export interface CatalogueProductClaimRow {
  id: string;
  product_id: string;
  position: number;
  kind: string;
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

/** One claim in the "Waiting for review" queue, with its product. */
export interface ClaimWaitingForReview {
  claimId: string;
  productId: string;
  productName: string;
  vendor: string;
  position: number;
  kind: string;
  statement: string;
  sourceUrl: string;
  sourceDate: string;
  origin: ClaimOrigin;
  draftedByName: string | null;
  draftedAt: string;
}

export interface CatalogueDraftRow {
  id: string;
  base_catalogue_id: string | null;
  sector: string;
  version: number;
  content: CatalogueDraftContent;
  edit_revision: number;
  status: 'draft' | 'published';
  published_catalogue_id: string | null;
  updated_at: string;
}

export interface CatalogueVersionSummary {
  id: string;
  sector: string;
  version: number;
  capability_map_version: number;
  status: 'draft' | 'published';
  title: string;
  published_at: string | null;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
}

export interface CapabilitySetOption {
  id: string;
  sector: string;
  version: number;
  status: 'draft' | 'published' | 'deprecated';
  title: string | null;
}

export interface CapabilitySetItem {
  id: string;
  code: string;
  name: string;
  parentCode: string | null;
  level: number;
  order: number;
}

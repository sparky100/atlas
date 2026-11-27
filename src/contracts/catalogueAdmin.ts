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
  /** Only "researcher" is honoured, and only for a claim that is new in the save: the claim is then marked as found by the Researcher. */
  origin: z.literal('researcher').optional(),
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
  /** The platform this product is a component of. Leave it out to keep what is saved; null clears it. */
  partOfProductId: z.uuid().nullable().optional(),
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
  part_of_product_id: string | null;
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
  /** The platform this product is part of, when it is a component. */
  partOfProductId: string | null;
  /** How many components this product has (it is a platform when above zero). */
  componentCount: number;
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
  /** The capability's definition, when its set has one. */
  description?: string | null;
}

/** Step 5a: what a check of one claim source link found. A record only; nothing here changes a claim or a revision. */
export const SOURCE_CHECK_RESULTS = ['works', 'moved', 'gone', 'could_not_check'] as const;
export const sourceCheckResultSchema = z.enum(SOURCE_CHECK_RESULTS);
export type SourceCheckResult = z.infer<typeof sourceCheckResultSchema>;

export const sourceCheckSchema = z.object({
  url: z.string().min(1).max(2000),
  result: sourceCheckResultSchema,
  httpStatus: z.number().int().min(100).max(599).nullable(),
  finalUrl: z.string().max(2000).nullable(),
  note: z.string().max(200).nullable(),
}).strict();
export type SourceCheckInput = z.infer<typeof sourceCheckSchema>;

/** A saved check, with who ran it (stamped by the server) and when. */
export interface SourceCheckRow extends SourceCheckInput {
  checkedAt: string;
  checkedByName: string | null;
  /** Set when a person chose to keep this link out of the list until this date (the server stamps who and when). */
  hiddenUntil: string | null;
  hiddenByName: string | null;
  hiddenReason: string | null;
}

/** A product merged into another: the record only. The merged product is kept. */
export interface ProductMergeRow {
  mergedProductId: string;
  keptProductId: string;
  reason: string | null;
  mergedByName: string | null;
  mergedAt: string;
}

/** The plain words for a check result. */
export function sourceCheckLabel(result: SourceCheckResult): string {
  switch (result) {
    case 'works': return 'Works';
    case 'moved': return 'Moved';
    case 'gone': return 'Gone';
    case 'could_not_check': return 'Could not check';
  }
}

/** Step 5b-1: what the platform's AI found when it read the page a claim cites. */
export const CLAIM_CHECK_VERDICTS = ['supported', 'changed', 'cant_tell'] as const;
export const claimCheckVerdictSchema = z.enum(CLAIM_CHECK_VERDICTS);
export type ClaimCheckVerdict = z.infer<typeof claimCheckVerdictSchema>;

/** A claim as the claim checker needs it: which product, which link, and the exact claim text. */
export interface ClaimForCheck {
  productId: string;
  product: string;
  vendor: string;
  sourceUrl: string;
  statement: string;
}

/** A saved claim check. `dismissedAt` is set when a person looked and kept the claim. */
export interface ClaimCheckRow {
  productId: string;
  sourceUrl: string;
  statement: string;
  verdict: ClaimCheckVerdict;
  quote: string | null;
  note: string | null;
  model: string | null;
  checkedAt: string;
  checkedByName: string | null;
  dismissedAt: string | null;
  dismissedByName: string | null;
}

export function claimCheckVerdictLabel(verdict: ClaimCheckVerdict): string {
  switch (verdict) {
    case 'supported': return 'Still supported';
    case 'changed': return 'Changed';
    case 'cant_tell': return "Can't tell";
  }
}

/** The key a claim and its saved check share: product, link and exact text. */
export function claimCheckKey(row: { productId: string; sourceUrl: string; statement: string }): string {
  return `${row.productId}\u0000${row.sourceUrl.trim()}\u0000${row.statement}`;
}

/** Step 5b-2: how a catalogue check run ended, and the monthly switch. */
export const CHECK_RUN_STATUSES = ['running', 'finished', 'stopped', 'limit_reached', 'failed'] as const;
export type CheckRunStatus = (typeof CHECK_RUN_STATUSES)[number];
export type CheckRunScope = 'links' | 'claims' | 'both' | 'find' | 'find_set';

export interface CheckRunRow {
  id: string;
  kind: 'manual' | 'monthly';
  scope: CheckRunScope;
  status: CheckRunStatus;
  startedAt: string;
  finishedAt: string | null;
  startedByName: string | null;
  linksChecked: number;
  claimsChecked: number;
  flagged: number;
  searches: number;
  productsFound: number;
  tokens: number;
  note: string | null;
}

export interface CheckSchedule {
  enabled: boolean;
  switchedByName: string | null;
  switchedAt: string | null;
}

export function checkRunStatusLabel(status: CheckRunStatus): string {
  switch (status) {
    case 'running': return 'Running';
    case 'finished': return 'Finished';
    case 'stopped': return 'Stopped';
    case 'limit_reached': return 'Stopped at the daily limit';
    case 'failed': return 'Did not finish';
  }
}

export function checkRunScopeLabel(scope: CheckRunScope): string {
  switch (scope) {
    case 'links': return 'Source links';
    case 'claims': return 'Claims';
    case 'both': return 'Links and claims';
    case 'find': return 'Find products';
    case 'find_set': return 'Find products for a set';
  }
}

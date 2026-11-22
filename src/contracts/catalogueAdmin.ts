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
import { catalogueClaimSchema, containsCataloguePrice } from './productCatalogue';

export const CATALOGUE_PRODUCT_LIMITS = {
  code: 61,
  product: 120,
  vendor: 120,
  summary: 500,
  capabilities: 200,
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

export const catalogueProductContentSchema = z.object({
  code: text(CATALOGUE_PRODUCT_LIMITS.code).regex(/^[a-z0-9][a-z0-9-]{1,60}$/, 'Use lowercase letters, numbers and hyphens'),
  product: text(CATALOGUE_PRODUCT_LIMITS.product),
  vendor: text(CATALOGUE_PRODUCT_LIMITS.vendor),
  summary: text(CATALOGUE_PRODUCT_LIMITS.summary),
  capabilities: z.array(catalogueProductCapabilitySchema).max(CATALOGUE_PRODUCT_LIMITS.capabilities),
  claims: z.array(catalogueClaimSchema).max(CATALOGUE_PRODUCT_LIMITS.claims),
}).strict().superRefine((value, ctx) => {
  const links = new Set(value.capabilities.map((link) => `${link.capabilityMapId}\u0000${link.capabilityCode}`));
  if (links.size !== value.capabilities.length) ctx.addIssue({ code: 'custom', message: 'A capability can appear only once for a product' });
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
  capabilitySetCount: number;
  claimCount: number;
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
  reviewed_by: string;
  reviewed_at: string;
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

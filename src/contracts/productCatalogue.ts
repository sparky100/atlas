/** Reviewed product content, independent of any organisation's estate. */
import { z } from 'zod';
import { SECTORS } from './capabilityMapContent';

// Portable SQL/JS syntax: explicit word boundaries, never JS-only \b or PG-only \y.
export const CATALOGUE_NO_PRICE_PATTERN = "[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \\t]+of[ \\t]+charge|per[ \\t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)";
export const CATALOGUE_SOURCE_URL_PATTERN = "^https://[^/@:\\s?#]+(/[^\\s]*)?$";
export const CATALOGUE_CLAIM_KINDS = ['functional', 'deployment', 'licensing_model', 'support_end', 'integration'] as const;
export const CATALOGUE_SNAPSHOT_MAX_BYTES = 8000;
/** What a saved citation is, relative to the catalogue as it stands now. */
export type CatalogueStanding = 'current' | 'replaced' | 'withdrawn';
const price = new RegExp(CATALOGUE_NO_PRICE_PATTERN, 'i');
const url = new RegExp(CATALOGUE_SOURCE_URL_PATTERN);
export const containsCataloguePrice = (value: string): boolean => price.test(value);
const text = (max: number) => z.string().min(1).max(max).refine((v) => v.trim().length > 0 && !price.test(v), 'Required text without prices');

export const catalogueCitationSchema = z.object({
  sector: z.string().min(1).max(60), version: z.number().int().positive(), entryCode: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
}).strict();
export type CatalogueCitation = z.infer<typeof catalogueCitationSchema>;
export const catalogueCapabilitySchema = z.object({ code: text(40), name: text(200), howItSupports: text(300) }).strict();
export const catalogueClaimSchema = z.object({
  position: z.number().int().positive(), kind: z.enum(CATALOGUE_CLAIM_KINDS), statement: text(400),
  sourceUrl: text(2000).refine((v) => {
    if (!url.test(v)) return false;
    try {
      const host = new URL(v).hostname.toLowerCase();
      return host.includes('.') && !host.endsWith('.localhost') && !/^[0-9.]+$/.test(host) && !host.includes(':');
    } catch { return false; }
  }, 'Use a public HTTPS source URL without credentials or a port'),
  sourceDate: z.iso.date(), reviewedBy: text(120), reviewedAt: z.iso.date(),
}).strict().refine((c) => c.reviewedAt >= c.sourceDate, 'Review cannot precede the source date');
export const catalogueEntrySchema = z.object({
  code: text(61).regex(/^[a-z0-9][a-z0-9-]{1,60}$/), product: text(120), vendor: text(120), summary: text(500),
  capabilities: z.array(catalogueCapabilitySchema).min(1).max(10), claims: z.array(catalogueClaimSchema).min(1).max(8),
}).strict().superRefine((e, ctx) => {
  if (new Set(e.capabilities.map((c) => c.code)).size !== e.capabilities.length) ctx.addIssue({ code: 'custom', message: 'Duplicate capability code' });
  if (new Set(e.claims.map((c) => c.position)).size !== e.claims.length) ctx.addIssue({ code: 'custom', message: 'Duplicate claim position' });
});
export const productCatalogueContentSchema = z.object({
  sector: z.enum(SECTORS), version: z.number().int().positive(), capabilityMapVersion: z.number().int().positive(),
  status: z.enum(['draft', 'published']), title: text(120), sourceDescription: text(1000), licence: z.literal('CC-BY-4.0'),
  entries: z.array(catalogueEntrySchema).min(1),
}).strict().superRefine((c, ctx) => {
  if (new Set(c.entries.map((e) => e.code)).size !== c.entries.length) ctx.addIssue({ code: 'custom', message: 'Duplicate entry code' });
});
export type ProductCatalogueContent = z.infer<typeof productCatalogueContentSchema>;
export type CatalogueEntry = z.infer<typeof catalogueEntrySchema>;
export type CatalogueClaim = z.infer<typeof catalogueClaimSchema>;
export type CatalogueCapability = z.infer<typeof catalogueCapabilitySchema>;
export interface CatalogueSnapshot {
  sector: string; version: number; capabilityMapVersion: number; catalogueTitle: string; licence: 'CC-BY-4.0';
  entryCode: string; product: string; vendor: string; summary: string;
  capabilities: CatalogueCapability[]; claims: CatalogueClaim[];
}
export interface ProductCatalogueRow {
  id: string; sector: string; version: number; capability_map_version: number; status: 'draft' | 'published';
  title: string; source_description: string; licence: 'CC-BY-4.0'; published_at: string | null; created_at: string;
  withdrawn_at: string | null; withdrawn_reason: string | null;
}
export interface CatalogueEntryRow { id: string; catalogue_id: string; code: string; product: string; vendor: string; summary: string; created_at: string }
export interface CatalogueCapabilityRow { entry_id: string; capability_code: string; capability_name: string; how_it_supports: string }
export interface CatalogueClaimRow {
  id: string; entry_id: string; position: number; kind: CatalogueClaim['kind']; statement: string;
  source_url: string; source_date: string; reviewed_by: string; reviewed_at: string; created_at: string;
}
export interface OptionCatalogueSourceRow {
  decision_id: string; branch_id: string; catalogue_sector: string; catalogue_version: number; entry_code: string;
  snapshot: CatalogueSnapshot; cited_by: string; cited_at: string;
}

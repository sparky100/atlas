import { z } from 'zod';
import { defineTool, displayNameOf, failure, indexSnapshot, okResult, uuidInput } from './toolKit';

/** The starter-map item a seeded capability came from (`attributes.templateRef`). */
export function capabilityTemplateRef(attributes: unknown): string | null {
  if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) return null;
  const value = (attributes as Record<string, unknown>).templateRef;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The capability's own code, which stays stable when a draft map is reloaded and its item ids change. */
export function capabilityCode(attributes: unknown): string | null {
  if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) return null;
  const value = (attributes as Record<string, unknown>).code;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

const schema = z.object({ capability_element_id: uuidInput }).strict();

/**
 * Reviewed products the published catalogue says support one capability.
 * Read-only, and deliberately narrow: only products the catalogue links to
 * the capability's own starter-map item, never a name guessed from the
 * capability's words. The answer is evidence to weigh, not a recommendation.
 */
export const findCatalogueProducts = defineTool({
  name: 'find_catalogue_products',
  description:
    'Reviewed products from the published catalogue that support one capability. Give the id of a capability element. Returns product, vendor, summary, how it supports the capability, and dated sourced claims. These are candidates, not a recommendation or a procurement decision. A capability that was not created from a starter map returns an explanation and no products.',
  schema,
  run: async (ctx, input) => {
    const index = indexSnapshot(await ctx.snapshot());
    const element = index.byId.get(input.capability_element_id);
    if (!element) return failure('There is no element with that id in this model.');
    if (element.element_type !== 'capability') return failure('find_catalogue_products only reads a capability element; that id is a ' + element.element_type + '.');
    const templateRef = capabilityTemplateRef(element.attributes);
    if (templateRef === null) {
      return failure('That capability was not created from a starter map, so there are no reviewed catalogue products to look up. Do not name a product from memory; record this as a gap instead.');
    }
    if (ctx.catalogueForCapability === undefined) {
      return failure('The reviewed product catalogue is not available to this run. Record that instead of naming a product from memory.');
    }
    const catalogue = await ctx.catalogueForCapability({ templateRef, code: capabilityCode(element.attributes) });
    if (catalogue === null) {
      return failure('No published catalogue covers this capability\'s sector yet, or its starter-map link no longer resolves. Record that as a gap instead of naming a product from memory.');
    }
    const products = catalogue.entries.map((entry) => ({
      entryCode: entry.code,
      product: entry.product,
      vendor: entry.vendor,
      summary: entry.summary,
      howItSupports: entry.howItSupports,
      claims: entry.claims.map((claim) => ({
        statement: claim.statement,
        kind: claim.kind,
        sourceUrl: claim.sourceUrl,
        sourceDate: claim.sourceDate,
      })),
    }));
    return okResult(
      ctx,
      {
        capability: { id: element.element_id, name: displayNameOf(index, element), code: catalogue.capabilityCode },
        catalogue: { sector: catalogue.sector, version: catalogue.catalogueVersion },
        products,
        note: 'Reviewed candidates from the published catalogue, not a recommendation or a procurement decision.',
      },
      products.length,
    );
  },
});

export interface CatalogueProductRef { sector: string; version: number; entryCode: string }

/** The citation a model should use for one product in this answer. */
export function catalogueRefFor(catalogue: { sector: string; catalogueVersion: number }, entryCode: string): CatalogueProductRef {
  return { sector: catalogue.sector, version: catalogue.catalogueVersion, entryCode };
}

export const catalogueRefKey = (ref: CatalogueProductRef): string => `${ref.sector}\u0000${String(ref.version)}\u0000${ref.entryCode}`;

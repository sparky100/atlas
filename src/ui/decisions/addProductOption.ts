import type { UUID } from '../../contracts/delta';
import { DESIGNER_SUMMARY_MAX, DESIGNER_TITLE_MAX } from '../../contracts/designerOptions';
import { createDecisionOption, getDecisionOption } from '../../db/decisionOptions';
import { insertOptionCatalogueSource } from '../../db/productCatalogue';
import type { DecisionOptionRow } from '../../db/types';
import { supabase } from '../supabaseClient';

/** A reviewed catalogue product, as both the products panel and a saved source know it. */
export interface ProductForOption {
  product: string;
  vendor: string;
  summary: string;
  sector: string;
  version: number;
  entryCode: string;
}

/**
 * Pure: "Use Esri ArcGIS Utility Network". The same title the Designer's
 * "Use this product" and a researched page's "Use as an option" give, so a
 * product option reads the same whichever way it was added. The option's
 * approach is stored separately: Buy, or Use when the product is already in the model.
 */
export function productOptionTitle(product: Pick<ProductForOption, 'product'>): string {
  return `Use ${product.product.trim()}`.slice(0, DESIGNER_TITLE_MAX);
}

/** Pure: true when an option with the same title is already on the decision. */
export function hasProductOption(product: Pick<ProductForOption, 'product'>, optionTitles: readonly string[]): boolean {
  const title = productOptionTitle(product).toLowerCase();
  return optionTitles.some((existing) => existing.trim().toLowerCase() === title);
}

export interface AddProductOptionInput {
  decisionId: UUID;
  userId: UUID;
  product: ProductForOption;
  /** Stable for one button, so a retry after a partial failure finishes the same option instead of duplicating it. */
  optionId: UUID;
  /** Buy, or Use when the product is already in the model (`suggestedApproach`); a person can change it. */
  approach?: 'buy' | 'use';
}

export interface AddProductOptionResult {
  option: DecisionOptionRow;
  /** The option exists, but the product could not be saved with it. Shown to the person, never hidden. */
  sourceError: string | null;
}

/**
 * Turns a reviewed catalogue product into a Buy candidate option on the
 * decision, with the product saved as its source. A person did it, so the
 * option carries no Designer mark. No change is made until someone works on
 * the option.
 */
export async function addProductOption(input: AddProductOptionInput): Promise<AddProductOptionResult> {
  const option = (await getDecisionOption(supabase, input.optionId)) ?? (await createDecisionOption(supabase, {
    id: input.optionId,
    decisionId: input.decisionId,
    title: productOptionTitle(input.product),
    summary: input.product.summary.slice(0, DESIGNER_SUMMARY_MAX),
    approach: input.approach ?? 'buy',
    createdBy: input.userId,
  }));
  let sourceError: string | null = null;
  try {
    await insertOptionCatalogueSource(supabase, {
      decisionId: input.decisionId,
      optionId: option.id,
      sector: input.product.sector,
      version: input.product.version,
      entryCode: input.product.entryCode,
      citedBy: input.userId,
    });
  } catch (e) {
    const message = e instanceof Error && e.message !== '' ? e.message : 'The product could not be saved with the option.';
    sourceError = message.includes('already saved') ? null : message;
  }
  return { option, sourceError };
}

import type { UUID } from '../../contracts/delta';
import type { OptionCatalogueSource } from '../../contracts/optionSource';
import { createDecision, createDecisionLink } from '../../db/decisions';
import type { DecisionLinkRow, DecisionOptionRow, DecisionRow } from '../../db/types';
import { supabase } from '../supabaseClient';
import { addBaseline } from './addBaseline';
import { addProductOption, type ProductForOption } from './addProductOption';

/** At most this many products are carried over; more can be added on the new decision. */
export const PRODUCT_DECISION_MAX_PRODUCTS = 8;

/** Pure: "Which product for: Replace with a product?" */
export function productDecisionTitle(optionTitle: string): string {
  const title = optionTitle.trim().replace(/[?.]+$/, '');
  return `Which product for: ${title}?`;
}

/** Pure: the products the new decision starts with, saved sources first, each catalogue entry once. */
export function productsToCarry(saved: readonly OptionCatalogueSource[], listed: readonly ProductForOption[]): ProductForOption[] {
  const out: ProductForOption[] = [];
  const seen = new Set<string>();
  const add = (p: ProductForOption) => {
    const key = `${p.sector}\u0000${String(p.version)}\u0000${p.entryCode}`;
    // The same product from an older catalogue version is still the same product.
    const sameProduct = `${p.sector}\u0000${p.entryCode}`;
    if (seen.has(key) || seen.has(sameProduct) || out.length >= PRODUCT_DECISION_MAX_PRODUCTS) return;
    seen.add(key);
    seen.add(sameProduct);
    out.push(p);
  };
  for (const s of saved) {
    if (s.standing !== 'current') continue;
    add({ product: s.product, vendor: s.vendor, summary: s.summary, sector: s.sector, version: s.version, entryCode: s.entryCode });
  }
  for (const p of listed) add(p);
  return out;
}

export interface StartProductDecisionInput {
  /** Minted by the caller, so a retry does not start a second decision. */
  id: UUID;
  parent: DecisionRow;
  option: DecisionOptionRow;
  /** The parent's element and relationship links: what the new decision is about too. */
  links: readonly DecisionLinkRow[];
  products: readonly ProductForOption[];
  userId: UUID;
}

export interface StartedProductDecision {
  decision: DecisionRow;
  /** Steps after the decision itself that did not complete. The decision still opens; these are shown, never hidden. */
  problems: string[];
}

/**
 * Starts "Which product for: <option>?" from a chosen Buy option: the need,
 * the outcome, the owner, the date and the project are carried over, it is
 * about the same capabilities and systems, it has "Stay as we are", and each
 * product becomes a "Use <product>" candidate with its catalogue source.
 * Nobody retypes anything. The database checks the option is the parent's
 * chosen Buy option and that no other product decision is open for it.
 */
export async function startProductDecision(input: StartProductDecisionInput): Promise<StartedProductDecision> {
  const { parent, option } = input;
  const decision = await createDecision(supabase, {
    id: input.id,
    orgId: parent.org_id,
    modelId: parent.model_id,
    title: productDecisionTitle(option.title),
    statement: parent.statement,
    outcome: parent.outcome,
    ownerId: parent.owner_id,
    ...(parent.needed_by !== null ? { neededBy: parent.needed_by } : {}),
    projectId: parent.project_id,
    followsOptionId: option.id,
    createdBy: input.userId,
  });
  const problems: string[] = [];
  for (const link of input.links) {
    if (link.linked_type !== 'element' && link.linked_type !== 'relationship') continue;
    try {
      await createDecisionLink(supabase, { decisionId: decision.id, linkedType: link.linked_type, linkedId: link.linked_id, createdBy: input.userId });
    } catch (e) {
      problems.push(e instanceof Error ? e.message : 'A link could not be carried over.');
    }
  }
  try {
    await addBaseline({ orgId: parent.org_id, modelId: parent.model_id, decisionId: decision.id, userId: input.userId, projectId: parent.project_id });
  } catch (e) {
    problems.push(e instanceof Error ? e.message : '"Stay as we are" could not be added.');
  }
  for (const product of input.products) {
    try {
      const result = await addProductOption({ decisionId: decision.id, userId: input.userId, product, optionId: crypto.randomUUID() });
      if (result.sourceError !== null) problems.push(result.sourceError);
    } catch (e) {
      problems.push(e instanceof Error ? e.message : `${product.product} could not be added.`);
    }
  }
  return { decision, problems };
}

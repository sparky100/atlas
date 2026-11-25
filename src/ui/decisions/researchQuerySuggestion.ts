/**
 * Builds the *suggestion* a person sees before a public web search. It is
 * deliberately deterministic and uses only fields already on screen in
 * structured form: the option's own name, the decision title, the capabilities
 * the decision concerns, and product/vendor names already saved as catalogue
 * sources or named by a "Use <product>" option.
 *
 * The search has two intents:
 *  - `find-products`: no product is named yet, so the query is a market scan.
 *  - `score-product`: a product is named, so the query looks for evidence to
 *    score it against the decision's own criteria.
 *
 * Nothing here sends anything: the dialog shows the result in an editable box
 * and the person still approves the exact text before the Researcher runs.
 */
import { stripIntentPrefix } from './optionLabel';
import { WEB_RESEARCH_QUERY_MAX } from './webResearchQuery';

export type ResearchQueryIntent = 'find-products' | 'score-product';

export interface ResearchProduct {
  product: string;
  vendor: string;
}

export interface ResearchQueryContext {
  optionLabel: string;
  decisionTitle: string;
  /** Capabilities the decision concerns, in the decision's own link order. */
  capabilityNames: readonly string[];
  /** Product names already saved with this option as reviewed catalogue sources. */
  productNames?: readonly string[];
  /** Vendors of those products. */
  vendorNames?: readonly string[];
  /** The same products with their vendors, so a product can be scored with its own vendor. */
  optionProducts?: readonly ResearchProduct[];
  /** The product the person picked in the dialog, when there is more than one. */
  selectedProductName?: string | undefined;
}

export interface ResearchQuerySuggestion {
  intent: ResearchQueryIntent;
  /** The product the query is scoring, or null for a market scan. */
  productName: string | null;
  /** The products the person can choose between; empty for a market scan. */
  productOptions: string[];
  /** The chips the query was built from. */
  chips: string[];
  /** The editable starting text. Never sent without the person's approval. */
  query: string;
}

/** Long enough to name a real capability or product, short enough to stay a search phrase. */
const MAX_CHIP_CHARS = 80;
/** The most chips a person can scan at once. */
const MAX_CHIPS = 10;

/** The decision's own scoring criteria, in the words a search can use. */
const SCORING_TERMS = ['pricing', 'implementation', 'support', 'integrations', 'roadmap'];

/** The option kinds that say nothing a search could use; the capability and product carry the meaning. */
const GENERIC_OPTION_LABELS = [
  /^replace with a product$/i,
  /^build (it )?ourselves$/i,
  /^build (a|the) replacement$/i,
  /^configure what we already run$/i,
  /^keep and tidy up$/i,
  /^stay(ing)? as we are$/i,
  /^no change$/i,
];

/** One chip: no intent prefix, no "Use " prefix, one line, sentence punctuation trimmed, bounded. */
export function cleanChip(value: string): string {
  const withoutIntent = stripIntentPrefix(value);
  const withoutUse = withoutIntent.replace(/^use\s+/i, '');
  const oneLine = withoutUse.replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '');
  if (oneLine.length <= MAX_CHIP_CHARS) return oneLine;
  const cut = oneLine.slice(0, MAX_CHIP_CHARS);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd();
}

function isGeneric(label: string): boolean {
  return GENERIC_OPTION_LABELS.some((pattern) => pattern.test(label));
}

function uniqueChips(candidates: readonly string[]): string[] {
  const chips: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate === '' || isGeneric(candidate)) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push(candidate);
    if (chips.length >= MAX_CHIPS) break;
  }
  return chips;
}

/**
 * Joins the chips into the query the Researcher receives. A market scan uses
 * a natural phrase so a search engine understands "find products", not a bare
 * list of capability words. A scoring search joins product, vendor, capability
 * and the scoring terms. Both keep the 300-character limit by dropping whole
 * chips from the end.
 */
export function buildResearchQuery(chips: readonly string[], intent: ResearchQueryIntent = 'score-product'): string {
  const words = chips.map((chip) => chip.trim()).filter((chip) => chip !== '');
  if (intent === 'find-products') {
    const subjects = [...words];
    let query = subjects.length > 0 ? `software products that support ${subjects.join(' ')}` : 'software products';
    while (subjects.length > 1 && query.length > WEB_RESEARCH_QUERY_MAX) {
      subjects.pop();
      query = `software products that support ${subjects.join(' ')}`;
    }
    return query.slice(0, WEB_RESEARCH_QUERY_MAX).trim();
  }
  let query = words.join(' ');
  while (words.length > 1 && query.length > WEB_RESEARCH_QUERY_MAX) {
    words.pop();
    query = words.join(' ');
  }
  return query.slice(0, WEB_RESEARCH_QUERY_MAX).trim();
}

export function suggestResearchQuery(context: ResearchQueryContext): ResearchQuerySuggestion {
  const optionProducts: ResearchProduct[] = context.optionProducts !== undefined
    ? context.optionProducts.map((item) => ({ product: cleanChip(item.product), vendor: cleanChip(item.vendor) }))
    : (context.productNames ?? []).map((product, index) => ({ product: cleanChip(product), vendor: cleanChip(context.vendorNames?.[index] ?? '') }));
  // An option called "Use <page>" names its own product even when no catalogue
  // source is attached yet; that is still the person's own, visible wording.
  const productFromOptionTitle = /^use\s+/i.test(context.optionLabel) ? cleanChip(context.optionLabel) : '';
  const productOptions = uniqueChips([
    ...optionProducts.map((item) => item.product),
    productFromOptionTitle,
  ]);
  const requestedProduct = context.selectedProductName !== undefined ? cleanChip(context.selectedProductName) : '';
  const selectedProduct = requestedProduct !== '' && productOptions.some((product) => product.toLowerCase() === requestedProduct.toLowerCase())
    ? requestedProduct
    : (productOptions[0] ?? '');
  const selectedVendor = optionProducts.find((item) => item.product.toLowerCase() === selectedProduct.toLowerCase())?.vendor
    ?? cleanChip(context.vendorNames?.[0] ?? '');
  const intent: ResearchQueryIntent = selectedProduct === '' ? 'find-products' : 'score-product';

  const capabilityNames = context.capabilityNames.map(cleanChip);
  const optionLabel = cleanChip(context.optionLabel);
  const candidates = intent === 'score-product'
    ? [selectedProduct, selectedVendor, ...capabilityNames, optionLabel, ...SCORING_TERMS]
    : [...capabilityNames, optionLabel];
  const chips = uniqueChips(candidates);

  // The decision title adds context only when the option and capability names
  // do not already contain it; repeating a word already in the query is noise.
  const decisionTitle = cleanChip(context.decisionTitle);
  const titleKey = decisionTitle.toLowerCase();
  if (
    decisionTitle !== ''
    && chips.length < MAX_CHIPS
    && !optionLabel.toLowerCase().includes(titleKey)
    && !chips.some((chip) => chip.toLowerCase().includes(titleKey))
  ) {
    chips.push(decisionTitle);
  }

  return {
    intent,
    productName: intent === 'score-product' ? selectedProduct : null,
    productOptions,
    chips,
    query: buildResearchQuery(chips, intent),
  };
}

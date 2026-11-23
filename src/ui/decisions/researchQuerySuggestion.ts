/**
 * Builds the *suggestion* a person sees before a public web search. It is
 * deliberately deterministic and uses only fields already on screen in
 * structured form: the option's own name, the decision title, the capabilities
 * the decision concerns, and product/vendor names already saved as catalogue
 * sources. Free text, notes, people, organisation names, descriptions and URLs
 * never contribute.
 *
 * Nothing here sends anything: the dialog shows the result in an editable box
 * and the person still approves the exact text before the Researcher runs.
 */
import { stripIntentPrefix } from './optionLabel';
import { WEB_RESEARCH_QUERY_MAX } from './webResearchQuery';

export interface ResearchQueryContext {
  optionLabel: string;
  decisionTitle: string;
  /** Capabilities the decision concerns, in the decision's own link order. */
  capabilityNames: readonly string[];
  /** Product names already saved with this option as reviewed catalogue sources. */
  productNames?: readonly string[];
  /** Vendors of those products. */
  vendorNames?: readonly string[];
}

export interface ResearchQuerySuggestion {
  /** The chips the query was built from, in the order they appear in the query. */
  chips: string[];
  /** The editable starting text. Never sent without the person's approval. */
  query: string;
}

/** Long enough to name a real capability or product, short enough to stay a search phrase. */
const MAX_CHIP_CHARS = 80;
/** The most chips a person can scan at once. */
const MAX_CHIPS = 8;

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
  const oneLine = withoutUse.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  if (oneLine.length <= MAX_CHIP_CHARS) return oneLine;
  const cut = oneLine.slice(0, MAX_CHIP_CHARS);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd();
}

function isGeneric(label: string): boolean {
  return GENERIC_OPTION_LABELS.some((pattern) => pattern.test(label));
}

/**
 * Joins chips with spaces and keeps the whole thing within the Researcher's
 * limit by dropping whole chips from the end. A single over-long chip is cut
 * at a word boundary as a last resort, never mid-word.
 */
export function buildResearchQuery(chips: readonly string[]): string {
  const words = chips.map((chip) => chip.trim()).filter((chip) => chip !== '');
  let query = words.join(' ');
  while (words.length > 1 && query.length > WEB_RESEARCH_QUERY_MAX) {
    words.pop();
    query = words.join(' ');
  }
  return query.slice(0, WEB_RESEARCH_QUERY_MAX).trim();
}

export function suggestResearchQuery(context: ResearchQueryContext): ResearchQuerySuggestion {
  const optionLabel = cleanChip(context.optionLabel);
  const decisionTitle = cleanChip(context.decisionTitle);
  const candidates = [
    ...context.capabilityNames.map(cleanChip),
    optionLabel,
    ...(context.productNames ?? []).map(cleanChip),
    ...(context.vendorNames ?? []).map(cleanChip),
  ];

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

  // The decision title adds context only when the option and capability names
  // do not already contain it; repeating a word already in the query is noise.
  const titleKey = decisionTitle.toLowerCase();
  if (
    decisionTitle !== ''
    && chips.length < MAX_CHIPS
    && !optionLabel.toLowerCase().includes(titleKey)
    && !chips.some((chip) => chip.toLowerCase().includes(titleKey))
  ) {
    chips.push(decisionTitle);
  }

  return { chips, query: buildResearchQuery(chips) };
}

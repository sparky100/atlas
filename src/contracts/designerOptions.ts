/**
 * The Designer's output contract (PROPOSAL-designer-to-options-journey, 5 and 5a).
 * The Designer no longer returns only prose: it returns options a person can
 * edit and carry into a decision. This file is the one place that says what a
 * valid answer looks like, so the server checks it before anything reaches a
 * person and a half-formed answer can never read as a finished one. No I/O.
 *
 * "Stay as we are" is never in this list: Atlas always gives a decision that
 * baseline itself, so a card for it would only duplicate it. The Designer's
 * note on it comes back as `stayNote`, shown but not stored as an option.
 */
import { catalogueCitationSchema, type CatalogueCitation } from './productCatalogue';
export const DESIGNER_OPTIONS_MIN = 2;
export const DESIGNER_OPTIONS_MAX = 6;
/** A "Replace with a product" option may carry at most two reviewed products. */
export const DESIGNER_CATALOGUE_REFS_MAX = 2;
/** D4: and at most two web pages the search actually returned. */
export const DESIGNER_WEB_REFS_MAX = 2;
export const DESIGNER_TITLE_MAX = 120;
export const DESIGNER_SUMMARY_MAX = 600;
export const DESIGNER_WEIGH_MAX = 800;
export const DESIGNER_GAPS_MAX = 8;
export const DESIGNER_GAP_MAX = 240;

export interface DesignerWebRef {
  url: string;
  title: string;
}

export interface DesignerCatalogueClaim {
  statement: string;
  kind: string;
  sourceUrl: string;
  sourceDate: string;
}

/** One reviewed product the Designer actually read for an option, with the evidence behind it. */
export interface DesignerCatalogueProduct {
  ref: CatalogueCitation;
  product: string;
  vendor: string;
  summary: string;
  /** The capability the catalogue linked this product to, for the card's "why it matched" line. */
  capabilityName: string;
  howItSupports: string;
  claims: DesignerCatalogueClaim[];
}

export interface DesignerOptionDraft {
  title: string;
  /** One or two plain sentences on what the option is. */
  summary: string;
  /** The main thing to weigh. Empty when the Designer gave none. */
  toWeigh: string;
  /** Products the Designer actually read from the published catalogue for this option; empty for every other kind of option. */
  catalogueRefs: CatalogueCitation[];
  /** The same products in display form, so the card can show names, vendors and claims instead of a count. */
  catalogueProducts: DesignerCatalogueProduct[];
  /** Pages the web search actually returned and the Designer cited; empty when it did not search or found nothing suitable. */
  webRefs: DesignerWebRef[];
}

export interface DesignerOptionsResult {
  options: DesignerOptionDraft[];
  /** What the Designer could not tell from what Atlas holds. */
  gaps: string[];
  /** What staying as we are costs, in the Designer's words. Empty when absent. */
  stayNote: string;
  /** Why the answer is not complete, in plain words. Empty when it is complete. */
  problems: string[];
}

const BASELINE = /^\s*stay(ing)? as we are\s*$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  // Cut at the last sentence or word boundary rather than mid-word; the
  // ellipsis tells a reader the model's answer was longer than the card allows.
  const cut = trimmed.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '), cut.lastIndexOf('; '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** Finds the one JSON object in the model's answer, allowing for a code fence or a line of preamble. */
function extractJson(answer: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(answer);
  const candidate = fenced?.[1] ?? answer;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Shape-only check here; whether the tool actually returned each ref is checked by the run that read the catalogue. */
function catalogueRefs(value: unknown): CatalogueCitation[] {
  if (!Array.isArray(value)) return [];
  const refs: CatalogueCitation[] = [];
  for (const raw of value) {
    const parsed = catalogueCitationSchema.safeParse(raw);
    if (!parsed.success) continue;
    if (refs.some((r) => r.sector === parsed.data.sector && r.version === parsed.data.version && r.entryCode === parsed.data.entryCode)) continue;
    refs.push(parsed.data);
    if (refs.length >= DESIGNER_CATALOGUE_REFS_MAX) break;
  }
  return refs;
}

export function catalogueRefKeyOf(ref: CatalogueCitation): string {
  return `${ref.sector}\u0000${String(ref.version)}\u0000${ref.entryCode}`;
}

/**
 * Reads the catalogue cards an agent run attached, without trusting its text.
 * A card is kept only when its citation is valid, it names a product and a
 * vendor, and it is one of the products the run actually read. The server
 * already filtered the cards; this is the UI's own shape check for stored
 * drafts and older replies.
 */
export function parseCatalogueProducts(value: unknown): DesignerCatalogueProduct[] {
  if (!Array.isArray(value)) return [];
  const out: DesignerCatalogueProduct[] = [];
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const ref = catalogueCitationSchema.safeParse(raw.ref);
    if (!ref.success) continue;
    const product = text(raw.product, 120);
    const vendor = text(raw.vendor, 120);
    if (product === '' || vendor === '') continue;
    const key = catalogueRefKeyOf(ref.data);
    if (out.some((item) => catalogueRefKeyOf(item.ref) === key)) continue;
    const claims: DesignerCatalogueClaim[] = Array.isArray(raw.claims)
      ? raw.claims.flatMap((claim): DesignerCatalogueClaim[] => {
          if (!isRecord(claim)) return [];
          const statement = text(claim.statement, 400);
          const sourceUrl = text(claim.sourceUrl, 2000);
          const sourceDate = text(claim.sourceDate, 40);
          if (statement === '' || sourceUrl === '' || sourceDate === '') return [];
          return [{ statement, kind: text(claim.kind, 40), sourceUrl, sourceDate }];
        })
      : [];
    out.push({ ref: ref.data, product, vendor, summary: text(raw.summary, 500), capabilityName: text(raw.capabilityName, 200), howItSupports: text(raw.howItSupports, 300), claims });
    if (out.length >= DESIGNER_CATALOGUE_REFS_MAX) break;
  }
  return out;
}

/** Shape-only check here; whether the search actually returned each page is checked by the run that searched. */
function webRefs(value: unknown): DesignerWebRef[] {
  if (!Array.isArray(value)) return [];
  const refs: DesignerWebRef[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.url !== 'string' || typeof raw.title !== 'string') continue;
    const title = raw.title.trim().slice(0, 200);
    if (title === '' || raw.url.length > 2000 || !isPublicHttpsUrl(raw.url)) continue;
    if (refs.some((r) => r.url === raw.url)) continue;
    refs.push({ url: raw.url, title });
    if (refs.length >= DESIGNER_WEB_REFS_MAX) break;
  }
  return refs;
}

function isPublicHttpsUrl(value: string): boolean {
  if (!value.startsWith('https://')) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes('.') && !host.endsWith('.localhost') && !/^[0-9.]+$/.test(host) && !host.includes(':');
  } catch {
    return false;
  }
}

/**
 * Reads the Designer's answer. It never throws and never guesses: an option
 * that fails a check is dropped and named in `problems`, and the result is
 * only complete (`problems` empty) when enough valid options came back.
 */
export function parseDesignerOptions(answer: string): DesignerOptionsResult {
  const empty: DesignerOptionsResult = { options: [], gaps: [], stayNote: '', problems: [] };
  const parsed = extractJson(answer);
  if (typeof parsed !== 'object' || parsed === null) {
    return { ...empty, problems: ['The Designer did not return options in a form Atlas can use.'] };
  }
  const root = parsed as Record<string, unknown>;
  const problems: string[] = [];
  const options: DesignerOptionDraft[] = [];
  const seen = new Set<string>();
  const rawOptions = Array.isArray(root.options) ? (root.options as unknown[]) : [];
  if (!Array.isArray(root.options)) problems.push('The Designer returned no list of options.');
  let dropped = 0;
  for (const raw of rawOptions) {
    const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const title = text(r.title, DESIGNER_TITLE_MAX);
    const summary = text(r.summary, DESIGNER_SUMMARY_MAX);
    const key = title.toLowerCase();
    if (title === '' || summary === '' || BASELINE.test(title) || seen.has(key) || options.length >= DESIGNER_OPTIONS_MAX) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    options.push({ title, summary, toWeigh: text(r.toWeigh, DESIGNER_WEIGH_MAX), catalogueRefs: catalogueRefs(r.catalogueRefs), catalogueProducts: [], webRefs: webRefs(r.webRefs) });
  }
  if (dropped > 0 && rawOptions.length > 0) problems.push(dropped === 1 ? 'One suggested option was left out because it was incomplete.' : `${String(dropped)} suggested options were left out because they were incomplete.`);
  if (options.length < DESIGNER_OPTIONS_MIN) problems.push(options.length === 0 ? 'The Designer gave no usable options.' : 'The Designer gave fewer options than expected.');
  const gaps = (Array.isArray(root.gaps) ? (root.gaps as unknown[]) : []).map((g) => text(g, DESIGNER_GAP_MAX)).filter((g) => g !== '').slice(0, DESIGNER_GAPS_MAX);
  return { options, gaps, stayNote: text(root.stayNote, DESIGNER_SUMMARY_MAX), problems };
}

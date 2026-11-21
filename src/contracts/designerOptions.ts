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
export const DESIGNER_TITLE_MAX = 120;
export const DESIGNER_SUMMARY_MAX = 600;
export const DESIGNER_WEIGH_MAX = 400;
export const DESIGNER_GAPS_MAX = 8;
export const DESIGNER_GAP_MAX = 240;

export interface DesignerOptionDraft {
  title: string;
  /** One or two plain sentences on what the option is. */
  summary: string;
  /** The main thing to weigh. Empty when the Designer gave none. */
  toWeigh: string;
  /** Products the Designer actually read from the published catalogue for this option; empty for every other kind of option. */
  catalogueRefs: CatalogueCitation[];
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

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
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
    options.push({ title, summary, toWeigh: text(r.toWeigh, DESIGNER_WEIGH_MAX), catalogueRefs: catalogueRefs(r.catalogueRefs) });
  }
  if (dropped > 0 && rawOptions.length > 0) problems.push(dropped === 1 ? 'One suggested option was left out because it was incomplete.' : `${String(dropped)} suggested options were left out because they were incomplete.`);
  if (options.length < DESIGNER_OPTIONS_MIN) problems.push(options.length === 0 ? 'The Designer gave no usable options.' : 'The Designer gave fewer options than expected.');
  const gaps = (Array.isArray(root.gaps) ? (root.gaps as unknown[]) : []).map((g) => text(g, DESIGNER_GAP_MAX)).filter((g) => g !== '').slice(0, DESIGNER_GAPS_MAX);
  return { options, gaps, stayNote: text(root.stayNote, DESIGNER_SUMMARY_MAX), problems };
}

import type { UUID } from '../contracts/delta';
import { DESIGNER_CATALOGUE_REFS_MAX, DESIGNER_WEB_REFS_MAX, designerApproach, parseCatalogueProducts, type DesignerOptionDraft, type DesignerWebRef } from '../contracts/designerOptions';
import { catalogueCitationSchema, type CatalogueCitation } from '../contracts/productCatalogue';
import type { AskEvent } from '../tools/askLoop';

/**
 * Phase D step 2b: the browser's side of the `design-agent` edge function.
 * It returns the Designer's draft as text for a person to read and edit. It
 * writes nothing. Any refusal or failure comes back as one plain sentence.
 */
export interface DesignerDraft {
  /** The suggested options, already checked by the function. Never includes "Stay as we are": Atlas adds that itself. */
  options: DesignerOptionDraft[];
  /** What the Designer could not tell from what Atlas holds. */
  gaps: string[];
  /** The Designer's note on what staying as we are costs. */
  stayNote: string;
  /** Why the answer is not complete, in plain words. Empty when it is. */
  problems: string[];
  /** Names of the elements the draft cites (each one a tool actually returned). */
  citedNames: string[];
  grounded: boolean;
  /** What the run used, shown to the person who asked. Tokens, not money: Atlas holds no price list. */
  usage: { inputTokens: number; outputTokens: number; lookups: number; webSearches: number };
}

export type DesignerErrorCode = 'rate_limited' | 'provider' | 'failed';

export class DesignerError extends Error {
  constructor(
    message: string,
    readonly code: DesignerErrorCode = 'failed',
  ) {
    super(message);
    this.name = 'DesignerError';
  }
}

interface DesignerBody {
  status?: string;
  message?: string;
  design?: { options?: unknown; gaps?: unknown; stayNote?: unknown; problems?: unknown };
  result?: { answer?: string; citations?: string[]; citationNames?: Record<string, string>; grounded?: boolean; inputTokens?: number; outputTokens?: number; toolUses?: unknown[]; webSearch?: { requests?: number } };
}

const CITATION = /\[\[element:([0-9a-f-]{36})\]\]/g;

/** Pure: the Designer cites elements as [[element:<id>]]. A person editing the text must see the name, never the id. */
export function citationsToNames(text: string, names: Record<string, string>): string {
  return text.replace(CITATION, (_m, id: string) => {
    const name = names[id];
    return typeof name === 'string' && name !== '' ? name : 'an element in the model';
  });
}

/** Pure: the element ids a saved text still cites as [[element:<id>]] (options saved before names were substituted). */
export function citationIds(text: string): string[] {
  return [...new Set([...text.matchAll(CITATION)].map((m) => m[1] ?? ''))].filter((id) => id !== '');
}

/** Only a public HTTPS page can be a saved web source. */
function isPublicHttpsUrl(value: string): boolean {
  if (!value.startsWith('https://')) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes('.') && !host.endsWith('.localhost') && !/^[0-9.]+$/.test(host) && !host.includes(':');
  } catch {
    return false;
  }
}

/** Pure: the one place the function's reply is read, so the page never shows a raw provider message. */
export function interpretDesignerReply(body: unknown): DesignerDraft {
  const r = (typeof body === 'object' && body !== null ? body : {}) as DesignerBody;
  if (r.status === 'done' && r.design !== undefined && r.result !== undefined) {
    const names = r.result.citationNames ?? {};
    const citedNames = (r.result.citations ?? []).map((id) => names[id]).filter((n): n is string => typeof n === 'string' && n !== '');
    const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => citationsToNames(x, names)) : []);
    const plain = (v: string) => citationsToNames(v, names);
    const refs = (v: unknown): CatalogueCitation[] => {
      if (!Array.isArray(v)) return [];
      const out: CatalogueCitation[] = [];
      for (const raw of v) {
        const parsed = catalogueCitationSchema.safeParse(raw);
        if (parsed.success) out.push(parsed.data);
        if (out.length >= DESIGNER_CATALOGUE_REFS_MAX) break;
      }
      return out;
    };
    const webRefs = (v: unknown): DesignerWebRef[] => {
      if (!Array.isArray(v)) return [];
      const out: DesignerWebRef[] = [];
      for (const raw of v) {
        if (typeof raw !== 'object' || raw === null) continue;
        const x = raw as Record<string, unknown>;
        if (typeof x.url !== 'string' || typeof x.title !== 'string' || x.title.trim() === '' || !isPublicHttpsUrl(x.url)) continue;
        out.push({ url: x.url, title: x.title });
        if (out.length >= DESIGNER_WEB_REFS_MAX) break;
      }
      return out;
    };
    const options = (Array.isArray(r.design.options) ? r.design.options : []).flatMap((o): DesignerOptionDraft[] => {
      const x = typeof o === 'object' && o !== null ? (o as Record<string, unknown>) : {};
      return typeof x.title === 'string' && typeof x.summary === 'string' ? [{ title: plain(x.title), approach: designerApproach(x.approach, plain(x.title)), summary: plain(x.summary), toWeigh: typeof x.toWeigh === 'string' ? plain(x.toWeigh) : '', catalogueRefs: refs(x.catalogueRefs), catalogueProducts: parseCatalogueProducts(x.catalogueProducts), webRefs: webRefs(x.webRefs) }] : [];
    });
    const problems = strings(r.design.problems);
    if (options.length === 0 && problems.length === 0) problems.push('The Designer gave no usable options.');
    return {
      options,
      gaps: strings(r.design.gaps),
      stayNote: typeof r.design.stayNote === 'string' ? plain(r.design.stayNote) : '',
      problems,
      citedNames,
      grounded: r.result.grounded === true,
      usage: { inputTokens: count(r.result.inputTokens), outputTokens: count(r.result.outputTokens), lookups: Array.isArray(r.result.toolUses) ? r.result.toolUses.length : 0, webSearches: count(r.result.webSearch?.requests) },
    };
  }
  if (r.status === 'done' && r.design === undefined) throw new DesignerError('The Designer is being updated and cannot suggest options yet. Add the options by hand, or try again later.');
  if (r.status === 'done') throw new DesignerError('The Designer gave no draft. Try again.');
  if (r.status === 'empty_model') throw new DesignerError('This model has no committed content yet, so there is nothing to base a draft on.');
  if (r.status === 'not_found') throw new DesignerError('That model could not be found.');
  throw new DesignerError(typeof r.message === 'string' && r.message !== '' ? r.message : 'The Designer could not be reached. Check that it has been deployed, then try again.');
}

/**
 * One newline-delimited line from `design-agent`: a progress event, the final
 * outcome, or an error. The same shapes `ask-model` streams.
 */
export type DesignerLine =
  | { type: 'event'; event: AskEvent }
  | { type: 'result'; outcome: unknown }
  | { type: 'error'; code: DesignerErrorCode; message: string };

/** Pure: an unrecognised or blank line is ignored rather than shown. */
export function parseDesignerLine(line: string): DesignerLine | null {
  if (line.trim() === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type === 'event' && typeof r.event === 'object' && r.event !== null) return { type: 'event', event: r.event as AskEvent };
  if (r.type === 'error' && typeof r.message === 'string') {
    const code: DesignerErrorCode = r.code === 'rate_limited' || r.code === 'provider' ? r.code : 'failed';
    return { type: 'error', code, message: r.message };
  }
  if (r.type === 'result' && typeof r.status === 'string') {
    const outcome = { ...r };
    delete outcome.type;
    return { type: 'result', outcome };
  }
  return null;
}

export interface RunDesignerInput {
  /** Full URL of the function, e.g. `${VITE_SUPABASE_URL}/functions/v1/design-agent`. */
  functionUrl: string;
  accessToken: string;
  modelId: UUID;
  elementId: UUID;
  finding: string;
  /** Progress while the function looks things up. Optional: the draft is the same without it. */
  onEvent?: (event: AskEvent) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** Resolves with the checked draft; throws `DesignerError` for an error line or a refusal. */
export async function runDesigner(input: RunDesignerInput): Promise<DesignerDraft> {
  const doFetch = input.fetchImpl ?? fetch;
  const response = await doFetch(input.functionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify({ modelId: input.modelId, elementId: input.elementId, finding: input.finding }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  // An older function answers one JSON document, and a refusal before the
  // stream starts does too. Both go through the same reader.
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/x-ndjson')) {
    return interpretDesignerReply(await response.json().catch(() => null));
  }
  if (!response.body) throw new DesignerError('The Designer could not be reached. Check that it has been deployed, then try again.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const final: { outcome: unknown; gotResult: boolean } = { outcome: undefined, gotResult: false };
  const handle = (line: string) => {
    const parsed = parseDesignerLine(line);
    if (!parsed) return;
    if (parsed.type === 'event') input.onEvent?.(parsed.event);
    else if (parsed.type === 'error') throw new DesignerError(parsed.message, parsed.code);
    else {
      final.outcome = parsed.outcome;
      final.gotResult = true;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handle(line);
  }
  handle(buffer);
  if (!final.gotResult) throw new DesignerError('The Designer stopped before it finished. Try again.');
  return interpretDesignerReply(final.outcome);
}

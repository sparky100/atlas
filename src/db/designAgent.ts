import type { UUID } from '../contracts/delta';
import type { DesignerOptionDraft } from '../contracts/designerOptions';
import type { Client } from './client';

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
  usage: { inputTokens: number; outputTokens: number; lookups: number };
}

export class DesignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignerError';
  }
}

interface DesignerBody {
  status?: string;
  message?: string;
  design?: { options?: unknown; gaps?: unknown; stayNote?: unknown; problems?: unknown };
  result?: { answer?: string; citations?: string[]; citationNames?: Record<string, string>; grounded?: boolean; inputTokens?: number; outputTokens?: number; toolUses?: unknown[] };
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

/** Pure: the one place the function's reply is read, so the page never shows a raw provider message. */
export function interpretDesignerReply(body: unknown): DesignerDraft {
  const r = (typeof body === 'object' && body !== null ? body : {}) as DesignerBody;
  if (r.status === 'done' && r.design !== undefined && r.result !== undefined) {
    const names = r.result.citationNames ?? {};
    const citedNames = (r.result.citations ?? []).map((id) => names[id]).filter((n): n is string => typeof n === 'string' && n !== '');
    const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => citationsToNames(x, names)) : []);
    const plain = (v: string) => citationsToNames(v, names);
    const options = (Array.isArray(r.design.options) ? r.design.options : []).flatMap((o): DesignerOptionDraft[] => {
      const x = typeof o === 'object' && o !== null ? (o as Record<string, unknown>) : {};
      return typeof x.title === 'string' && typeof x.summary === 'string' ? [{ title: plain(x.title), summary: plain(x.summary), toWeigh: typeof x.toWeigh === 'string' ? plain(x.toWeigh) : '' }] : [];
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
      usage: { inputTokens: count(r.result.inputTokens), outputTokens: count(r.result.outputTokens), lookups: Array.isArray(r.result.toolUses) ? r.result.toolUses.length : 0 },
    };
  }
  if (r.status === 'done' && r.design === undefined) throw new DesignerError('The Designer is being updated and cannot suggest options yet. Add the options by hand, or try again later.');
  if (r.status === 'done') throw new DesignerError('The Designer gave no draft. Try again.');
  if (r.status === 'empty_model') throw new DesignerError('This model has no committed content yet, so there is nothing to base a draft on.');
  if (r.status === 'not_found') throw new DesignerError('That model could not be found.');
  throw new DesignerError(typeof r.message === 'string' && r.message !== '' ? r.message : 'The Designer could not be reached. Check that it has been deployed, then try again.');
}

export async function runDesigner(supabase: Client, input: { modelId: UUID; elementId: UUID; finding: string }, signal?: AbortSignal): Promise<DesignerDraft> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see invites.ts.
  const { data, error } = await supabase.functions.invoke('design-agent', { body: input, ...(signal ? { signal } : {}) });
  if (error) {
    // A refusal (403, 429, 502...) carries the function's own sentence in the response body.
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        return interpretDesignerReply(await context.json());
      } catch (e) {
        if (e instanceof DesignerError) throw e;
      }
    }
    throw new DesignerError('The Designer could not be reached. Check that it has been deployed, then try again.');
  }
  return interpretDesignerReply(data);
}

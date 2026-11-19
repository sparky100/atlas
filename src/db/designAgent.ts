import type { UUID } from '../contracts/delta';
import type { Client } from './client';

/**
 * Phase D step 2b: the browser's side of the `design-agent` edge function.
 * It returns the Designer's draft as text for a person to read and edit. It
 * writes nothing. Any refusal or failure comes back as one plain sentence.
 */
export interface DesignerDraft {
  text: string;
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
  result?: { answer?: string; citations?: string[]; citationNames?: Record<string, string>; grounded?: boolean; inputTokens?: number; outputTokens?: number; toolUses?: unknown[] };
}

/** Pure: the one place the function's reply is read, so the page never shows a raw provider message. */
export function interpretDesignerReply(body: unknown): DesignerDraft {
  const r = (typeof body === 'object' && body !== null ? body : {}) as DesignerBody;
  if (r.status === 'done' && typeof r.result?.answer === 'string' && r.result.answer.trim() !== '') {
    const names = r.result.citationNames ?? {};
    const citedNames = (r.result.citations ?? []).map((id) => names[id]).filter((n): n is string => typeof n === 'string' && n !== '');
    const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);
    return {
      text: r.result.answer.trim(),
      citedNames,
      grounded: r.result.grounded === true,
      usage: { inputTokens: count(r.result.inputTokens), outputTokens: count(r.result.outputTokens), lookups: Array.isArray(r.result.toolUses) ? r.result.toolUses.length : 0 },
    };
  }
  if (r.status === 'done') throw new DesignerError('The Designer gave no draft. Try again.');
  if (r.status === 'empty_model') throw new DesignerError('This model has no committed content yet, so there is nothing to base a draft on.');
  if (r.status === 'not_found') throw new DesignerError('That model could not be found.');
  throw new DesignerError(typeof r.message === 'string' && r.message !== '' ? r.message : 'The Designer could not be reached. Check that it has been deployed, then try again.');
}

export async function runDesigner(supabase: Client, input: { modelId: UUID; elementId: UUID; finding: string }): Promise<DesignerDraft> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see invites.ts.
  const { data, error } = await supabase.functions.invoke('design-agent', { body: input });
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

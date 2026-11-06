/**
 * F15 (ADR-028): the browser's side of the `ask-model` edge function. The
 * function answers as newline-delimited JSON — progress events as lookups
 * run, then one result or error line — so this reads the body as a stream
 * and hands each line to the caller as it arrives. `parseAskLine` is the
 * one place a line is interpreted; an unrecognised line is ignored rather
 * than shown.
 */
import type { UUID } from '../contracts/delta';
import type { AskEvent, AskResult, AskTurn } from '../tools/askLoop';
import type { ToolStamp } from '../tools/types';

export type AskModelOutcome =
  | { status: 'done'; result: AskResult; stamp: ToolStamp }
  | { status: 'disabled' }
  | { status: 'not_found' }
  | { status: 'empty_model' }
  | { status: 'invalid'; message: string };

export type AskErrorCode = 'rate_limited' | 'provider' | 'failed';

export type AskLine = { type: 'event'; event: AskEvent } | { type: 'result'; outcome: AskModelOutcome } | { type: 'error'; code: AskErrorCode; message: string };

export function parseAskLine(line: string): AskLine | null {
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
    const code: AskErrorCode = r.code === 'rate_limited' || r.code === 'provider' ? r.code : 'failed';
    return { type: 'error', code, message: r.message };
  }
  if (r.type === 'result' && typeof r.status === 'string') {
    const outcome = { ...r };
    delete outcome.type;
    return { type: 'result', outcome: outcome as unknown as AskModelOutcome };
  }
  return null;
}

export interface AskModelInput {
  /** Full URL of the function, e.g. `${VITE_SUPABASE_URL}/functions/v1/ask-model`. */
  functionUrl: string;
  accessToken: string;
  modelId: UUID;
  question: string;
  history: readonly AskTurn[];
  onEvent: (event: AskEvent) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** Resolves with the final outcome; throws `AskModelError` for an error line or a failed request. */
export async function askModel(input: AskModelInput): Promise<AskModelOutcome> {
  const doFetch = input.fetchImpl ?? fetch;
  const response = await doFetch(input.functionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify({ modelId: input.modelId, question: input.question, history: input.history }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok || !response.body) {
    throw new AskModelError('failed', `Ask Atlas could not be reached (${String(response.status)}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const final: { outcome: AskModelOutcome | null } = { outcome: null };
  const handle = (line: string) => {
    const parsed = parseAskLine(line);
    if (!parsed) return;
    if (parsed.type === 'event') input.onEvent(parsed.event);
    else if (parsed.type === 'error') throw new AskModelError(parsed.code, parsed.message);
    else final.outcome = parsed.outcome;
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
  if (!final.outcome) throw new AskModelError('failed', 'Ask Atlas stopped before it finished the answer.');
  return final.outcome;
}

export class AskModelError extends Error {
  constructor(
    readonly code: AskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AskModelError';
  }
}

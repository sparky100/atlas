import type { UUID } from '../contracts/delta';
import type { Client } from './client';
import type { ReviewNote } from '../tools/reviewHandler';
import type { ReviewLens } from '../tools/reviewPrompt';

export interface ReviewerReply {
  notes: ReviewNote[];
  inputHash: string;
  runId: string;
  inputTokens: number;
  outputTokens: number;
}

export class ReviewerError extends Error {
  constructor(message: string) { super(message); this.name = 'ReviewerError'; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function interpretReviewerReply(value: unknown): ReviewerReply {
  const body = record(value);
  if (body?.status !== 'done') {
    throw new ReviewerError(typeof body?.message === 'string' && body.message !== '' ? body.message : 'The second opinion could not be completed. Try again.');
  }
  if (!Array.isArray(body.notes) || typeof body.inputHash !== 'string' || typeof body.runId !== 'string' || typeof body.inputTokens !== 'number' || typeof body.outputTokens !== 'number') throw new ReviewerError('The second opinion came back in an unexpected form. Nothing was kept. Try again.');
  const notes: ReviewNote[] = [];
  for (const item of body.notes) {
    const note = record(item);
    const basedOn = record(note?.basedOn);
    if (typeof note?.note !== 'string' || typeof note.question !== 'string' || typeof basedOn?.label !== 'string' || (basedOn.kind !== 'option' && basedOn.kind !== 'element' && basedOn.kind !== 'none')) throw new ReviewerError('The second opinion came back in an unexpected form. Nothing was kept. Try again.');
    notes.push({ note: note.note, question: note.question, basedOn: { kind: basedOn.kind, label: basedOn.label, ...(basedOn.kind === 'option' && typeof basedOn.branchId === 'string' ? { branchId: basedOn.branchId } : {}), ...(basedOn.kind === 'element' && typeof basedOn.elementId === 'string' ? { elementId: basedOn.elementId } : {}) } });
  }
  if (notes.length > 5) throw new ReviewerError('The second opinion came back in an unexpected form. Nothing was kept. Try again.');
  return { notes, inputHash: body.inputHash, runId: body.runId, inputTokens: body.inputTokens, outputTokens: body.outputTokens };
}

export async function runReviewer(supabase: Client, decisionId: UUID, lens: ReviewLens, signal: AbortSignal): Promise<ReviewerReply> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped Supabase function response
  const { data, error } = await supabase.functions.invoke('review-agent', { body: { decisionId, lens }, signal });
  if (error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      try { return interpretReviewerReply(await response.json()); } catch (e) { if (e instanceof ReviewerError) throw e; }
    }
    throw new ReviewerError('The second opinion could not be reached. Check that the reviewer function has been deployed, then try again.');
  }
  return interpretReviewerReply(data);
}

import type { WebResearchCandidate, WebResearchResponse } from '../contracts/webResearch';
import type { UUID } from '../contracts/delta';
import type { Client } from './client';

/** The edge function's own sentence, when it sent one, instead of the generic client message. */
async function errorMessage(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    const body = (await context.json().catch(() => null)) as { message?: unknown } | null;
    if (typeof body?.message === 'string' && body.message !== '') return body.message;
  }
  if (error instanceof Error && error.message !== '') return error.message;
  return null;
}

/**
 * The one call that starts a public-web search. The person's exact query goes
 * to the guarded `research-agent`; this function never talks to the proxy or
 * the provider directly. The response is only candidates: nothing has been
 * saved to the decision yet.
 */
export async function requestWebResearch(
  supabase: Client,
  input: { decisionId: UUID; branchId: UUID; query: string },
): Promise<{ candidates: WebResearchCandidate[]; searchedAt: string }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped Supabase function response
  const { data, error } = await supabase.functions.invoke('research-agent', { body: input });
  if (error) throw new Error((await errorMessage(error)) ?? 'Could not reach the research service. Check that it has been deployed, then try again.');
  const result = data as WebResearchResponse | null;
  if (!result) throw new Error('The research service gave no answer.');
  if (result.status === 'error') throw new Error(result.message);
  return { candidates: result.candidates, searchedAt: result.searchedAt };
}

export interface SaveCheckedWebSourceInput {
  decisionId: UUID;
  branchId: UUID;
  userId: UUID;
  candidate: WebResearchCandidate;
  /** The person's own sentence about what the page supports. */
  assertion: string;
}

/**
 * Saves the page and the person's check together. RLS requires the caller to be
 * a contributor or above on a proposed decision and the option to be linked;
 * `checked_by` must be the caller. The database sets another check time, but a
 * value is sent so the all-or-none check is satisfied before any trigger runs.
 */
export async function saveCheckedWebSource(supabase: Client, input: SaveCheckedWebSourceInput): Promise<void> {
  const assertion = input.assertion.trim();
  if (assertion === '') throw new Error('Say what this page supports before saving it.');
  if (assertion.length > 500) throw new Error('Keep the statement to 500 characters or fewer.');
  const { error } = await supabase.from('option_web_sources').insert({
    decision_id: input.decisionId,
    branch_id: input.branchId,
    url: input.candidate.url,
    title: input.candidate.title,
    publisher: input.candidate.publisher === '' ? null : input.candidate.publisher,
    excerpt: input.candidate.excerpt,
    retrieved_at: input.candidate.retrievedAt,
    cited_by: input.userId,
    assertion,
    checked_by: input.userId,
    checked_at: new Date().toISOString(),
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('This page is already saved with this option. Choose another page.');
    throw new Error(`Could not save this page with the option: ${error.message}`);
  }
}

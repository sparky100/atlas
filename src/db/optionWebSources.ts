import type { OptionWebSource, OptionWebSourceRow } from '../contracts/optionSource';
import type { WebResearchCandidate } from '../contracts/webResearch';
import type { Client } from './client';

/** Pure mapping, so the row shape and the view shape cannot drift without a unit test noticing. */
export function optionWebSourcesFromRows(rows: readonly OptionWebSourceRow[]): OptionWebSource[] {
  return rows.map((row) => ({
    kind: 'web' as const,
    id: `${row.branch_id}\u0000${row.url}`,
    branchId: row.branch_id,
    optionId: row.option_id ?? null,
    url: row.url,
    title: row.title,
    publisher: row.publisher,
    excerpt: row.excerpt,
    retrievedAt: row.retrieved_at,
    citedBy: row.cited_by,
    citedAt: row.cited_at,
    assertion: row.assertion,
    checkedBy: row.checked_by,
    checkedAt: row.checked_at,
  }));
}

export interface InsertOptionWebSourceInput {
  decisionId: string;
  branchId: string;
  candidate: Pick<WebResearchCandidate, 'url' | 'title' | 'publisher' | 'excerpt' | 'retrievedAt'>;
  citedBy: string;
}

/**
 * Saves a page with an option without claiming anyone checked it. The
 * assertion and check stay null, so the app shows it as an unreviewed web
 * page; the person can still open it and add a checked assertion later.
 */
export async function insertOptionWebSource(client: Client, input: InsertOptionWebSourceInput): Promise<void> {
  const { error } = await client.from('option_web_sources').insert({
    decision_id: input.decisionId,
    branch_id: input.branchId,
    url: input.candidate.url,
    title: input.candidate.title,
    publisher: input.candidate.publisher === '' ? null : input.candidate.publisher,
    excerpt: input.candidate.excerpt,
    retrieved_at: input.candidate.retrievedAt,
    cited_by: input.citedBy,
    assertion: null,
    checked_by: null,
    checked_at: null,
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('This page is already saved with this option.');
    throw new Error(`Could not save this page with the option: ${error.message}`);
  }
}

/** Decision-scoped read. RLS decides who can see the decision at all. */
export async function listOptionWebSources(client: Client, decisionId: string): Promise<OptionWebSource[]> {
  const { data, error } = await client
    .from('option_web_sources')
    .select('*')
    .eq('decision_id', decisionId)
    .order('branch_id')
    .order('cited_at');
  if (error) throw new Error(`listOptionWebSources: ${error.message}`);
  return optionWebSourcesFromRows((data as OptionWebSourceRow[] | null) ?? []);
}

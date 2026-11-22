import type { OptionWebSource, OptionWebSourceRow } from '../contracts/optionSource';
import type { Client } from './client';

/** Pure mapping, so the row shape and the view shape cannot drift without a unit test noticing. */
export function optionWebSourcesFromRows(rows: readonly OptionWebSourceRow[]): OptionWebSource[] {
  return rows.map((row) => ({
    kind: 'web' as const,
    id: `${row.branch_id}\u0000${row.url}`,
    branchId: row.branch_id,
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

import type { DecisionGap, RecordDecisionGapInput } from '../contracts/decisionGap';
import { assertRealId } from './assertRealId';
import type { Client } from './client';
import type { DecisionGapRow } from './types';

/** Row to contract: the only place the column names are known. */
export function decisionGapFromRow(row: DecisionGapRow): DecisionGap {
  return {
    id: row.id,
    decisionId: row.decision_id,
    branchId: row.branch_id,
    optionId: row.option_id,
    origin: row.origin,
    body: row.body,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function listDecisionGaps(client: Client, decisionId: string): Promise<DecisionGap[]> {
  assertRealId('listDecisionGaps', 'decision_id', decisionId);
  const { data, error } = await client
    .from('decision_gaps')
    .select('*')
    .eq('decision_id', decisionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listDecisionGaps: ${error.message}`);
  return ((data as DecisionGapRow[] | null) ?? []).map(decisionGapFromRow);
}

export async function recordDecisionGap(client: Client, input: RecordDecisionGapInput): Promise<DecisionGap> {
  assertRealId('recordDecisionGap', 'decision_id', input.decisionId);
  if (input.branchId !== null) assertRealId('recordDecisionGap', 'branch_id', input.branchId);
  if (input.optionId != null) assertRealId('recordDecisionGap', 'option_id', input.optionId);
  const row = {
    id: crypto.randomUUID(),
    decision_id: input.decisionId,
    branch_id: input.branchId,
    ...(input.optionId != null ? { option_id: input.optionId } : {}),
    origin: input.origin,
    body: input.body.trim(),
    created_by: input.userId,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await client.from('decision_gaps').insert(row).select('*').single();
  if (error) throw new Error(`recordDecisionGap: ${error.message}`);
  return decisionGapFromRow(data as DecisionGapRow);
}

export async function deleteDecisionGap(client: Client, id: string): Promise<void> {
  assertRealId('deleteDecisionGap', 'gap_id', id);
  const { error } = await client.from('decision_gaps').delete().eq('id', id);
  if (error) throw new Error(`deleteDecisionGap: ${error.message}`);
}

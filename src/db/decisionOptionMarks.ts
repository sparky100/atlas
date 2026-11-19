import type { DecisionOptionMark } from '../contracts/decisionOptionMark';
import type { UUID } from '../contracts/delta';
import type { Client } from './client';
import { assertRealId } from './assertRealId';
import type { DecisionOptionMarkRow } from './types';

/** Row to contract and back: the only place the column names are known. */
export function markFromRow(row: DecisionOptionMarkRow): DecisionOptionMark {
  return { decisionId: row.decision_id, branchId: row.branch_id, agent: row.agent, draftedAt: row.drafted_at, draftRunId: row.draft_run_id, suggestedTitle: row.suggested_title, suggestedSummary: row.suggested_summary, editedBy: row.edited_by, editedAt: row.edited_at };
}

export async function insertOptionMark(supabase: Client, input: DecisionOptionMark & { createdBy: UUID }): Promise<DecisionOptionMark> {
  assertRealId('insertOptionMark', 'decision_id', input.decisionId);
  assertRealId('insertOptionMark', 'branch_id', input.branchId);
  const row = {
    decision_id: input.decisionId,
    branch_id: input.branchId,
    agent: input.agent,
    drafted_at: input.draftedAt,
    draft_run_id: input.draftRunId,
    suggested_title: input.suggestedTitle,
    suggested_summary: input.suggestedSummary,
    edited_by: null,
    edited_at: null,
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('decision_option_marks').insert(row).select('*').single();
  if (error) throw new Error(`insertOptionMark: ${error.message}`);
  return markFromRow(data as DecisionOptionMarkRow);
}

/** Records the person who changed an agent-suggested option. Only these two columns can change. */
export async function markOptionEdited(supabase: Client, input: { decisionId: UUID; branchId: UUID; editedBy: UUID; editedAt: string }): Promise<DecisionOptionMark> {
  assertRealId('markOptionEdited', 'decision_id', input.decisionId);
  assertRealId('markOptionEdited', 'branch_id', input.branchId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('decision_option_marks').update({ edited_by: input.editedBy, edited_at: input.editedAt }).eq('decision_id', input.decisionId).eq('branch_id', input.branchId).select('*').single();
  if (error) throw new Error(`markOptionEdited: ${error.message}`);
  return markFromRow(data as DecisionOptionMarkRow);
}

export async function listOptionMarksForDecision(supabase: Client, decisionId: UUID): Promise<DecisionOptionMark[]> {
  assertRealId('listOptionMarksForDecision', 'decision_id', decisionId);
  const { data, error } = await supabase.from('decision_option_marks').select('*').eq('decision_id', decisionId);
  if (error) throw new Error(`listOptionMarksForDecision: ${error.message}`);
  return (data as DecisionOptionMarkRow[]).map(markFromRow);
}

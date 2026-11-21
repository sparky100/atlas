/**
 * D2 PR 4: keeping an AI reviewer's question on a decision. Insert-only; the
 * table has no update or delete policy or grant.
 */
import type { DecisionAgentNote, KeepDecisionAgentNoteInput } from '../contracts/decisionAgentNote';
import { agentForLens } from '../contracts/decisionAgentNote';
import type { UUID } from '../contracts/delta';
import type { Client } from './client';
import { assertRealId } from './assertRealId';
import type { DecisionAgentNoteRow } from './types';

/** Row to contract and back: the only place the column names are known. */
export function noteFromRow(row: DecisionAgentNoteRow): DecisionAgentNote {
  return {
    id: row.id,
    decisionId: row.decision_id,
    branchId: row.branch_id,
    lens: row.lens,
    agent: row.agent,
    suggestedQuestion: row.suggested_question,
    question: row.question,
    basedOn: row.based_on,
    basedOnLabel: row.based_on_label,
    inputHash: row.input_hash,
    runId: row.run_id,
    keptBy: row.kept_by,
    keptAt: row.kept_at,
  };
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function keepDecisionAgentNote(supabase: Client, input: KeepDecisionAgentNoteInput): Promise<DecisionAgentNote> {
  assertRealId('keepDecisionAgentNote', 'decision_id', input.decisionId);
  if (input.branchId !== null) assertRealId('keepDecisionAgentNote', 'branch_id', input.branchId);
  // The column is a uuid; a run id from a dev/stub server may not be one. Store null rather than fail the keep.
  const runId = input.runId !== null && UUID_SHAPE.test(input.runId) ? input.runId : null;
  const row = {
    id: crypto.randomUUID(),
    decision_id: input.decisionId,
    branch_id: input.branchId,
    lens: input.lens,
    agent: agentForLens(input.lens),
    suggested_question: input.suggestedQuestion,
    question: input.question,
    based_on: input.basedOn,
    based_on_label: input.basedOnLabel,
    input_hash: input.inputHash,
    run_id: runId,
    kept_by: input.keptBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('decision_agent_notes').insert(row).select('*').single();
  if (error) throw new Error(`keepDecisionAgentNote: ${error.message}`);
  return noteFromRow(data as DecisionAgentNoteRow);
}

export async function listDecisionAgentNotes(supabase: Client, decisionId: UUID): Promise<DecisionAgentNote[]> {
  assertRealId('listDecisionAgentNotes', 'decision_id', decisionId);
  const { data, error } = await supabase.from('decision_agent_notes').select('*').eq('decision_id', decisionId).order('kept_at', { ascending: true });
  if (error) throw new Error(`listDecisionAgentNotes: ${error.message}`);
  return (data as DecisionAgentNoteRow[]).map(noteFromRow);
}

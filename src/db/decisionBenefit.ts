import type { UUID } from '../contracts/delta';
import type { Client } from './client';
import { assertRealId } from './assertRealId';
import type { DecisionBenefitCheckRow, DecisionBenefitResult } from './types';

/**
 * "Did we get the outcome?" (item 3, part 2): once a decision's chosen option
 * is in the live model, an owner or architect records Yes, Partly or Not yet,
 * with a note and the member who confirmed it. Insert-only
 * (`decision_benefit_checks`): the database sets who recorded it and when,
 * checks the option is in the live model and the confirmer is a member, and
 * refuses everyone but owners and architects.
 */
export interface RecordDecisionBenefitInput {
  decisionId: UUID;
  result: DecisionBenefitResult;
  note: string;
  confirmedBy: UUID;
}

export async function recordDecisionBenefit(supabase: Client, input: RecordDecisionBenefitInput): Promise<DecisionBenefitCheckRow> {
  assertRealId('recordDecisionBenefit', 'decision_id', input.decisionId);
  // org_id, recorded_by and recorded_at are set by the database from the decision and the session, never sent.
  const row = { decision_id: input.decisionId, result: input.result, note: input.note.trim(), confirmed_by: input.confirmedBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('decision_benefit_checks').insert(row).select('*').single();
  if (error) throw new Error(`recordDecisionBenefit: ${error.message}`);
  return data as DecisionBenefitCheckRow;
}

/** Every check on a decision, newest first: the first is the answer shown. */
export async function listDecisionBenefitChecks(supabase: Client, decisionId: UUID): Promise<DecisionBenefitCheckRow[]> {
  assertRealId('listDecisionBenefitChecks', 'decision_id', decisionId);
  const { data, error } = await supabase.from('decision_benefit_checks').select('*').eq('decision_id', decisionId).order('recorded_at', { ascending: false });
  if (error) throw new Error(`listDecisionBenefitChecks: ${error.message}`);
  return data as DecisionBenefitCheckRow[];
}

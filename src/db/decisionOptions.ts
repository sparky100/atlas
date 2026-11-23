import type { UUID } from '../contracts/delta';
import { assertRealId } from './assertRealId';
import type { Client } from './client';
import type { BranchRow, DecisionOptionRow } from './types';

/**
 * A decision's candidate options, in display order. `decision_options` is the
 * stable identity from D1 stage 1; legacy branch options still have a
 * `branch_id` so the comparison and change views can keep using the branch.
 */
export async function listDecisionOptions(client: Client, decisionId: UUID): Promise<DecisionOptionRow[]> {
  assertRealId('listDecisionOptions', 'decision_id', decisionId);
  const { data, error } = await client
    .from('decision_options')
    .select('*')
    .eq('decision_id', decisionId)
    .order('position')
    .order('created_at');
  if (error) throw new Error(`listDecisionOptions: ${error.message}`);
  return (data as DecisionOptionRow[] | null) ?? [];
}

export interface CreateDecisionOptionInput {
  decisionId: UUID;
  title: string;
  summary?: string;
  createdBy: UUID;
}

/**
 * A candidate, with no delivery branch. The branch is created later by
 * `workOnDecisionOption`, so adding an option no longer appears in the
 * Changes list or reserves a branch name.
 */
export async function createDecisionOption(client: Client, input: CreateDecisionOptionInput): Promise<DecisionOptionRow> {
  assertRealId('createDecisionOption', 'decision_id', input.decisionId);
  assertRealId('createDecisionOption', 'created_by', input.createdBy);
  const title = input.title.trim();
  if (title.length === 0) throw new Error('createDecisionOption: a title is required');
  const existing = await listDecisionOptions(client, input.decisionId);
  const position = existing.reduce((max, option) => Math.max(max, option.position), 0) + 1;
  const row = {
    decision_id: input.decisionId,
    branch_id: null,
    title,
    summary: input.summary?.trim() ?? '',
    position,
    created_by: input.createdBy,
    updated_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await client.from('decision_options').insert(row).select('*').single();
  if (error) throw new Error(`createDecisionOption: ${error.message}`);
  return data as DecisionOptionRow;
}

/**
 * Creates and attaches the delivery branch for a candidate. The database
 * function is idempotent: calling it again returns the already-attached
 * branch. The page refreshes the option, link and branch from the database
 * afterwards, rather than inventing a link row locally.
 */
export async function workOnDecisionOption(client: Client, optionId: UUID): Promise<BranchRow> {
  assertRealId('workOnDecisionOption', 'option_id', optionId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await client.schema('atlas').rpc('work_on_decision_option', { p_option_id: optionId });
  if (error) throw new Error(`workOnDecisionOption: ${error.message}`);
  return data as BranchRow;
}

/** The option a legacy branch belongs to, or null while the compatibility link has not been written. */
export async function getDecisionOptionForBranch(client: Client, decisionId: UUID, branchId: UUID): Promise<DecisionOptionRow | null> {
  assertRealId('getDecisionOptionForBranch', 'decision_id', decisionId);
  assertRealId('getDecisionOptionForBranch', 'branch_id', branchId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await client
    .from('decision_options')
    .select('*')
    .eq('decision_id', decisionId)
    .eq('branch_id', branchId)
    .maybeSingle();
  if (error) throw new Error(`getDecisionOptionForBranch: ${error.message}`);
  return (data as DecisionOptionRow | null) ?? null;
}

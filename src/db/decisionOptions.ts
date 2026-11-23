import type { UUID } from '../contracts/delta';
import { assertRealId } from './assertRealId';
import type { Client } from './client';
import type { DecisionOptionRow } from './types';

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

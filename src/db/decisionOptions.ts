import type { UUID } from '../contracts/delta';
import { isOptionApproach, type OptionApproach } from '../contracts/optionApproach';
import { assertRealId } from './assertRealId';
import type { Client } from './client';
import { listDecisionsForModel } from './decisions';
import { listDecisionsForProject } from './projects';
import { selectAll } from './selectAll';
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

const OPTION_DECISION_CHUNK = 50;

async function listDecisionOptionsForDecisions(client: Client, decisionIds: readonly UUID[]): Promise<DecisionOptionRow[]> {
  const rows: DecisionOptionRow[] = [];
  for (let offset = 0; offset < decisionIds.length; offset += OPTION_DECISION_CHUNK) {
    const chunk = decisionIds.slice(offset, offset + OPTION_DECISION_CHUNK);
    rows.push(...(await selectAll<DecisionOptionRow>(
      client
        .from('decision_options')
        .select('*', { count: 'exact' })
        .in('decision_id', chunk)
        .order('position'),
    )));
  }
  return rows;
}

/** Every candidate of the model's decisions, branchless ones included. */
export async function listDecisionOptionsForModel(client: Client, modelId: UUID): Promise<DecisionOptionRow[]> {
  assertRealId('listDecisionOptionsForModel', 'model_id', modelId);
  const decisions = await listDecisionsForModel(client, modelId);
  return listDecisionOptionsForDecisions(client, decisions.map((decision) => decision.id));
}

/** Every candidate of the decisions in this project, branchless ones included. */
export async function listDecisionOptionsForProject(client: Client, projectId: UUID): Promise<DecisionOptionRow[]> {
  assertRealId('listDecisionOptionsForProject', 'project_id', projectId);
  const decisions = await listDecisionsForProject(client, projectId);
  return listDecisionOptionsForDecisions(client, decisions.map((decision) => decision.id));
}

export interface CreateDecisionOptionInput {
  decisionId: UUID;
  title: string;
  summary?: string;
  /** Keep, Configure, Buy, Build, or No change for the baseline; omitted or null = not decided yet. */
  approach?: OptionApproach | null;
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
    approach: input.approach ?? null,
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

/**
 * Sets what kind of option this is. Only the approach and the audit columns
 * change: the title, wording, branch and provenance stay as they are. RLS
 * allows it while the decision is proposed, for owners, architects and
 * contributors.
 */
export async function setDecisionOptionApproach(client: Client, optionId: UUID, approach: OptionApproach | null, userId: UUID): Promise<DecisionOptionRow> {
  assertRealId('setDecisionOptionApproach', 'option_id', optionId);
  assertRealId('setDecisionOptionApproach', 'updated_by', userId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await client
    .from('decision_options')
    .update({ approach, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', optionId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`setDecisionOptionApproach: ${error.message}`);
  if (data === null) throw new Error('setDecisionOptionApproach: this option cannot be changed now (the decision may be closed, or you may not have permission).');
  return data as DecisionOptionRow;
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

/**
 * What kind of option a change belongs to, read from the option that owns the
 * branch (a branch belongs to at most one option). `null` when the branch is
 * not an option, or the option's approach is not decided yet.
 */
export async function getOptionApproachForBranch(client: Client, branchId: UUID): Promise<OptionApproach | null> {
  assertRealId('getOptionApproachForBranch', 'branch_id', branchId);
  const { data, error } = await client
    .from('decision_options')
    .select('approach')
    .eq('branch_id', branchId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getOptionApproachForBranch: ${error.message}`);
  const value: unknown = (data as { approach?: unknown } | null)?.approach;
  return isOptionApproach(value) ? value : null;
}

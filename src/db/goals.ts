/**
 * Goal repository operations (ADR-035, `docs/ADR-035-goals.md`,
 * `supabase/migrations/20261117200000_goals.sql`). Thin, typed wrappers over
 * `goals`/`goal_capabilities`. The rules (who may write, retire not delete,
 * only a capability from the goal's own model, links only while the goal is
 * active) live in the database; nothing here re-checks them.
 */
import { assertRealId } from './assertRealId';
import type { Client } from './client';
import { selectAll } from './selectAll';
import type { GoalCapabilityRow, GoalRow, GoalStatus } from '../contracts/goals';
import type { UUID } from '../contracts/delta';

export interface CreateGoalInput {
  /** Minted by the caller (S-1) — never generated here. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  title: string;
  statement: string;
  whyNow: string;
  createdBy: UUID;
}

export async function createGoal(supabase: Client, input: CreateGoalInput): Promise<GoalRow> {
  const row = { id: input.id, org_id: input.orgId, model_id: input.modelId, title: input.title, statement: input.statement, why_now: input.whyNow, created_by: input.createdBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('goals').insert(row).select('*').single();
  if (error) throw new Error(`createGoal: ${error.message}`);
  return data as GoalRow;
}

/** Every goal on a model, active first, then by title. */
export async function listGoalsForModel(supabase: Client, modelId: UUID): Promise<GoalRow[]> {
  assertRealId('listGoalsForModel', 'model_id', modelId);
  const { data, error } = await supabase.from('goals').select('*').eq('model_id', modelId).order('status', { ascending: true }).order('title', { ascending: true });
  if (error) throw new Error(`listGoalsForModel: ${error.message}`);
  return data as GoalRow[];
}

export interface UpdateGoalInput {
  title?: string;
  statement?: string;
  whyNow?: string;
  status?: GoalStatus;
}

/**
 * Edits the wording, or retires / reactivates. Only an owner or architect
 * (RLS), and a retired goal's wording is fixed (the guard trigger). A blocked
 * update is a zero-row success under RLS, so `.select('id')` turns it into an
 * error rather than a silent no-op.
 */
export async function updateGoal(supabase: Client, goalId: UUID, patch: UpdateGoalInput): Promise<void> {
  assertRealId('updateGoal', 'id', goalId);
  const columns: Record<string, string> = {};
  if (patch.title !== undefined) columns.title = patch.title;
  if (patch.statement !== undefined) columns.statement = patch.statement;
  if (patch.whyNow !== undefined) columns.why_now = patch.whyNow;
  if (patch.status !== undefined) columns.status = patch.status;
  const { data, error } = await supabase.from('goals').update(columns).eq('id', goalId).select('id');
  if (error) throw new Error(`updateGoal: ${error.message}`);
  if (data.length === 0) throw new Error('updateGoal: not allowed, or no such goal');
}

export async function linkCapabilityToGoal(supabase: Client, input: { goalId: UUID; capabilityId: UUID; createdBy: UUID }): Promise<GoalCapabilityRow> {
  const row = { goal_id: input.goalId, capability_id: input.capabilityId, created_by: input.createdBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('goal_capabilities').insert(row).select('*').single();
  if (error) throw new Error(`linkCapabilityToGoal: ${error.message}`);
  return data as GoalCapabilityRow;
}

/** Takes a link back — only while the goal is active, and only an owner or architect (RLS). */
export async function unlinkCapabilityFromGoal(supabase: Client, goalId: UUID, capabilityId: UUID): Promise<void> {
  assertRealId('unlinkCapabilityFromGoal', 'goal_id', goalId);
  assertRealId('unlinkCapabilityFromGoal', 'capability_id', capabilityId);
  const { data, error } = await supabase.from('goal_capabilities').delete().eq('goal_id', goalId).eq('capability_id', capabilityId).select('goal_id');
  if (error) throw new Error(`unlinkCapabilityFromGoal: ${error.message}`);
  if (data.length === 0) throw new Error('unlinkCapabilityFromGoal: not allowed, or no such link');
}

/**
 * The links for some goals. Not an `.in()` on the goal ids (rule 8: a model
 * can hold more than 50): RLS already limits the rows to the caller's
 * organisations, so this pages through them and keeps the ones for the given goals here.
 */
export async function listGoalLinksForGoals(supabase: Client, goalIds: readonly UUID[]): Promise<GoalCapabilityRow[]> {
  if (goalIds.length === 0) return [];
  const wanted = new Set<string>(goalIds);
  // Ordered by the primary key, which is unique, so paging cannot skip or repeat a row.
  const query = supabase.from('goal_capabilities').select('*', { count: 'exact' }).order('goal_id', { ascending: true }).order('capability_id', { ascending: true });
  const rows = await selectAll<GoalCapabilityRow>(query);
  return rows.filter((row) => wanted.has(row.goal_id));
}

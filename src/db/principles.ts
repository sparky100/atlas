/**
 * Principle repository operations (ADR-034, `docs/ADR-034-principles.md`,
 * `supabase/migrations/20261117100000_principles.sql`). Thin, typed wrappers
 * over `principles`/`decision_principles`. The rules (who may write, retire
 * not delete, a departure needs a reason, only an active principle from the
 * decision's own model) live in the database; nothing here re-checks them.
 */
import { assertRealId } from './assertRealId';
import type { Client } from './client';
import { selectAll } from './selectAll';
import type { DecisionPrincipleRow, PrincipleRow, PrincipleStance, PrincipleStatus } from '../contracts/principles';
import type { UUID } from '../contracts/delta';

export interface CreatePrincipleInput {
  /** Minted by the caller (S-1) — never generated here. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  title: string;
  statement: string;
  why: string;
  createdBy: UUID;
}

export async function createPrinciple(supabase: Client, input: CreatePrincipleInput): Promise<PrincipleRow> {
  const row = { id: input.id, org_id: input.orgId, model_id: input.modelId, title: input.title, statement: input.statement, why: input.why, created_by: input.createdBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('principles').insert(row).select('*').single();
  if (error) throw new Error(`createPrinciple: ${error.message}`);
  return data as PrincipleRow;
}

/** Every principle on a model, active first, then by title. */
export async function listPrinciplesForModel(supabase: Client, modelId: UUID): Promise<PrincipleRow[]> {
  assertRealId('listPrinciplesForModel', 'model_id', modelId);
  const { data, error } = await supabase.from('principles').select('*').eq('model_id', modelId).order('status', { ascending: true }).order('title', { ascending: true });
  if (error) throw new Error(`listPrinciplesForModel: ${error.message}`);
  return data as PrincipleRow[];
}

export interface UpdatePrincipleInput {
  title?: string;
  statement?: string;
  why?: string;
  status?: PrincipleStatus;
}

/**
 * Edits the wording, or retires / reactivates. Only an owner or architect
 * (RLS), and a retired principle's wording is fixed (the guard trigger). A
 * blocked update is a zero-row success under RLS, so `.select('id')` turns it
 * into an error rather than a silent no-op.
 */
export async function updatePrinciple(supabase: Client, principleId: UUID, patch: UpdatePrincipleInput): Promise<void> {
  assertRealId('updatePrinciple', 'id', principleId);
  const columns: Record<string, string> = {};
  if (patch.title !== undefined) columns.title = patch.title;
  if (patch.statement !== undefined) columns.statement = patch.statement;
  if (patch.why !== undefined) columns.why = patch.why;
  if (patch.status !== undefined) columns.status = patch.status;
   
  const { data, error } = await supabase.from('principles').update(columns).eq('id', principleId).select('id');
  if (error) throw new Error(`updatePrinciple: ${error.message}`);
  if (data.length === 0) throw new Error('updatePrinciple: not allowed, or no such principle');
}

export interface LinkPrincipleInput {
  decisionId: UUID;
  principleId: UUID;
  stance: PrincipleStance;
  /** Required (non-blank) when `stance` is `departs`. */
  reason: string;
  createdBy: UUID;
}

export async function linkPrincipleToDecision(supabase: Client, input: LinkPrincipleInput): Promise<DecisionPrincipleRow> {
  const row = { decision_id: input.decisionId, principle_id: input.principleId, stance: input.stance, reason: input.reason, created_by: input.createdBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('decision_principles').insert(row).select('*').single();
  if (error) throw new Error(`linkPrincipleToDecision: ${error.message}`);
  return data as DecisionPrincipleRow;
}

/** Takes a mistaken link back — only while the decision is still proposed (RLS). */
export async function unlinkPrincipleFromDecision(supabase: Client, decisionId: UUID, principleId: UUID): Promise<void> {
  assertRealId('unlinkPrincipleFromDecision', 'decision_id', decisionId);
  assertRealId('unlinkPrincipleFromDecision', 'principle_id', principleId);
   
  const { data, error } = await supabase.from('decision_principles').delete().eq('decision_id', decisionId).eq('principle_id', principleId).select('decision_id');
  if (error) throw new Error(`unlinkPrincipleFromDecision: ${error.message}`);
  if (data.length === 0) throw new Error('unlinkPrincipleFromDecision: not allowed, or no such link');
}

export async function listPrinciplesForDecision(supabase: Client, decisionId: UUID): Promise<DecisionPrincipleRow[]> {
  assertRealId('listPrinciplesForDecision', 'decision_id', decisionId);
  const { data, error } = await supabase.from('decision_principles').select('*').eq('decision_id', decisionId);
  if (error) throw new Error(`listPrinciplesForDecision: ${error.message}`);
  return data as DecisionPrincipleRow[];
}

/**
 * The links for some principles, for the Principles page's "followed by / departed from" lists.
 * Not an `.in()` on the principle ids (rule 8: a model can hold more than 50): RLS already limits the rows
 * to the caller's organisations, so this pages through them and keeps the ones for the given principles here.
 */
export async function listPrincipleLinksForPrinciples(supabase: Client, principleIds: readonly UUID[]): Promise<DecisionPrincipleRow[]> {
  if (principleIds.length === 0) return [];
  const wanted = new Set<string>(principleIds);
  // Ordered by the primary key, which is unique, so paging cannot skip or repeat a row.
  const query = supabase.from('decision_principles').select('*', { count: 'exact' }).order('decision_id', { ascending: true }).order('principle_id', { ascending: true });
  const rows = await selectAll<DecisionPrincipleRow>(query);
  return rows.filter((row) => wanted.has(row.principle_id));
}

/**
 * Every departure link the caller can read, for the homes' "decisions that depart from a principle" count.
 * Not an `.in()` on decision ids (rule 8): RLS already limits the rows to the caller's organisations, so this pages
 * through the departures and the caller keeps the ones for decisions in the model it is looking at.
 */
export async function listDepartureLinks(supabase: Client): Promise<DecisionPrincipleRow[]> {
  // Ordered by the primary key, which is unique, so paging cannot skip or repeat a row.
  const query = supabase.from('decision_principles').select('*', { count: 'exact' }).eq('stance', 'departs').order('decision_id', { ascending: true }).order('principle_id', { ascending: true });
  return selectAll<DecisionPrincipleRow>(query);
}

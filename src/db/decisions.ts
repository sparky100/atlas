/**
 * Decision repository operations (ADR-013, extended by ADR-022 for prompt
 * pack F3 — see `docs/ADR-022-decisions-schema.md` and
 * `supabase/migrations/20260913110000_decisions.sql`). Thin, typed wrappers
 * over `decisions`/`decision_links`/`decision_arguments` — no business
 * logic beyond what a single-row insert/select needs, same division of
 * labour `branches.ts`'s own module comment draws.
 *
 * `decision_arguments` has no insert wrapper here: it's written only by
 * `atlas.choose_decision_option` (PR5) — `listDecisionArgumentsForDecision`
 * exists so the decision page can render an honestly-empty "Arguments"
 * section until then, not a stub.
 */
import { assertRealId } from './assertRealId';
import type { Client } from './client';
import type { DecisionArgumentRow, DecisionLinkedType, DecisionLinkRow, DecisionRow } from './types';
import type { UUID } from '../contracts/delta';

export interface CreateDecisionInput {
  /** Minted by the caller (S-1) — never generated here, same convention `createChangeBranch` uses. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  title: string;
  /** F3's own "context" — written at creation, before any option exists. */
  statement: string;
  ownerId: UUID;
  neededBy?: string;
  sourceFindingKey?: string;
  lensMapUrl?: string;
  createdBy: UUID;
}

export async function createDecision(supabase: Client, input: CreateDecisionInput): Promise<DecisionRow> {
  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    title: input.title,
    statement: input.statement,
    owner_id: input.ownerId,
    needed_by: input.neededBy ?? null,
    source_finding_key: input.sourceFindingKey ?? null,
    lens_map_url: input.lensMapUrl ?? null,
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('decisions').insert(row).select('*').single();
  if (error) throw new Error(`createDecision: ${error.message}`);
  return data as DecisionRow;
}

export async function getDecision(supabase: Client, decisionId: UUID): Promise<DecisionRow | null> {
  assertRealId('getDecision', 'id', decisionId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('decisions').select('*').eq('id', decisionId).maybeSingle();
  if (error) throw new Error(`getDecision: ${error.message}`);
  return data as DecisionRow | null;
}

/** Every decision on a model, newest-first — the `/decisions` list's own query (mirrors `listChangeBranches`). */
export async function listDecisionsForModel(supabase: Client, modelId: UUID): Promise<DecisionRow[]> {
  assertRealId('listDecisionsForModel', 'model_id', modelId);
  const { data, error } = await supabase.from('decisions').select('*').eq('model_id', modelId).order('created_at', { ascending: false });
  if (error) throw new Error(`listDecisionsForModel: ${error.message}`);
  return data as DecisionRow[];
}

export interface CreateDecisionLinkInput {
  decisionId: UUID;
  linkedType: DecisionLinkedType;
  linkedId: UUID;
  createdBy: UUID;
}

/** Links a decision to whatever it concerns (`element`/`relationship`) or cites (`assumption`/`evidence`) — F3's own "Add an option" (`linked_type: 'branch'`) is PR5, once `explore`-intent branches exist to link. Only legal while the decision is still `proposed` (RLS's own `decision_links_insert` check). */
export async function createDecisionLink(supabase: Client, input: CreateDecisionLinkInput): Promise<DecisionLinkRow> {
  const row = { decision_id: input.decisionId, linked_type: input.linkedType, linked_id: input.linkedId, created_by: input.createdBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('decision_links').insert(row).select('*').single();
  if (error) throw new Error(`createDecisionLink: ${error.message}`);
  return data as DecisionLinkRow;
}

export async function listDecisionLinksForDecision(supabase: Client, decisionId: UUID): Promise<DecisionLinkRow[]> {
  assertRealId('listDecisionLinksForDecision', 'decision_id', decisionId);
  const { data, error } = await supabase.from('decision_links').select('*').eq('decision_id', decisionId);
  if (error) throw new Error(`listDecisionLinksForDecision: ${error.message}`);
  return data as DecisionLinkRow[];
}

/** A decision's own pro/con list — empty until `atlas.choose_decision_option` writes the one reasons row a chosen option gets (`chooseDecisionOption`, below). Queried regardless of whether that's happened yet, so the decision page renders an honestly-empty section, not a hardcoded placeholder. */
export async function listDecisionArgumentsForDecision(supabase: Client, decisionId: UUID): Promise<DecisionArgumentRow[]> {
  assertRealId('listDecisionArgumentsForDecision', 'decision_id', decisionId);
  const { data, error } = await supabase.from('decision_arguments').select('*').eq('decision_id', decisionId).order('created_at', { ascending: true });
  if (error) throw new Error(`listDecisionArgumentsForDecision: ${error.message}`);
  return data as DecisionArgumentRow[];
}

/**
 * F3 PR5's "Choose": `atlas.choose_decision_option`
 * (`20260913120000_choose_decision_option.sql`) — the only writer
 * `decision_arguments` has. Atomically accepts the decision, records
 * `reasons` as the one `decision_arguments` row, flips `chosenBranchId`'s
 * own `intent` to `propose`, and cancels every other `branch`-linked
 * option still in draft. `chosenBranchId` must already be a `branch`-typed
 * link on this decision, `explore`-intent, `draft` — the RPC validates all
 * three itself, this is not re-checked client-side.
 */
export async function chooseDecisionOption(supabase: Client, decisionId: UUID, chosenBranchId: UUID, reasons: string): Promise<DecisionRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('choose_decision_option', { p_decision_id: decisionId, p_chosen_branch_id: chosenBranchId, p_reasons: reasons });
  if (error) throw new Error(`chooseDecisionOption: ${error.message}`);
  return data as DecisionRow;
}

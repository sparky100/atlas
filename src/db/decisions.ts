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
import { selectAll } from './selectAll';
import type { DecisionApprovalLens, DecisionApprovalRow, DecisionApprovalVerdict, DecisionArgumentRow, DecisionPackRow, DecisionLinkedType, DecisionLinkRow, DecisionRow } from './types';
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
  /** ADR-024: start the decision inside this project (its decision log). */
  projectId?: UUID | null;
  /** The agent drafted part of the context (Simon, 2026-11-19: AI help is always indicated). Set at creation only. */
  aiDraft?: { agent: 'designer'; draftedAt: string; edited: boolean };
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
    project_id: input.projectId ?? null,
    ...(input.aiDraft ? { ai_draft_agent: input.aiDraft.agent, ai_drafted_at: input.aiDraft.draftedAt, ai_draft_edited: input.aiDraft.edited } : {}),
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

/** The decision a change is an option of (`decision_links` 'branch' pointing at it), or null when the change doesn't belong to one — used to show where a change came from. */
export async function getDecisionForOption(supabase: Client, branchId: UUID): Promise<{ id: UUID; title: string } | null> {
  assertRealId('getDecisionForOption', 'linked_id', branchId);
  const { data: link, error } = await supabase.from('decision_links').select('decision_id').eq('linked_type', 'branch').eq('linked_id', branchId).limit(1).maybeSingle();
  if (error) throw new Error(`getDecisionForOption: ${error.message}`);
  if (!link) return null;
  const decision = await getDecision(supabase, link.decision_id as UUID);
  return decision ? { id: decision.id, title: decision.title } : null;
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

/** One element an open decision names as something it concerns (`decision_links.linked_type = 'element'`). */
export interface OpenDecisionElementLink {
  decisionId: UUID;
  elementId: UUID;
}

/**
 * Every element link of the model's still-open (`proposed`) decisions,
 * through one inner embed on `decisions.model_id` — no id list (CLAUDE.md
 * rule 8), the same shape as `listOpenProjectScopeForModel`
 * (`healthFindings.ts`). Overview's weak tiles read it to say which open
 * decision is already addressing a capability (UI-principles §3,
 * 2026-10-04).
 */
export async function listOpenDecisionElementLinksForModel(supabase: Client, modelId: UUID): Promise<OpenDecisionElementLink[]> {
  assertRealId('listOpenDecisionElementLinksForModel', 'model_id', modelId);
  interface EmbeddedDecision { id: UUID; status: string }
  // A many-to-one embed returns one object at runtime; postgrest-js's
  // inference types it as an array, so accept either.
  const rows = await selectAll<{ decision_id: UUID; linked_id: UUID; decisions: EmbeddedDecision | EmbeddedDecision[] }>(
    supabase
      .from('decision_links')
      .select('decision_id, linked_id, linked_type, decisions!inner(id, status, model_id)', { count: 'exact' })
      .eq('linked_type', 'element')
      .eq('decisions.model_id', modelId)
      .eq('decisions.status', 'proposed')
      .order('decision_id')
      .order('linked_id'),
  );
  return rows.flatMap((r) => {
    const decision = Array.isArray(r.decisions) ? r.decisions[0] : r.decisions;
    if (decision?.status !== 'proposed') return [];
    return [{ decisionId: r.decision_id, elementId: r.linked_id }];
  });
}

/** One option change a decision offers (`decision_links.linked_type = 'branch'`). */
export interface DecisionOptionLink {
  decisionId: UUID;
  branchId: UUID;
}

/**
 * Every option link of the model's decisions, whatever their status, through
 * one inner embed on `decisions.model_id` — no id list (CLAUDE.md rule 8).
 * Home's "My work" reads it to tell a decision's option changes (shown under
 * the decision) from a change that stands alone.
 */
export async function listDecisionOptionLinksForModel(supabase: Client, modelId: UUID): Promise<DecisionOptionLink[]> {
  assertRealId('listDecisionOptionLinksForModel', 'model_id', modelId);
  const rows = await selectAll<{ decision_id: UUID; linked_id: UUID }>(
    supabase
      .from('decision_links')
      .select('decision_id, linked_id, linked_type, decisions!inner(id, model_id)', { count: 'exact' })
      .eq('linked_type', 'branch')
      .eq('decisions.model_id', modelId)
      .order('decision_id')
      .order('linked_id'),
  );
  return rows.map((r) => ({ decisionId: r.decision_id, branchId: r.linked_id }));
}

/**
 * F3 PR6's "why is this here": every decision that names one of the given
 * elements as something it concerns (`linked_type='element'`). `elementIds`
 * is the element itself plus, for a capability, its own capability
 * ancestors (`useElementDecisions.ts`'s own caller builds that list) — a
 * chain capped at three levels (SPEC's own L1/L2/L3 ceiling), never a list
 * that grows with model size, so this doesn't need `assertInFilterSize`
 * (SPEC §6.7's own guard is for a caller-supplied id list that scales with
 * the model, not a small fixed structural chain like this one).
 */
export interface ElementDecisionLink {
  decision: DecisionRow;
  /** Which of `elementIds` this decision actually names — the element itself, or one of its capability ancestors. */
  linkedElementId: UUID;
}

export async function listDecisionsLinkingElements(supabase: Client, elementIds: readonly UUID[]): Promise<ElementDecisionLink[]> {
  if (elementIds.length === 0) return [];
  // Two plain queries rather than a postgrest embed: `decision_links` is a
  // polymorphic link (SPEC §3.8) — `linked_id` has no FK to embed through
  // at all, and even `decision_id`'s own real FK to `decisions(id)` isn't
  // worth an embed here given this untyped client (see branches.ts's own
  // module comment) infers an embedded one-to-one as an array without a
  // schema to disambiguate it against. `decisionIds` is bounded by however
  // many links matched `elementIds` itself (already capped at 3) — never a
  // list that scales with model size.
  const { data: links, error: linksError } = await supabase.from('decision_links').select('decision_id, linked_id').eq('linked_type', 'element').in('linked_id', elementIds);
  if (linksError) throw new Error(`listDecisionsLinkingElements: ${linksError.message}`);
  const linkRows = links as { decision_id: UUID; linked_id: UUID }[];
  if (linkRows.length === 0) return [];
  const decisionIds = [...new Set(linkRows.map((l) => l.decision_id))];
  const decisions = await Promise.all(decisionIds.map((id) => getDecision(supabase, id)));
  const decisionsById = new Map(decisions.filter((d): d is DecisionRow => d !== null).map((d) => [d.id, d]));
  // One entry per decision, not per matching link row — a decision linked
  // to two of `elementIds` at once (e.g. a capability and its own parent,
  // both named) would otherwise appear twice for the same decision.
  // `linkedElementId` keeps whichever match came first; nothing downstream
  // needs more than one representative id per decision.
  const seen = new Set<UUID>();
  const result: ElementDecisionLink[] = [];
  for (const link of linkRows) {
    const decision = decisionsById.get((link as { decision_id: UUID }).decision_id);
    if (!decision || seen.has(decision.id)) continue;
    seen.add(decision.id);
    result.push({ decision, linkedElementId: link.linked_id });
  }
  return result;
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
export async function chooseDecisionOption(supabase: Client, decisionId: UUID, chosenBranchId: UUID, reasons: string, reconsider?: { reconsiderIf?: string; reviewBy?: string }): Promise<DecisionRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('choose_decision_option', { p_decision_id: decisionId, p_chosen_branch_id: chosenBranchId, p_reasons: reasons, p_reconsider_if: reconsider?.reconsiderIf ?? null, p_review_by: reconsider?.reviewBy ?? null });
  if (error) throw new Error(`chooseDecisionOption: ${error.message}`);
  return data as DecisionRow;
}

/**
 * Cancel a proposed decision: `atlas.cancel_decision`
 * (`20261005010000_cancel_decision.sql`). Atomically sets it `rejected`
 * (shown as "Cancelled") with the reason and who/when, and cancels every
 * option still in draft. Only the decision's own owner or an org
 * owner/architect, and only while proposed — the RPC checks both.
 */
export async function cancelDecision(supabase: Client, decisionId: UUID, reason: string): Promise<DecisionRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('cancel_decision', { p_decision_id: decisionId, p_reason: reason });
  if (error) throw new Error(`cancelDecision: ${error.message}`);
  return data as DecisionRow;
}

export interface UpdateDecisionInput {
  title?: string;
  /** The decision's context. */
  statement?: string;
  ownerId?: UUID;
  neededBy?: string | null;
  lensMapUrl?: string | null;
  /** The baseline's two plain-text answers ("Stay as we are"). */
  stayRisk?: string;
  stayReason?: string;
  /** Which option branch is the baseline; must already be linked to the decision (a trigger checks). */
  baselineBranchId?: UUID | null;
  /** A person edited an agent-drafted context; only ever set to true. */
  aiDraftEdited?: boolean;
}

/**
 * Edit a proposed decision's own fields — a plain update, the only columns
 * granted for one (`20260913110000_decisions.sql`). RLS lets the decision's
 * creator or an org owner/architect do it, and `atlas.guard_decision_update`
 * refuses once the decision has left `proposed`; both surface here as "no
 * row updated".
 */
export async function updateDecision(supabase: Client, decisionId: UUID, input: UpdateDecisionInput): Promise<DecisionRow> {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.statement !== undefined) patch.statement = input.statement;
  if (input.ownerId !== undefined) patch.owner_id = input.ownerId;
  if (input.neededBy !== undefined) patch.needed_by = input.neededBy;
  if (input.lensMapUrl !== undefined) patch.lens_map_url = input.lensMapUrl;
  if (input.stayRisk !== undefined) patch.stay_risk = input.stayRisk;
  if (input.stayReason !== undefined) patch.stay_reason = input.stayReason;
  if (input.baselineBranchId !== undefined) patch.baseline_branch_id = input.baselineBranchId;
  if (input.aiDraftEdited !== undefined) patch.ai_draft_edited = input.aiDraftEdited;
  const { data, error } = await supabase.from('decisions').update(patch).eq('id', decisionId).select('*');
  if (error) throw new Error(`updateDecision: ${error.message}`);
  const row = (data as DecisionRow[])[0];
  if (!row) throw new Error('updateDecision: this decision can no longer be edited, or you are not allowed to edit it');
  return row;
}

/** How many decisions on a model are still proposed — the Decisions nav item's badge. A count only (`head: true`), no id list (rule 8). */
export async function countProposedDecisions(supabase: Client, modelId: UUID): Promise<number> {
  const { count, error } = await supabase.from('decisions').select('id', { count: 'exact', head: true }).eq('model_id', modelId).eq('status', 'proposed');
  if (error) throw new Error(`countProposedDecisions: ${error.message}`);
  return count ?? 0;
}

/**
 * Freeze the decision's write-up as the next numbered pack
 * (`decision_packs`, `20261119140000_decision_packs.sql`). Insert-only: RLS lets
 * only owners and architects insert, and a trigger sets the org, version, status
 * and who froze it from the decision itself, never from the caller.
 */
export async function freezeDecisionPack(supabase: Client, decisionId: UUID, bodyMarkdown: string, commitId: UUID | null): Promise<DecisionPackRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('decision_packs').insert({ decision_id: decisionId, body_markdown: bodyMarkdown, commit_id: commitId }).select('*').single();
  if (error) throw new Error(`freezeDecisionPack: ${error.message}`);
  return data as DecisionPackRow;
}

/** Every frozen pack of a decision, newest version first. */
export async function listDecisionPacks(supabase: Client, decisionId: UUID): Promise<DecisionPackRow[]> {
  assertRealId('listDecisionPacks', 'decision_id', decisionId);
  const { data, error } = await supabase.from('decision_packs').select('*').eq('decision_id', decisionId).order('version', { ascending: false });
  if (error) throw new Error(`listDecisionPacks: ${error.message}`);
  return data as DecisionPackRow[];
}

/**
 * Record one person's verdict on one exact frozen pack, as one lens
 * (`decision_approvals`, `20261119190000_decision_approvals.sql`). Insert-only.
 * The database refuses a pack that is not the latest version, the person who
 * froze it signing it, and the same lens signed twice by one person.
 */
export async function recordDecisionApproval(supabase: Client, input: { packId: UUID; lens: DecisionApprovalLens; verdict: DecisionApprovalVerdict; comment?: string }): Promise<DecisionApprovalRow> {
  assertRealId('recordDecisionApproval', 'pack_id', input.packId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('decision_approvals').insert({ pack_id: input.packId, lens: input.lens, verdict: input.verdict, comment: input.comment ?? '' }).select('*').single();
  if (error) throw new Error(`recordDecisionApproval: ${error.message}`);
  return data as DecisionApprovalRow;
}

/** Every sign-off on a decision's packs, newest first. */
export async function listDecisionApprovals(supabase: Client, decisionId: UUID): Promise<DecisionApprovalRow[]> {
  assertRealId('listDecisionApprovals', 'decision_id', decisionId);
  const { data, error } = await supabase.from('decision_approvals').select('*').eq('decision_id', decisionId).order('decided_at', { ascending: false });
  if (error) throw new Error(`listDecisionApprovals: ${error.message}`);
  return data as DecisionApprovalRow[];
}

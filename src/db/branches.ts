/**
 * Branch repository operations. Thin, typed wrappers over `branches` —
 * no business logic beyond what a single-row insert/select needs; the
 * interesting logic (fork validity, three-way diff) is src/engine/branch.ts,
 * which these functions hand real ids to.
 *
 * The Supabase client here is untyped (no generated `Database` schema —
 * SPEC-data-model.md doesn't mandate one, and regenerating it on every
 * migration is a reasonable future improvement, not this sprint's scope).
 * That means `data`/`error` come back loosely typed from postgrest-js, and
 * every function below asserts the real row shape explicitly at its one
 * return point rather than threading an unsafe `any` further — the
 * `eslint-disable` comments mark exactly that boundary, nowhere else.
 */
import { assertRealId } from './assertRealId';
import type { Client } from './client';
import { assertInFilterSize } from './inFilterLimit';
import type { BranchIntent, BranchRow } from './types';
import type { UUID } from '../contracts/delta';

export interface CreateChangeBranchInput {
  /** Minted by the caller (S-1) — never generated here, so this function stays deterministic given its inputs. Use `crypto.randomUUID()` at the call site. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  name: string;
  title?: string;
  /** Free-text description of the change (SPEC §3.4) — the "create change" form's second field. */
  description?: string;
  /** The intended delivery date, shown on the change page and roadmap (SPEC §3.4). ISO `date` string (`YYYY-MM-DD`). */
  targetDate?: string;
  createdBy: UUID;
  /** The main branch's current head — becomes both `base_commit_id` and `head_commit_id` (SPEC §3.4: a fresh branch starts with head equal to base). */
  mainHeadCommitId: UUID;
  /** Prompt pack F0: required for every change branch — see `BranchIntent`'s own doc comment. */
  intent: BranchIntent;
  /** ADR-024: the project this change belongs to. An option created from a decision must carry the decision's own project (P1). */
  projectId?: UUID | null;
}

export async function createChangeBranch(supabase: Client, input: CreateChangeBranchInput): Promise<BranchRow> {
  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    name: input.name,
    kind: 'change' as const,
    status: 'draft' as const,
    base_commit_id: input.mainHeadCommitId,
    head_commit_id: input.mainHeadCommitId,
    title: input.title ?? null,
    description: input.description ?? null,
    target_date: input.targetDate ?? null,
    created_by: input.createdBy,
    intent: input.intent,
    project_id: input.projectId ?? null,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('branches').insert(row).select('*').single();
  if (error) {
    // `branches_model_id_name_key` (23505, the same code `invites.ts`'s own
    // createInvite checks for a different conflict) — a name collision
    // within this model, not a real failure. The raw Postgres message
    // ("duplicate key value violates unique constraint ...") is exactly
    // the kind of thing a user reported as unhelpful; this is the one
    // constraint violation this insert can realistically hit from normal
    // use, so it's worth naming specifically rather than only ever
    // surfacing `error.message` verbatim.
    if (error.code === '23505') throw new Error(`A change named "${input.name}" already exists in this model — pick a different name.`);
    throw new Error(`createChangeBranch: ${error.message}`);
  }
  return data as BranchRow;
}

/**
 * S1 item 4: "Cancel a change" — `atlas.cancel_change` (proposer or
 * owner/architect, Draft or Proposed; requires a reason; closes any open
 * merge request too — see that migration's own comment).
 */
export async function cancelChange(supabase: Client, branchId: UUID, reason: string): Promise<BranchRow> {
  assertRealId('cancelChange', 'id', branchId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('cancel_change', { p_branch_id: branchId, p_reason: reason });
  if (error) throw new Error(`cancelChange: ${error.message}`);
  return data as BranchRow;
}

export async function getBranch(supabase: Client, branchId: UUID): Promise<BranchRow | null> {
  assertRealId('getBranch', 'id', branchId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('branches').select('*').eq('id', branchId).maybeSingle();
  if (error) throw new Error(`getBranch: ${error.message}`);
  return data as BranchRow | null;
}

/**
 * F7 item 4: `branches_select` is member-scoped only (SPEC §9.5) — a
 * shared-with org member holding an *unpinned* `model_shares` grant has no
 * RLS path to this row at all, even though `models_select`/`commits_select`
 * already let them read everything downstream of its head commit. The
 * fallback below is the one, narrow exception: `atlas.get_shared_main_branch`
 * (`20260916040000_shared_model_access_fixes.sql`) returns this same real
 * row, gated on holding a genuinely unpinned share — never a tag-pinned
 * one, which must never see main's live head move out from under the
 * version it pinned. Only tried once the plain RLS-gated read already came
 * back empty, so an ordinary member's read path is unchanged.
 */
export async function getMainBranch(supabase: Client, modelId: UUID): Promise<BranchRow | null> {
  assertRealId('getMainBranch', 'model_id', modelId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('branches').select('*').eq('model_id', modelId).eq('kind', 'main').maybeSingle();
  if (error) throw new Error(`getMainBranch: ${error.message}`);
  if (data) return data as BranchRow;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data: sharedRows, error: sharedError } = await supabase.schema('atlas').rpc('get_shared_main_branch', { p_model_id: modelId });
  if (sharedError) throw new Error(`getMainBranch (shared): ${sharedError.message}`);
  const rows = sharedRows as BranchRow[] | null;
  return rows?.[0] ?? null;
}

export async function listBranchesForModel(supabase: Client, modelId: UUID): Promise<BranchRow[]> {
  assertRealId('listBranchesForModel', 'model_id', modelId);
  const { data, error } = await supabase.from('branches').select('*').eq('model_id', modelId);
  if (error) throw new Error(`listBranchesForModel: ${error.message}`);
  return data as BranchRow[];
}

/**
 * Every branch named by `ids` — the "on change: <name>" tag's own lookup
 * (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s 6b: `comments.branch_id`
 * is display metadata, resolved to a name wherever a thread renders).
 * Bounded by construction, not by page size — the distinct `branch_id`s
 * across the threads on one anchor, which is always small — but goes
 * through the same rule 8 ceiling every other batch id lookup does
 * (`listProfilesByIds`'s own precedent) rather than assuming that.
 */
export async function listBranchesByIds(supabase: Client, ids: readonly UUID[]): Promise<BranchRow[]> {
  if (ids.length === 0) return [];
  assertInFilterSize('listBranchesByIds', 'id', ids);
  const { data, error } = await supabase.from('branches').select('*').in('id', ids as UUID[]);
  if (error) throw new Error(`listBranchesByIds: ${error.message}`);
  return data as BranchRow[];
}

/** Every change branch on a model — main excluded — newest-updated first, for the "Changes" list (UI-principles §2.4's `/changes` route). */
export async function listChangeBranches(supabase: Client, modelId: UUID): Promise<BranchRow[]> {
  assertRealId('listChangeBranches', 'model_id', modelId);
  const { data, error } = await supabase.from('branches').select('*').eq('model_id', modelId).eq('kind', 'change').order('updated_at', { ascending: false });
  if (error) throw new Error(`listChangeBranches: ${error.message}`);
  return data as BranchRow[];
}

/**
 * The columns an authenticated user can update directly on their own
 * (title/shared_for_review from supabase/migrations/20260906071400_history.sql,
 * description/target_date from 20260906160000_branches_change_metadata.sql,
 * intent from 20260913100000_change_intent.sql) — everything else
 * (`head_commit_id`, `status`, `base_commit_id`) goes through a
 * security-definer function (`atlas.commit_deltas` or one of the
 * review-queue functions in 20260906161000_merge_review_queue.sql), never a
 * plain update.
 */
export interface UpdateBranchMetadataInput {
  title?: string | null;
  sharedForReview?: boolean;
  description?: string | null;
  targetDate?: string | null;
  /** Prompt pack F0: "editable while Draft" — enforced server-side by `atlas.guard_branch_intent_update`, not just by this function omitting the call once a caller knows better; a write attempted once `status !== 'draft'` is rejected by the trigger, not silently ignored. */
  intent?: BranchIntent;
}

export async function updateBranchMetadata(supabase: Client, branchId: UUID, input: UpdateBranchMetadataInput): Promise<void> {
  assertRealId('updateBranchMetadata', 'id', branchId);
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.sharedForReview !== undefined) patch.shared_for_review = input.sharedForReview;
  if (input.description !== undefined) patch.description = input.description;
  if (input.targetDate !== undefined) patch.target_date = input.targetDate;
  if (input.intent !== undefined) patch.intent = input.intent;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from('branches').update(patch).eq('id', branchId);
  if (error) throw new Error(`updateBranchMetadata: ${error.message}`);
}

/**
 * S1 item 16: the persisted counterpart to `dismissIdentityPair`
 * (`src/db/mergeRequests.ts`) for the pre-submission window — a draft
 * change's own rebase panel (`BranchRebasePanel.tsx`) has no merge request
 * yet to persist a "keep both" dismissal against, so this writes to the
 * branch itself instead (`atlas.dismiss_identity_pair_on_branch`,
 * `20260913020000_branch_identity_dismissals.sql`). Same idempotent-append
 * shape, same sorted "<idA> <idB>" pair-key convention.
 */
export async function dismissIdentityPairOnBranch(supabase: Client, branchId: UUID, pairKey: string): Promise<BranchRow> {
  assertRealId('dismissIdentityPairOnBranch', 'id', branchId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('dismiss_identity_pair_on_branch', { p_branch_id: branchId, p_pair_key: pairKey });
  if (error) throw new Error(`dismissIdentityPairOnBranch: ${error.message}`);
  return data as BranchRow;
}

/** Every branch split out of `branchId` (ADR-006 amendment, SPEC §1 S-22) — empty until the review queue's split-into-a-new-branch mechanic exists to create one. */
export async function listSplitBranches(supabase: Client, branchId: UUID): Promise<BranchRow[]> {
  assertRealId('listSplitBranches', 'split_from', branchId);
  const { data, error } = await supabase.from('branches').select('*').eq('split_from', branchId).order('updated_at', { ascending: false });
  if (error) throw new Error(`listSplitBranches: ${error.message}`);
  return data as BranchRow[];
}

export interface ChangeLineage {
  /** The branch that started this logical change — itself, unless `branch.split_from` points further back (ADR-006 amendment: "the original and its splits are one logical change"). */
  original: BranchRow;
  /** Every branch split from `original` — empty today (see `listSplitBranches`), real once that mechanic exists. */
  splits: BranchRow[];
}

/**
 * The change page's "delivered / remaining" breakdown (Sprint C1 step 6):
 * an original branch and every branch split from it, treated as one
 * logical change (ADR-006 amendment, SPEC §1 S-22). `branch` itself may be
 * the original or one of its splits — either way this resolves to the
 * same lineage, so the change page looks the same from any of them.
 */
export async function resolveChangeLineage(supabase: Client, branch: BranchRow): Promise<ChangeLineage> {
  const original = branch.split_from ? ((await getBranch(supabase, branch.split_from)) ?? branch) : branch;
  const splits = await listSplitBranches(supabase, original.id);
  return { original, splits };
}

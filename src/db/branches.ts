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
import type { Client } from './client';
import type { BranchRow } from './types';
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
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('branches').insert(row).select('*').single();
  if (error) throw new Error(`createChangeBranch: ${error.message}`);
  return data as BranchRow;
}

export async function getBranch(supabase: Client, branchId: UUID): Promise<BranchRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('branches').select('*').eq('id', branchId).maybeSingle();
  if (error) throw new Error(`getBranch: ${error.message}`);
  return data as BranchRow | null;
}

export async function getMainBranch(supabase: Client, modelId: UUID): Promise<BranchRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('branches').select('*').eq('model_id', modelId).eq('kind', 'main').maybeSingle();
  if (error) throw new Error(`getMainBranch: ${error.message}`);
  return data as BranchRow | null;
}

export async function listBranchesForModel(supabase: Client, modelId: UUID): Promise<BranchRow[]> {
  const { data, error } = await supabase.from('branches').select('*').eq('model_id', modelId);
  if (error) throw new Error(`listBranchesForModel: ${error.message}`);
  return data as BranchRow[];
}

/**
 * The columns an authenticated user can update directly on their own
 * (title/shared_for_review from supabase/migrations/20260906071400_history.sql,
 * description/target_date from 20260906160000_branches_change_metadata.sql)
 * — everything else (`head_commit_id`, `status`, `base_commit_id`) goes
 * through a security-definer function (`atlas.commit_deltas` or one of the
 * review-queue functions in 20260906161000_merge_review_queue.sql), never a
 * plain update.
 */
export interface UpdateBranchMetadataInput {
  title?: string | null;
  sharedForReview?: boolean;
  description?: string | null;
  targetDate?: string | null;
}

export async function updateBranchMetadata(supabase: Client, branchId: UUID, input: UpdateBranchMetadataInput): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.sharedForReview !== undefined) patch.shared_for_review = input.sharedForReview;
  if (input.description !== undefined) patch.description = input.description;
  if (input.targetDate !== undefined) patch.target_date = input.targetDate;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from('branches').update(patch).eq('id', branchId);
  if (error) throw new Error(`updateBranchMetadata: ${error.message}`);
}

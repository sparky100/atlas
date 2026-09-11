/**
 * `comments` repository operations (SPEC §3.8 amendment, ADR-010 amendment
 * — supabase/migrations/20260906240000_comments.sql). Comments live in
 * `public`, unlike `atlas.profiles`: they're model content, not identity
 * infrastructure, so every call here is a plain (untyped-client) table
 * operation, same as sources.ts/aliases.ts — see branches.ts's module
 * comment for the `eslint-disable` boundary this follows.
 *
 * No `deleteComment`: comments are never deleted, only resolved (rule 5).
 * No `createComment` calls `atlas.commit_deltas` or any other RPC — a
 * comment is not a delta, it never touches the engine, and its RLS insert
 * policy (`comments_insert`) is a plain per-row check, not a
 * function-only write like commits.
 */
import type { UUID } from '../contracts/delta';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { assertInFilterSize } from './inFilterLimit';
import type { AnchorType, CommentRow, ViewKind } from './types';

export interface CreateCommentInput {
  /** Minted by the caller (S-1 convention, same as every other id in this codebase). */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  anchorType: AnchorType;
  anchorId: UUID;
  /** Which branch this comment was raised from — required whenever the anchor (typically an element/relationship) might not exist on main yet; null for a main/tag-scoped anchor. */
  branchId?: UUID | null;
  viewKind?: ViewKind | null;
  /** A root comment's own id, if this is a reply — must already share that root's anchor (enforced by `atlas.check_anchor`, not re-checked client-side). */
  parentCommentId?: UUID | null;
  body: string;
  authorId: UUID;
}

export async function createComment(supabase: Client, input: CreateCommentInput): Promise<CommentRow> {
  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    anchor_type: input.anchorType,
    anchor_id: input.anchorId,
    branch_id: input.branchId ?? null,
    view_kind: input.viewKind ?? null,
    parent_comment_id: input.parentCommentId ?? null,
    body: input.body,
    author_id: input.authorId,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('comments').insert(row).select('*').single();
  if (error) throw new Error(`createComment: ${error.message}`);
  return data as CommentRow;
}

/** One thread: its root comment plus replies, oldest first (ADR-010's flat reply chain — replies never nest further). */
export interface CommentThread {
  root: CommentRow;
  replies: CommentRow[];
}

export interface AnchorComments {
  threads: CommentThread[];
  /**
   * True when `anchorType` is `element`/`relationship` and the subject is
   * not currently present in main's head — it existed (its anchor passed
   * `atlas.check_anchor` at post time and RLS still lets this reader see
   * the thread) but has since been retracted. UI-principles' "flagged as
   * anchored to a retracted subject" reads this, not a re-derivation of
   * its own.
   */
  anchorRetracted: boolean;
}

/** Every comment thread anchored to one subject, oldest root first. Root-visibility is RLS's job (`comments_select`) — this just orders and groups what the query already returned. */
export async function listCommentsForAnchor(supabase: Client, modelId: UUID, anchorType: AnchorType, anchorId: UUID): Promise<AnchorComments> {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('model_id', modelId)
    .eq('anchor_type', anchorType)
    .eq('anchor_id', anchorId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listCommentsForAnchor: ${error.message}`);
  const rows = (data as CommentRow[] | null) ?? [];

  const roots = rows.filter((r) => r.parent_comment_id === null);
  const repliesByParent = new Map<UUID, CommentRow[]>();
  for (const row of rows) {
    if (row.parent_comment_id === null) continue;
    const list = repliesByParent.get(row.parent_comment_id) ?? [];
    list.push(row);
    repliesByParent.set(row.parent_comment_id, list);
  }
  const threads: CommentThread[] = roots.map((root) => ({ root, replies: repliesByParent.get(root.id) ?? [] }));

  const anchorRetracted = anchorType === 'element' || anchorType === 'relationship' ? await isAnchorRetracted(supabase, modelId, anchorType, anchorId) : false;

  return { threads, anchorRetracted };
}

/**
 * Every comment named by `ids` — the notification tray's own lookup
 * (Sprint M1b: a `notifications` row only carries `comment_id`; the tray
 * needs the comment's own body/anchor/author to render a row at all).
 * Bounded by the notification list on screen, which is always small, but
 * goes through the same rule 8 ceiling every other batch id lookup does.
 */
export async function listCommentsByIds(supabase: Client, ids: readonly UUID[]): Promise<CommentRow[]> {
  if (ids.length === 0) return [];
  assertInFilterSize('listCommentsByIds', 'id', ids);
  const { data, error } = await supabase.from('comments').select('*').in('id', ids as UUID[]);
  if (error) throw new Error(`listCommentsByIds: ${error.message}`);
  return (data as CommentRow[] | null) ?? [];
}

/** True if `anchorId` (an element or relationship) has no row in `elements_head`/`relationships_head` at main's current head — it was created (or this anchor would never have passed `atlas.check_anchor`) but is not currently live. */
async function isAnchorRetracted(supabase: Client, modelId: UUID, anchorType: 'element' | 'relationship', anchorId: UUID): Promise<boolean> {
  const main = await getMainBranch(supabase, modelId);
  if (!main) return false;
  const table = anchorType === 'element' ? 'elements_head' : 'relationships_head';
  const idColumn = anchorType === 'element' ? 'element_id' : 'relationship_id';
  const { data, error } = await supabase.from(table).select(idColumn).eq('commit_id', main.head_commit_id).eq(idColumn, anchorId).maybeSingle();
  if (error) throw new Error(`isAnchorRetracted: ${error.message}`);
  return data === null;
}

export interface ResolveCommentInput {
  commentId: UUID;
  resolvedBy: UUID;
}

/** Resolves a thread's root comment. RLS (`comments_update` + `atlas.guard_comment_update`) is the real enforcement of "owner/architect resolve any; contributors resolve their own threads" — this just shapes the write. */
export async function resolveComment(supabase: Client, input: ResolveCommentInput): Promise<CommentRow> {
  const patch = { status: 'resolved' as const, resolved_by: input.resolvedBy, resolved_at: new Date().toISOString() };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('comments').update(patch).eq('id', input.commentId).select('*').single();
  if (error) throw new Error(`resolveComment: ${error.message}`);
  return data as CommentRow;
}

/** Reopens a previously-resolved thread. Same permission matrix as `resolveComment`. */
export async function reopenComment(supabase: Client, commentId: UUID): Promise<CommentRow> {
  const patch = { status: 'open' as const, resolved_by: null, resolved_at: null };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('comments').update(patch).eq('id', commentId).select('*').single();
  if (error) throw new Error(`reopenComment: ${error.message}`);
  return data as CommentRow;
}

/** Edits a comment's own body. RLS/`atlas.guard_comment_update` restrict this to the comment's author. */
export async function editCommentBody(supabase: Client, commentId: UUID, body: string): Promise<CommentRow> {
  const patch = { body, edited_at: new Date().toISOString() };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('comments').update(patch).eq('id', commentId).select('*').single();
  if (error) throw new Error(`editCommentBody: ${error.message}`);
  return data as CommentRow;
}

/**
 * One `(anchor_id, open_count, total_count)` row per anchor that has at
 * least one root thread at all. An anchor with zero comments ever raised
 * is simply absent from the result, same convention as the RPC this
 * replaced — but an anchor with `total_count > 0` and `open_count === 0`
 * (every thread resolved) is now distinguishable from that absent case,
 * which a plain "unresolved count" alone could never tell apart (M1
 * close-out item 1 — the marker's own "hollow, all resolved" state).
 */
export interface ThreadCounts {
  anchor_id: UUID;
  open_count: number;
  total_count: number;
}

/**
 * `atlas.thread_counts` via RPC (a POST, not a GET `.in()`) — this is
 * exactly the shape rule 8 asks for: `anchorIds` grows with however many
 * element cards/tiles/rows a page renders, which scales with the model, so
 * a GET `.in()` here is the same URL-length hazard `assertInFilterSize`
 * guards everywhere else. A POST body has no such limit.
 */
export async function getThreadCounts(supabase: Client, modelId: UUID, anchorIds: readonly UUID[]): Promise<ThreadCounts[]> {
  if (anchorIds.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('thread_counts', { p_model_id: modelId, p_anchor_ids: anchorIds });
  if (error) throw new Error(`getThreadCounts: ${error.message}`);
  return (data as ThreadCounts[] | null) ?? [];
}

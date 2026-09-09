import type { UUID } from '../../contracts/delta';
import { createComment, resolveComment, reopenComment } from '../../db/comments';
import type { AnchorType, ViewKind } from '../../db/types';
import { supabase } from '../supabaseClient';

export interface UseCommentActionsInput {
  orgId: UUID;
  modelId: UUID;
  userId: UUID | null;
  anchorType: AnchorType;
  anchorId: UUID;
  /** Set when the anchor might not exist on main yet (SPEC §3.8) — a comment raised on a draft branch's own element/relationship. Undefined/null for a main-scoped anchor, or for the `change`/`version` anchor kinds, which already name their own branch/tag as `anchorId`. */
  branchId?: UUID | null | undefined;
  viewKind?: ViewKind | null | undefined;
  /** Called after any successful create/resolve/reopen — the caller's own `useAnchorComments().reload`. */
  onChanged: () => void;
}

export interface UseCommentActionsResult {
  createThread: (body: string) => Promise<void>;
  reply: (parentCommentId: UUID, body: string) => Promise<void>;
  resolve: (commentId: UUID) => Promise<void>;
  reopen: (commentId: UUID) => Promise<void>;
}

/** The write half of the comments feature (Sprint M1b) — a thin wrapper over `src/db/comments.ts` that fills in the caller's own context (org/model/anchor/author) and reloads afterward, the same "commit, then reload" shape every other create/resolve hook in this codebase already uses. */
export function useCommentActions(input: UseCommentActionsInput): UseCommentActionsResult {
  const { orgId, modelId, userId, anchorType, anchorId, branchId, viewKind, onChanged } = input;

  async function createThread(body: string) {
    if (!userId) throw new Error('You must be signed in to comment.');
    await createComment(supabase, { id: crypto.randomUUID(), orgId, modelId, anchorType, anchorId, branchId: branchId ?? null, viewKind: viewKind ?? null, body, authorId: userId });
    onChanged();
  }

  async function reply(parentCommentId: UUID, body: string) {
    if (!userId) throw new Error('You must be signed in to reply.');
    await createComment(supabase, { id: crypto.randomUUID(), orgId, modelId, anchorType, anchorId, branchId: branchId ?? null, viewKind: viewKind ?? null, parentCommentId, body, authorId: userId });
    onChanged();
  }

  async function resolve(commentId: UUID) {
    if (!userId) throw new Error('You must be signed in to resolve a thread.');
    await resolveComment(supabase, { commentId, resolvedBy: userId });
    onChanged();
  }

  async function reopen(commentId: UUID) {
    await reopenComment(supabase, commentId);
    onChanged();
  }

  return { createThread, reply, resolve, reopen };
}

import { useState } from 'react';
import type { UUID } from '../../../contracts/delta';
import type { AnchorType, MemberRole, ViewKind } from '../../../db/types';
import { canPostComment } from '../../comments/commentPermissions';
import { useAnchorComments } from '../../comments/useAnchorComments';
import { useCommentActions } from '../../comments/useCommentActions';
import { useOrgMemberProfiles } from '../../comments/useOrgMemberProfiles';
import { Chip } from '../Chip/Chip';
import { CommentComposer } from '../CommentComposer/CommentComposer';
import { CommentThread } from '../CommentThread/CommentThread';
import { EmptyState } from '../EmptyState/EmptyState';
import { Text } from '../Text/Text';
import styles from './CommentsSection.module.css';

export interface CommentsSectionProps {
  orgId: UUID;
  modelId: UUID;
  userId: UUID | null;
  role: MemberRole | null;
  anchorType: AnchorType;
  anchorId: UUID;
  branchId?: UUID | null;
  viewKind?: ViewKind | null;
  /** `n`'s own "New comment on the focused row" (UI-principles §8.8) — the canvas panel opens with the composer ready to type into; the element page section never sets this (opening the page isn't itself a request to comment). */
  autoFocusComposer?: boolean;
}

/**
 * Comments on one subject (Sprint M1b element-page section 6a,
 * `docs/HANDOFF-M1b-comments.md`) — every open thread, then the collapsed
 * resolved count, then the composer for a new thread. Reused as-is by
 * anything else anchoring a full thread list to one subject; the canvas
 * panel (5a) wraps this same component rather than reimplementing it.
 */
export function CommentsSection({ orgId, modelId, userId, role, anchorType, anchorId, branchId, viewKind, autoFocusComposer = false }: CommentsSectionProps) {
  const [showResolved, setShowResolved] = useState(false);
  const { state, reload } = useAnchorComments(modelId, anchorType, anchorId);
  const members = useOrgMemberProfiles(orgId);
  const actions = useCommentActions({ orgId, modelId, userId, anchorType, anchorId, branchId, viewKind, onChanged: reload });
  const canPost = canPostComment(role);

  if (state.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;

  const openThreads = state.data.threads.filter((t) => t.root.status === 'open');
  const resolvedThreads = state.data.threads.filter((t) => t.root.status === 'resolved');

  return (
    <div className={styles.section}>
      {state.data.anchorRetracted && (
        <Chip tone="neutral">item retired</Chip>
      )}

      {state.data.threads.length === 0 && (
        <EmptyState>Comments are conversation, not governance — they never block a merge. Nothing has been raised here yet.</EmptyState>
      )}

      {openThreads.length > 0 && (
        <div className={styles.threads}>
          {openThreads.map((thread) => (
            <CommentThread
              key={thread.root.id}
              thread={thread}
              profiles={state.profiles}
              branches={state.branches}
              members={members}
              role={role}
              userId={userId}
              canPost={canPost}
              onReply={actions.reply}
              onResolve={actions.resolve}
              onReopen={actions.reopen}
            />
          ))}
        </div>
      )}

      {resolvedThreads.length > 0 && (
        <div className={styles.resolvedGroup}>
          <button type="button" className={styles.resolvedToggle} onClick={() => { setShowResolved((s) => !s); }}>
            <Text as="span" size="sm" tone="muted">
              {resolvedThreads.length} resolved thread{resolvedThreads.length === 1 ? '' : 's'} · {showResolved ? 'hide' : 'show'}
            </Text>
          </button>
          {showResolved && (
            <div className={styles.threads}>
              {resolvedThreads.map((thread) => (
                <CommentThread
                  key={thread.root.id}
                  thread={thread}
                  profiles={state.profiles}
                  branches={state.branches}
                  members={members}
                  role={role}
                  userId={userId}
                  canPost={canPost}
                  onReply={actions.reply}
                  onResolve={actions.resolve}
                  onReopen={actions.reopen}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {canPost && (
        <div className={styles.newThread}>
          <CommentComposer
            members={members}
            placeholder="Write a comment…"
            submitLabel="Post"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- opt-in per caller; the canvas panel's own `n` shortcut is itself the request to type one (RelationshipAdd.tsx/ElementSearchAdd.tsx's own convention).
            autoFocus={autoFocusComposer}
            onSubmit={actions.createThread}
          />
        </div>
      )}
    </div>
  );
}

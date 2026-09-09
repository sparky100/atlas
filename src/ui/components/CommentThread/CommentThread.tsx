import { useState } from 'react';
import type { UUID } from '../../../contracts/delta';
import type { BranchRow, CommentRow, MemberRole, ProfileRow } from '../../../db/types';
import type { CommentThread as CommentThreadData } from '../../../db/comments';
import { canResolveComment } from '../../comments/commentPermissions';
import { formatCommitActivityTime } from '../../home/commitActivityTime';
import { Avatar } from '../Avatar/Avatar';
import { Button } from '../Button/Button';
import { Chip } from '../Chip/Chip';
import { CommentBody } from '../CommentBody/CommentBody';
import { CommentComposer } from '../CommentComposer/CommentComposer';
import { Text } from '../Text/Text';
import styles from './CommentThread.module.css';

export interface CommentThreadProps {
  thread: CommentThreadData;
  profiles: ReadonlyMap<UUID, ProfileRow>;
  /** For the root's own "on change: <name>" tag (`comments.branch_id`, `docs/HANDOFF-M1b-comments.md`'s 6b) — display metadata only, never gates visibility (SPEC §9.4). A branch id absent from this map (RLS denied it, or it was never fetched) simply omits the tag rather than erroring. */
  branches: ReadonlyMap<UUID, BranchRow>;
  members: readonly ProfileRow[];
  role: MemberRole | null;
  userId: UUID | null;
  canPost: boolean;
  onReply: (parentCommentId: UUID, body: string) => Promise<void>;
  onResolve: (commentId: UUID) => Promise<void>;
  onReopen: (commentId: UUID) => Promise<void>;
}

function authorLabel(profile: ProfileRow | undefined): string {
  return profile?.display_name ?? (profile ? `@${profile.handle}` : 'Someone');
}

/** One comment row (root or reply) — author identity, body, timestamp. Both `CommentThread`'s own root and its replies use this; only the root additionally carries the resolve/reopen row and a reply composer, added around it by the caller below. */
function CommentRowView({ comment, profile, now }: { comment: CommentRow; profile: ProfileRow | undefined; now: Date }) {
  return (
    <div className={styles.row}>
      <Avatar profile={profile ?? null} />
      <div className={styles.rowContent}>
        <div className={styles.rowHeader}>
          <Text as="span" size="sm" className={styles.authorName}>
            {authorLabel(profile)}
          </Text>
          {profile && (
            <Text as="span" size="xs" tone="muted">
              @{profile.handle}
            </Text>
          )}
          <Text as="span" size="xs" tone="faint">
            {formatCommitActivityTime(comment.created_at, now)}
          </Text>
          {comment.edited_at && (
            <Text as="span" size="xs" tone="faint">
              (edited)
            </Text>
          )}
        </div>
        <CommentBody body={comment.body} />
      </div>
    </div>
  );
}

/**
 * One thread — root plus its flat replies (ADR-010: replies never nest
 * further), Reply/Resolve aligned to the reply indent (Sprint M1b,
 * `docs/HANDOFF-M1b-comments.md`). Only the root carries resolution state,
 * so Resolve appears once per thread. Reused everywhere a thread renders:
 * the element page section, the canvas panel, the change page's per-
 * subject and per-anchor columns.
 */
export function CommentThread({ thread, profiles, branches, members, role, userId, canPost, onReply, onResolve, onReopen }: CommentThreadProps) {
  const [replying, setReplying] = useState(false);
  const now = new Date();
  const { root, replies } = thread;
  const resolved = root.status === 'resolved';
  const canResolve = canResolveComment(role, userId, root.author_id);
  const resolvedByProfile = root.resolved_by ? profiles.get(root.resolved_by) : undefined;
  const onChangeBranch = root.branch_id ? branches.get(root.branch_id) : undefined;

  return (
    <div className={styles.thread}>
      {onChangeBranch && (
        <Chip tone="neutral">on change: {onChangeBranch.title ?? onChangeBranch.name}</Chip>
      )}
      <CommentRowView comment={root} profile={profiles.get(root.author_id)} now={now} />

      {replies.length > 0 && (
        <div className={styles.replies}>
          {replies.map((reply) => (
            <CommentRowView key={reply.id} comment={reply} profile={profiles.get(reply.author_id)} now={now} />
          ))}
        </div>
      )}

      <div className={styles.actions}>
        {!resolved && canPost && (
          <Button variant="ghost" onClick={() => { setReplying((r) => !r); }}>
            Reply
          </Button>
        )}
        {!resolved && canResolve && (
          <Button variant="ghost" onClick={() => void onResolve(root.id)}>
            Resolve
          </Button>
        )}
        {resolved && (
          <>
            <Text as="span" size="xs" tone="muted">
              resolved by {resolvedByProfile ? `@${resolvedByProfile.handle}` : 'someone'} · {root.resolved_at ? formatCommitActivityTime(root.resolved_at, now) : ''}
            </Text>
            {canResolve && (
              <Button variant="ghost" onClick={() => void onReopen(root.id)}>
                Reopen
              </Button>
            )}
          </>
        )}
      </div>

      {replying && (
        <div className={styles.replyComposer}>
          <CommentComposer
            members={members}
            placeholder="Write a reply…"
            submitLabel="Reply"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- clicking "Reply" is itself the request to type one; same convention as RelationshipAdd.tsx/ElementSearchAdd.tsx's own inputs.
            autoFocus
            onSubmit={async (body) => {
              await onReply(root.id, body);
              setReplying(false);
            }}
            onCancel={() => { setReplying(false); }}
          />
        </div>
      )}
    </div>
  );
}

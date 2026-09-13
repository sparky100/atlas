import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getMainBranch } from '../../db/branches';
import { listCommentsByIds } from '../../db/comments';
import { getElementsByIds } from '../../db/elements';
import { getModelById } from '../../db/models';
import { getUnreadNotificationCount, listMyNotifications, markAllNotificationsRead, markNotificationRead } from '../../db/notifications';
import { getOrganisationById } from '../../db/organisations';
import { listProfilesByIds } from '../../db/profiles';
import type { CommentRow, NotificationRow, ProfileRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

/**
 * One enriched notification-tray row (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s
 * 6c). `notifications` itself only carries `comment_id`; this resolves the
 * rest — the comment's own author/body/anchor, and (element anchors only,
 * see this module's own comment below) a deep link.
 */
export interface NotificationTrayRow {
  notification: NotificationRow;
  comment: CommentRow | undefined;
  authorProfile: ProfileRow | undefined;
  /** The subject's own name, resolved for `element` anchors only this sprint (see module comment) — `undefined` otherwise, never a guess. */
  subjectName: string | undefined;
  /** Set only for anchor kinds with a real page to link to (`element`, `change` — App.tsx's own route table has neither a relationship, version, nor decision page yet). `undefined` renders as a plain, non-clickable row rather than a link that would 404. */
  href: string | undefined;
}

export type NotificationTrayState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; rows: NotificationTrayRow[] };

/**
 * The tray's own data (Sprint M1b, 6c). `unreadCount` is cheap and always
 * kept current (the header's own bell badge, `getUnreadNotificationCount` —
 * Sprint M1a already built and tested this); the full enriched list is
 * fetched only once the tray is actually opened, since resolving it needs
 * several more queries per distinct model/org/comment a plain unread count
 * never has to make.
 *
 * Deep-linking scope: `App.tsx`'s route table has a real page for `element`
 * (`/e/{elementId}`) and `change` (`/changes/{branchId}`) anchors only —
 * there is no relationship, version, or decision page to link to yet
 * (UI-principles §2.4's own deep-link table names `element`/`change`/
 * `merge request`/`capture draft`/`decision`, but only the first two, plus
 * versions/reviews already covered by other pages, are actually routed in
 * `App.tsx` today). A `relationship`/`version`/`decision`-anchored
 * notification still renders — body, author, "N ago" — just without a
 * subject name or a link, rather than one guessed at a route that doesn't
 * exist. Not a shortcut: `element`/`change` cover the overwhelming majority
 * of comments in practice, since `CommentsSection` is wired to element
 * anchors everywhere except the change page's own "Comments on this
 * change" panel.
 */
export function useNotificationTray(userId: UUID | null) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<NotificationTrayState>({ status: 'loading' });

  const reloadCount = useCallback(() => {
    if (!userId) return;
    void getUnreadNotificationCount(supabase, userId).then(setUnreadCount);
  }, [userId]);

  useEffect(() => {
    reloadCount();
  }, [reloadCount]);

  const loadRows = useCallback(() => {
    if (!userId) return;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const notifications = await listMyNotifications(supabase, userId);
        const commentIds = [...new Set(notifications.map((n) => n.comment_id).filter((id): id is UUID => id !== null))];
        const comments = await listCommentsByIds(supabase, commentIds);
        const commentsById = new Map(comments.map((c) => [c.id, c]));

        const authorIds = [...new Set(comments.map((c) => c.author_id))];
        const modelIds = [...new Set(comments.map((c) => c.model_id))];

        const profiles = await listProfilesByIds(supabase, authorIds);
        const profilesById = new Map(profiles.map((p) => [p.user_id, p]));

        // One model/org/element-name resolution per distinct model, not
        // per notification — bounded by how many models this user's
        // recent notifications actually touch, typically one or two.
        const linkInfoByModel = new Map<UUID, { orgSlug: string; modelSlug: string }>();
        const elementNamesByModel = new Map<UUID, Map<UUID, string>>();
        for (const modelId of modelIds) {
          const model = await getModelById(supabase, modelId);
          if (!model) continue;
          const org = await getOrganisationById(supabase, model.org_id);
          if (!org) continue;
          linkInfoByModel.set(modelId, { orgSlug: org.slug, modelSlug: model.slug });

          const elementAnchorIds = [...new Set(comments.filter((c) => c.model_id === modelId && c.anchor_type === 'element').map((c) => c.anchor_id))];
          if (elementAnchorIds.length > 0) {
            const main = await getMainBranch(supabase, modelId);
            if (main) {
              const elements = await getElementsByIds(supabase, main.head_commit_id, elementAnchorIds);
              elementNamesByModel.set(
                modelId,
                new Map([...elements.entries()].map(([id, row]) => [id, row.name])),
              );
            }
          }
        }

        const rows: NotificationTrayRow[] = notifications.map((notification) => {
          const comment = notification.comment_id ? commentsById.get(notification.comment_id) : undefined;
          const authorProfile = comment ? profilesById.get(comment.author_id) : undefined;
          const link = comment ? linkInfoByModel.get(comment.model_id) : undefined;
          const subjectName = comment?.anchor_type === 'element' ? elementNamesByModel.get(comment.model_id)?.get(comment.anchor_id) : undefined;
          let href: string | undefined;
          if (comment && link) {
            if (comment.anchor_type === 'element') href = `/o/${link.orgSlug}/m/${link.modelSlug}/e/${comment.anchor_id}#c=${comment.id}`;
            else if (comment.anchor_type === 'change') href = `/o/${link.orgSlug}/m/${link.modelSlug}/changes/${comment.anchor_id}#c=${comment.id}`;
          }
          return { notification, comment, authorProfile, subjectName, href };
        });

        setState({ status: 'ready', rows });
      } catch (e) {
        reportError("Couldn't load notifications.", e);
        setState({ status: 'error', message: e instanceof Error ? e.message : 'Could not load notifications.' });
      }
    })();
  }, [userId]);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) loadRows();
      return next;
    });
  }

  async function markRead(notificationId: UUID) {
    await markNotificationRead(supabase, notificationId);
    reloadCount();
    loadRows();
  }

  async function markAllRead() {
    if (!userId) return;
    await markAllNotificationsRead(supabase, userId);
    reloadCount();
    loadRows();
  }

  return { unreadCount, open, toggle, state, markRead, markAllRead };
}

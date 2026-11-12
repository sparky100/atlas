import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getUserPreferences, upsertUserPreferences } from '../../db/userPreferences';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface NotificationPreferences {
  notifyOnMention: boolean;
  notifyOnReply: boolean;
  /** F7 item 3 follow-up: added once F3a's `review_assigned` notification kind actually shipped. */
  notifyOnReviewAssigned: boolean;
  /** Also email me (with a link) when I'm assigned as a reviewer. */
  emailOnReviewAssigned: boolean;
  /** Email me when things I own (or, as an architect, things nobody owns) need checking. */
  emailOnStaleNudge: boolean;
}

export interface UseNotificationPreferencesResult {
  preferences: NotificationPreferences;
  loading: boolean;
  setNotifyOnMention: (value: boolean) => void;
  setNotifyOnReply: (value: boolean) => void;
  setNotifyOnReviewAssigned: (value: boolean) => void;
  setEmailOnReviewAssigned: (value: boolean) => void;
  setEmailOnStaleNudge: (value: boolean) => void;
}

const DEFAULTS: NotificationPreferences = { notifyOnMention: true, notifyOnReply: true, notifyOnReviewAssigned: true, emailOnReviewAssigned: true, emailOnStaleNudge: true };

/**
 * Sprint F7 item 3 — same load-then-write shape `useLandscapeColourByPreference.ts`
 * already establishes: load once, optimistic local update on every
 * toggle, best-effort write (a failed save just leaves the saved value
 * stale until the next successful toggle — the same stance every other
 * preference hook in this codebase already takes, since a preference
 * miss is never data loss). `true`/`true`/`true` — matching
 * `atlas.process_comment_mentions`'s/`atlas.submit_merge_request`'s own
 * `coalesce(..., true)` — is what a user with no saved row at all sees,
 * same "no row means no saved override... but this one has a fixed
 * default" reasoning `UserPreferences.notifyOnMention`'s own doc comment
 * gives.
 */
export function useNotificationPreferences(userId: UUID | null): UseNotificationPreferencesResult {
  const [saved, setSaved] = useState<NotificationPreferences | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      setSaved(DEFAULTS);
      return;
    }
    let cancelled = false;
    getUserPreferences(supabase, userId)
      .then((row) => {
        if (cancelled) return;
        setSaved(row ? { notifyOnMention: row.notify_on_mention, notifyOnReply: row.notify_on_reply, notifyOnReviewAssigned: row.notify_on_review_assigned, emailOnReviewAssigned: row.email_on_review_assigned, emailOnStaleNudge: row.email_on_stale_nudge } : DEFAULTS);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load your notification preferences.", e);
        if (!cancelled) setSaved(DEFAULTS);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loading = saved === undefined;
  const preferences = saved ?? DEFAULTS;

  const setNotifyOnMention = useCallback(
    (value: boolean) => {
      setSaved((prev) => ({ ...(prev ?? DEFAULTS), notifyOnMention: value }));
      if (userId) {
        upsertUserPreferences(supabase, { userId, notifyOnMention: value }).catch((e: unknown) => {
          reportError("Couldn't save your notification preference.", e);
        });
      }
    },
    [userId],
  );

  const setNotifyOnReply = useCallback(
    (value: boolean) => {
      setSaved((prev) => ({ ...(prev ?? DEFAULTS), notifyOnReply: value }));
      if (userId) {
        upsertUserPreferences(supabase, { userId, notifyOnReply: value }).catch((e: unknown) => {
          reportError("Couldn't save your notification preference.", e);
        });
      }
    },
    [userId],
  );

  const setNotifyOnReviewAssigned = useCallback(
    (value: boolean) => {
      setSaved((prev) => ({ ...(prev ?? DEFAULTS), notifyOnReviewAssigned: value }));
      if (userId) {
        upsertUserPreferences(supabase, { userId, notifyOnReviewAssigned: value }).catch((e: unknown) => {
          reportError("Couldn't save your notification preference.", e);
        });
      }
    },
    [userId],
  );

  const setEmailOnReviewAssigned = useCallback(
    (value: boolean) => {
      setSaved((prev) => ({ ...(prev ?? DEFAULTS), emailOnReviewAssigned: value }));
      if (userId) {
        upsertUserPreferences(supabase, { userId, emailOnReviewAssigned: value }).catch((e: unknown) => {
          reportError("Couldn't save your notification preference.", e);
        });
      }
    },
    [userId],
  );

  const setEmailOnStaleNudge = useCallback(
    (value: boolean) => {
      setSaved((prev) => ({ ...(prev ?? DEFAULTS), emailOnStaleNudge: value }));
      if (userId) {
        upsertUserPreferences(supabase, { userId, emailOnStaleNudge: value }).catch((e: unknown) => {
          reportError("Couldn't save your notification preference.", e);
        });
      }
    },
    [userId],
  );

  return { preferences, loading, setNotifyOnMention, setNotifyOnReply, setNotifyOnReviewAssigned, setEmailOnReviewAssigned, setEmailOnStaleNudge };
}

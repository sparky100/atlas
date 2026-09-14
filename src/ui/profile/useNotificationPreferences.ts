import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getUserPreferences, upsertUserPreferences } from '../../db/userPreferences';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface NotificationPreferences {
  notifyOnMention: boolean;
  notifyOnReply: boolean;
}

export interface UseNotificationPreferencesResult {
  preferences: NotificationPreferences;
  loading: boolean;
  setNotifyOnMention: (value: boolean) => void;
  setNotifyOnReply: (value: boolean) => void;
}

const DEFAULTS: NotificationPreferences = { notifyOnMention: true, notifyOnReply: true };

/**
 * Sprint F7 item 3 — same load-then-write shape `useLandscapeColourByPreference.ts`
 * already establishes: load once, optimistic local update on every
 * toggle, best-effort write (a failed save just leaves the saved value
 * stale until the next successful toggle — the same stance every other
 * preference hook in this codebase already takes, since a preference
 * miss is never data loss). `true`/`true` — matching
 * `atlas.process_comment_mentions`'s own `coalesce(..., true)` — is what
 * a user with no saved row at all sees, same "no row means no saved
 * override... but this one has a fixed default" reasoning
 * `UserPreferences.notifyOnMention`'s own doc comment gives.
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
        setSaved(row ? { notifyOnMention: row.notify_on_mention, notifyOnReply: row.notify_on_reply } : DEFAULTS);
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

  return { preferences, loading, setNotifyOnMention, setNotifyOnReply };
}

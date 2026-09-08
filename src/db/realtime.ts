/**
 * Supabase Realtime for one model: presence (who's viewing which ref),
 * commit notifications, and comment inserts/updates — one channel per
 * model, `model:{modelId}`. Presence is channel-only (never backed by a
 * table); commits/comments stream over `postgres_changes`, RLS-filtered per
 * subscriber exactly like any other read (supabase/migrations/
 * 20260906240000_comments.sql's own module comment on the publication it
 * adds both tables to).
 *
 * Reconnect: `subscribe()`'s own status callback is the only reliable
 * signal a channel actually dropped (the socket layer retries underneath
 * it, but a channel that reports `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` does
 * not silently resume — Realtime expects the caller to rejoin). On any of
 * those, this module tears the channel down and rebuilds it from scratch
 * (a fresh `postgres_changes` subscription, a fresh presence `track()`)
 * after a backoff, and calls `onResync` so the caller re-fetches whatever
 * it's showing — events possible during the gap are not replayed, so
 * "resume" here means "assume state drifted," not "catch up an event log."
 * The same rebuild runs when the tab becomes visible again
 * (`visibilitychange`), since a backgrounded tab's socket can be silently
 * dead without ever reporting a status change while hidden.
 */
import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel, type RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { UUID } from '../contracts/delta';
import type { Client } from './client';
import type { CommentRow } from './types';

/** The literal shape of a row in `commits` — just what this module reads off a postgres_changes payload, not the full CommitRow contracts/rows.ts already types for the write path. */
export interface CommitNotification {
  id: UUID;
  model_id: UUID;
  branch_id: UUID;
  author_id: UUID;
  kind: string;
  created_at: string;
}

export interface PresenceEntry {
  userId: UUID;
  /** `refParamOf(ref)` (src/db/ref.ts) — `'main'`, `'branch:{slug}'`, or `'tag:{name}'`. */
  ref: string;
}

export interface ModelChannelHandlers {
  onPresenceChange?: (entries: PresenceEntry[]) => void;
  onCommit?: (commit: CommitNotification) => void;
  onCommentInsert?: (comment: CommentRow) => void;
  /** `previous` is `null` on the very first snapshot a subscriber might have missed context for — Realtime's own UPDATE payload always carries the old row (comments has `replica identity full`), so this is only ever null if the update raced the subscription itself. */
  onCommentUpdate?: (comment: CommentRow, previous: CommentRow | null) => void;
  /** Fires once right after (re)establishing the channel, including the very first time — a caller re-fetches its own current snapshot here rather than assuming continuity with whatever it showed before. */
  onResync?: () => void;
}

export interface ModelChannelHandle {
  /** Updates this client's own presence entry — call when the viewer switches ref (branch/tag/main). */
  setRef(ref: string): void;
  /** Tears down the channel, stops listening, and cancels any pending reconnect. Safe to call more than once. */
  unsubscribe: () => Promise<void>;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/** Browser-only: a backgrounded tab's socket can go quietly dead without ever reporting a channel status change. `document` is undefined in Node (server code, tests without jsdom) — guarded rather than assumed. */
function noop(): void {
  // Node/test environments have no `document` — nothing to watch or unwatch.
}

function onVisible(callback: () => void): () => void {
  if (typeof document === 'undefined') return noop;
  const listener = () => {
    if (document.visibilityState === 'visible') callback();
  };
  document.addEventListener('visibilitychange', listener);
  return () => {
    document.removeEventListener('visibilitychange', listener);
  };
}

export function subscribeToModelChannel(supabase: Client, modelId: UUID, userId: UUID, initialRef: string, handlers: ModelChannelHandlers): ModelChannelHandle {
  let currentRef = initialRef;
  let channel: RealtimeChannel | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let tornDown = false;

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (tornDown) return;
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      attach();
    }, backoffMs);
  }

  function attach(): void {
    if (tornDown) return;
    if (channel) {
      void supabase.removeChannel(channel);
      channel = null;
    }

    // `postgres_changes_options: { wait: true }`: without it, `subscribe()`
    // reports SUBSCRIBED as soon as the channel itself joins, which can
    // happen before the server's postgres_changes binding is actually
    // streaming — a comment/commit inserted right after "SUBSCRIBED" can be
    // missed. `wait: true` holds SUBSCRIBED until the server confirms the
    // binding is live, and extends the join timeout to match on its own.
    const next = supabase.channel(`model:${modelId}`, { config: { presence: { key: userId }, postgres_changes_options: { wait: true } } });

    next.on('presence', { event: 'sync' }, () => {
      const state = next.presenceState<{ ref: string }>();
      const entries: PresenceEntry[] = Object.entries(state).flatMap(([key, metas]) => metas.map((meta) => ({ userId: key, ref: meta.ref })));
      handlers.onPresenceChange?.(entries);
    });

    next.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commits', filter: `model_id=eq.${modelId}` }, (payload: RealtimePostgresChangesPayload<CommitNotification>) => {
      if (payload.eventType === 'INSERT') handlers.onCommit?.(payload.new);
    });

    next.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `model_id=eq.${modelId}` }, (payload: RealtimePostgresChangesPayload<CommentRow>) => {
      if (payload.eventType === 'INSERT') handlers.onCommentInsert?.(payload.new);
    });

    next.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'comments', filter: `model_id=eq.${modelId}` }, (payload: RealtimePostgresChangesPayload<CommentRow>) => {
      // `comments` has `replica identity full` (20260906240000_comments.sql),
      // so `old` is the complete previous row, not the partial the type
      // allows for a table without it — empty only if that ever changes.
      if (payload.eventType === 'UPDATE') handlers.onCommentUpdate?.(payload.new, Object.keys(payload.old).length > 0 ? (payload.old as CommentRow) : null);
    });

    next.subscribe((status) => {
      if (tornDown) return;
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        backoffMs = INITIAL_BACKOFF_MS;
        clearReconnectTimer();
        void next.track({ ref: currentRef });
        handlers.onResync?.();
      } else {
        // Only CHANNEL_ERROR, TIMED_OUT, and CLOSED remain once SUBSCRIBED is
        // excluded (REALTIME_SUBSCRIBE_STATES has exactly four members) —
        // every one of them means "not joined," so every one reconnects.
        scheduleReconnect();
      }
    });

    channel = next;
  }

  attach();
  const stopWatchingVisibility = onVisible(() => {
    attach();
  });

  return {
    setRef(ref: string) {
      currentRef = ref;
      if (channel) void channel.track({ ref: currentRef });
    },
    async unsubscribe() {
      tornDown = true;
      clearReconnectTimer();
      stopWatchingVisibility();
      if (channel) {
        await supabase.removeChannel(channel);
        channel = null;
      }
    },
  };
}

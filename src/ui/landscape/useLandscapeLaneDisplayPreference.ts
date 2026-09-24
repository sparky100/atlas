import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getUserPreferences, upsertUserPreferences } from '../../db/userPreferences';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

interface LaneDisplayState {
  collapsedLaneKeys: readonly string[];
  expandedLaneKeys: readonly string[];
  pinnedLaneKeys: readonly string[];
  hiddenLaneKeys: readonly string[];
}

const EMPTY_STATE: LaneDisplayState = { collapsedLaneKeys: [], expandedLaneKeys: [], pinnedLaneKeys: [], hiddenLaneKeys: [] };

export interface UseLandscapeLaneDisplayPreferenceResult extends LaneDisplayState {
  loading: boolean;
  /** Force a lane collapsed or expanded — mutually exclusive by construction (setting one direction always clears the other for the same key), per `layout.ts`'s own `isLaneCollapsed` tie-break comment. */
  setLaneCollapsed: (laneKey: string, collapsed: boolean) => void;
  /** Pin (append to the end of the pinned order) or unpin (remove) a lane. */
  setLanePinned: (laneKey: string, pinned: boolean) => void;
  /** Swap a pinned lane with its adjacent neighbour in the pin order; a no-op at either end. */
  reorderPinnedLane: (laneKey: string, direction: 'up' | 'down') => void;
  /** Hide or unhide a lane — independent of collapse/expand/pin, no mutual exclusion with either. */
  setLaneHidden: (laneKey: string, hidden: boolean) => void;
}

/**
 * V2 "landscape focus and filters", decision 1 (UI-principles.md §10):
 * per-lane collapse/expand and pin, remembered per user — same load-then-
 * write shape as `useLandscapeColourByPreference.ts`, just three arrays
 * instead of one enum. `undefined` (loading) → real arrays (`null` from
 * the DB reads as "nothing saved," i.e. the empty array) is the same
 * state machine that hook already uses.
 */
export function useLandscapeLaneDisplayPreference(userId: UUID | null): UseLandscapeLaneDisplayPreferenceResult {
  const [saved, setSaved] = useState<LaneDisplayState | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      setSaved(EMPTY_STATE);
      return;
    }
    let cancelled = false;
    getUserPreferences(supabase, userId)
      .then((row) => {
        if (!cancelled) {
          setSaved({
            collapsedLaneKeys: row?.landscape_collapsed_lane_keys ?? [],
            expandedLaneKeys: row?.landscape_expanded_lane_keys ?? [],
            pinnedLaneKeys: row?.landscape_pinned_lane_keys ?? [],
            hiddenLaneKeys: row?.landscape_hidden_lane_keys ?? [],
          });
        }
      })
      .catch((e: unknown) => {
        reportError("Couldn't load your saved lane display preferences.", e);
        if (!cancelled) setSaved(EMPTY_STATE);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loading = saved === undefined;
  const state = saved ?? EMPTY_STATE;

  const persist = useCallback(
    (next: LaneDisplayState) => {
      if (!userId) return;
      upsertUserPreferences(supabase, {
        userId,
        landscapeCollapsedLaneKeys: [...next.collapsedLaneKeys],
        landscapeExpandedLaneKeys: [...next.expandedLaneKeys],
        landscapePinnedLaneKeys: [...next.pinnedLaneKeys],
        landscapeHiddenLaneKeys: [...next.hiddenLaneKeys],
      }).catch(() => {
        // Best-effort, same stance as useLandscapeColourByPreference.ts's own setColourBy.
      });
    },
    [userId],
  );

  const setLaneCollapsed = useCallback(
    (laneKey: string, collapsed: boolean) => {
      setSaved((current) => {
        const base = current ?? EMPTY_STATE;
        const next: LaneDisplayState = collapsed
          ? { ...base, collapsedLaneKeys: [...new Set([...base.collapsedLaneKeys, laneKey])], expandedLaneKeys: base.expandedLaneKeys.filter((k) => k !== laneKey) }
          : { ...base, expandedLaneKeys: [...new Set([...base.expandedLaneKeys, laneKey])], collapsedLaneKeys: base.collapsedLaneKeys.filter((k) => k !== laneKey) };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setLanePinned = useCallback(
    (laneKey: string, pinned: boolean) => {
      setSaved((current) => {
        const base = current ?? EMPTY_STATE;
        const next: LaneDisplayState = { ...base, pinnedLaneKeys: pinned ? [...base.pinnedLaneKeys.filter((k) => k !== laneKey), laneKey] : base.pinnedLaneKeys.filter((k) => k !== laneKey) };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setLaneHidden = useCallback(
    (laneKey: string, hidden: boolean) => {
      setSaved((current) => {
        const base = current ?? EMPTY_STATE;
        const next: LaneDisplayState = { ...base, hiddenLaneKeys: hidden ? [...new Set([...base.hiddenLaneKeys, laneKey])] : base.hiddenLaneKeys.filter((k) => k !== laneKey) };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reorderPinnedLane = useCallback(
    (laneKey: string, direction: 'up' | 'down') => {
      setSaved((current) => {
        const base = current ?? EMPTY_STATE;
        const index = base.pinnedLaneKeys.indexOf(laneKey);
        const swapWith = direction === 'up' ? index - 1 : index + 1;
        if (index === -1 || swapWith < 0 || swapWith >= base.pinnedLaneKeys.length) return base;
        const reordered = [...base.pinnedLaneKeys];
        const a = reordered[index];
        const b = reordered[swapWith];
        if (a === undefined || b === undefined) return base;
        reordered[index] = b;
        reordered[swapWith] = a;
        const next: LaneDisplayState = { ...base, pinnedLaneKeys: reordered };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  return { ...state, loading, setLaneCollapsed, setLanePinned, reorderPinnedLane, setLaneHidden };
}

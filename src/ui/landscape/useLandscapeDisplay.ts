import { useEffect, useState } from 'react';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { reportError } from '../errors/errorBannerStore';
import { EMPTY_LANDSCAPE_FILTERS, filterLandscapeSystems, hasActiveLandscapeFilters, laneKeysBySystemId, type LandscapeFilters } from './landscapeFilter';
import { computeLandscapeGroups, type LandscapeGroups } from './landscapeGroups';
import { EMPTY_LANE_DISPLAY, groupSystemsByLane, type LandscapeLaneDisplayOptions, type LandscapeLayout } from './layout';
import { computeLandscapeLayoutInWorker } from './layoutWorkerClient';

/** The subset of `LandscapeData` (`useLandscape.ts`) this hook actually needs — named separately so this file doesn't import the whole hook just for its return type. */
export interface LandscapeDisplayInput {
  systemsById: Map<UUID, ElementsHeadRow>;
  actorsById: Map<UUID, ElementsHeadRow>;
  edges: readonly RelationshipsHeadRow[];
  supportsEdges: readonly RelationshipsHeadRow[];
  l1AncestorByCapabilityId: Map<UUID, ElementsHeadRow>;
}

export interface LandscapeDisplay {
  layout: LandscapeLayout;
  groups: LandscapeGroups;
}

export type LandscapeDisplayState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; display: LandscapeDisplay };

/**
 * V2 "landscape focus and filters": the layout/grouping half of what
 * `useLandscape.ts` used to compute inline in its own fetch effect —
 * pulled out here so a filter or a lane collapse/pin preference change can
 * recompute `layout`/`groups` (still off the main thread, via the same Web
 * Worker, UI-principles §8.6) from data `useLandscape` has *already
 * fetched*, with zero Supabase round trip. `useLandscape`'s own effect
 * dependency array stays exactly as it was — it never re-fetches for a
 * filter/lane-display change; only this hook's effect does anything.
 *
 * @param data `null` while `useLandscape` itself is loading/erroring/not
 * found — this hook then also reports `{ status: 'loading' }` and does
 * nothing further until real data arrives. Passing the same object
 * reference across renders (as `useLandscape`'s own `state.data` already
 * is, until it next reloads) is what keeps this effect from re-running on
 * every unrelated re-render — see `filters`/`laneDisplay`'s own doc below
 * for the same requirement on the caller's side.
 * @param filters Defaults to `EMPTY_LANDSCAPE_FILTERS` — a shared
 * constant, not a fresh object literal, for the identical "stable
 * reference or this effect never settles" reason.
 * @param laneDisplay Defaults to `EMPTY_LANE_DISPLAY`, the same shared
 * reference `layout.ts`'s own default parameter uses.
 * @param layoutWidthHint Threaded straight through to
 * `computeLandscapeLayoutInWorker` — see that function's own parameter
 * doc. This is where `useLandscape.ts`'s pre-V2 `layoutWidthHint`
 * parameter moved to, since layout computation now lives here.
 */
export function useLandscapeDisplay(
  data: LandscapeDisplayInput | null,
  filters: LandscapeFilters = EMPTY_LANDSCAPE_FILTERS,
  laneDisplay: LandscapeLaneDisplayOptions = EMPTY_LANE_DISPLAY,
  layoutWidthHint?: number,
): LandscapeDisplayState {
  const [state, setState] = useState<LandscapeDisplayState>({ status: 'loading' });

  useEffect(() => {
    if (!data) {
      setState({ status: 'loading' });
      return undefined;
    }
    const currentData = data;
    let cancelled = false;
    // Stale-while-revalidate: a filter, lane-pin/collapse, or width change
    // recomputes the layout, but there's nothing wrong with the layout
    // already on screen while that recompute runs — blanking it to
    // 'loading' unmounts the whole canvas+Inspector subtree gated on
    // `displayState.status === 'ready'` (`LandscapePage.tsx`), which reset
    // every currently-open filter facet (`LandscapeFilterBar.tsx`'s own
    // `<details>`) and the rest of the Inspector's own open/closed section
    // state on every single filter click — a real, reported bug. Only a
    // genuinely-empty state (nothing computed yet) shows 'loading'; a
    // recompute on top of an already-ready display keeps showing the
    // previous one until the new one lands.
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));

    async function compute(): Promise<void> {
      const allSystems = [...currentData.systemsById.values()];
      const allActors = [...currentData.actorsById.values()];
      const grouping = groupSystemsByLane(allSystems, currentData.supportsEdges, currentData.l1AncestorByCapabilityId);
      const systems = hasActiveLandscapeFilters(filters) ? filterLandscapeSystems(allSystems, filters, laneKeysBySystemId(grouping)) : allSystems;

      // UI-principles §8.6: layout runs off the main thread. Fresh every
      // computation — no saved position to merge in, for systems or
      // actors alike (Sprint U4-2b item 6's stance, unchanged by V2).
      const layout = await computeLandscapeLayoutInWorker(systems, currentData.supportsEdges, currentData.l1AncestorByCapabilityId, allActors, layoutWidthHint, laneDisplay);
      // Item 13's mobile-list classification — cheap enough (a handful of
      // Map operations) to run on the main thread, unlike `layout` itself.
      // Deliberately not lane-display-aware: the mobile list has no pixel
      // lanes to collapse and never had a per-lane collapse control of its
      // own (`landscapeGroups.ts`'s own module comment).
      const groups = computeLandscapeGroups(systems, currentData.supportsEdges, currentData.l1AncestorByCapabilityId, allActors, currentData.edges);
      if (!cancelled) setState({ status: 'ready', display: { layout, groups } });
    }

    compute().catch((e: unknown) => {
      reportError("Couldn't compute the landscape's layout.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to compute the layout' });
    });

    return () => {
      cancelled = true;
    };
  }, [data, filters, laneDisplay, layoutWidthHint]);

  return state;
}

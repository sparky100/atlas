import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listSupportsEdgesForCapabilities } from '../../db/capabilityMap';
import { getElementsByIds } from '../../db/elements';
import { lifecycleStateOf } from '../../engine/elementRead/fitAndExposure';
import type { ElementsHeadRow } from '../../contracts/rows';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

/** At most this many capabilities are read, so the lookups stay small (CLAUDE.md rule 8). */
const MAX_CAPABILITIES = 20;

/** Names of the active systems the live model records as supporting these capabilities. Read-only; `null` while loading. */
export function useEstateSuggestions(mainHeadCommitId: UUID | null, capabilityIds: readonly UUID[]): readonly string[] | null {
  const [names, setNames] = useState<readonly string[] | null>(null);
  const key = capabilityIds.join(',');
  useEffect(() => {
    if (!mainHeadCommitId || capabilityIds.length === 0) {
      setNames([]);
      return undefined;
    }
    const guard = { cancelled: false };
    void (async () => {
      try {
        const edges = await listSupportsEdgesForCapabilities(supabase, mainHeadCommitId, capabilityIds.slice(0, MAX_CAPABILITIES));
        const supporterIds = [...new Set(edges.map((e) => e.from_element_id))].slice(0, 50);
        const supporters = supporterIds.length > 0 ? await getElementsByIds(supabase, mainHeadCommitId, supporterIds) : new Map<UUID, ElementsHeadRow>();
        const now = new Date();
        const active = [...supporters.values()].filter((s) => lifecycleStateOf(s, supporters, now) === 'active').map((s) => s.name);
        if (!guard.cancelled) setNames(active);
      } catch (e) {
        reportError("Couldn't read what supports this.", e);
        if (!guard.cancelled) setNames([]);
      }
    })();
    return () => {
      guard.cancelled = true;
    };
    // `key` stands in for capabilityIds, a fresh array every render.
  }, [mainHeadCommitId, key]);
  return names;
}

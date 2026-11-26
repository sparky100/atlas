import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listSupportsEdgesForCapabilities } from '../../db/capabilityMap';
import { getElementsByIds } from '../../db/elements';
import { fitForPurposeOf, lifecycleStateOf, plannedEndOf } from '../../engine/elementRead/fitAndExposure';
import type { ElementsHeadRow } from '../../contracts/rows';
import { FIT_FOR_PURPOSE_ORDER } from '../../engine/elementRead/fitForPurpose';
import { attributesRecord } from '../../engine/elementRead/attributesRecord';
import type { EstateSupporter } from './estateUncertainty';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

/** At most this many capabilities are read, so the lookups stay small (CLAUDE.md rule 8). */
const MAX_CAPABILITIES = 20;

/** The active systems the live model records as supporting these capabilities, with what it records about each. Read-only; `null` while loading. */
export function useEstateSuggestions(mainHeadCommitId: UUID | null, capabilityIds: readonly UUID[]): readonly EstateSupporter[] | null {
  const [names, setNames] = useState<readonly EstateSupporter[] | null>(null);
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
        const active = [...supporters.values()]
          .filter((s) => lifecycleStateOf(s, supporters, now) === 'active')
          .map((s): EstateSupporter => {
            let fit: EstateSupporter['fit'] = null;
            let fitNote: string | null = null;
            for (const edge of edges) {
              if (edge.from_element_id !== s.element_id) continue;
              const rated = fitForPurposeOf(edge);
              if (rated === null || (fit !== null && FIT_FOR_PURPOSE_ORDER[rated] <= FIT_FOR_PURPOSE_ORDER[fit])) continue;
              fit = rated;
              const note = attributesRecord(edge.attributes).fitForPurposeNotes;
              fitNote = typeof note === 'string' && note.trim() !== '' ? note : null;
            }
            return { name: s.name, fit, fitNote, plannedEnd: plannedEndOf(s) };
          });
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

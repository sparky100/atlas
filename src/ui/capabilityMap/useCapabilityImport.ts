import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getMainBranch } from '../../db/branches';
import { getCapabilityMap, listCapabilityMapItems, listSeedableCapabilityMaps, type CapabilityMapRow } from '../../db/capabilityMapTemplates';
import { seedModelFromCapabilityMap } from '../../db/seedFromMap';
import { reportError } from '../errors/errorBannerStore';
import { invalidateModelHead } from '../query/invalidateModelHead';
import { supabase } from '../supabaseClient';

export type CapabilityImportStatus = 'loadingMaps' | 'idle' | 'seeding';

export interface UseCapabilityImportResult {
  status: CapabilityImportStatus;
  maps: CapabilityMapRow[];
  error: string | null;
  /** Seeds `modelId`'s (empty) main branch from `mapId` — the tailoring flow's "import" action. */
  importMap: (mapId: UUID) => Promise<void>;
}

export interface UseCapabilityImportInput {
  modelId: UUID;
  userId: UUID | null;
  onImported: () => void;
}

/**
 * The tailoring flow's "import" action (Sprint U2 step 2): lists the
 * seedable starter maps for the picker — published and draft alike since
 * Sprint U4-1 C6 ("draft maps are seedable into a model for review") —
 * then seeds the chosen one via atlas.seed_from_map (src/db/seedFromMap.ts).
 * Reachable whenever the map has no capabilities yet — an unresolvable
 * ref, or (the common case since ADR-018) main resolved fine but is still
 * just its genesis commit — gated in src/ui/routes/CapabilityMapPage.tsx;
 * `seed_from_map` itself re-checks the same "still at genesis" precondition
 * server-side regardless, along with the published-or-draft allowance.
 */
export function useCapabilityImport(input: UseCapabilityImportInput): UseCapabilityImportResult {
  const { modelId, userId, onImported } = input;
  const [status, setStatus] = useState<CapabilityImportStatus>('loadingMaps');
  const [maps, setMaps] = useState<CapabilityMapRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    listSeedableCapabilityMaps(supabase)
      .then((rows) => {
        if (!cancelled) {
          setMaps(rows);
          setStatus('idle');
        }
      })
      .catch((e: unknown) => {
        // S1 audit follow-up (item 15's own reportError rollout missed this
        // one): the initial-load half only, same "load vs. action" scoping
        // that rollout drew everywhere else — `importMap` below is a
        // mutation with its own local error display, left untouched.
        reportError("Couldn't load starter capability maps.", e);
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load starter capability maps.');
          setStatus('idle');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const importMap = useCallback(
    async (mapId: UUID) => {
      if (!userId) {
        setError('You must be signed in to import a capability map.');
        return;
      }
      setError(null);
      setStatus('seeding');

      try {
        const main = await getMainBranch(supabase, modelId);
        if (!main) throw new Error('main was not found for this model');
        const map = await getCapabilityMap(supabase, mapId);
        if (!map) throw new Error('This capability map no longer exists.');
        const items = await listCapabilityMapItems(supabase, mapId);

        const result = await seedModelFromCapabilityMap(supabase, {
          modelId,
          branchId: main.id,
          expectedHeadCommitId: main.head_commit_id,
          authorId: userId,
          capabilityMapId: mapId,
          sector: map.sector,
          version: map.version,
          items,
        });
        if (!result.ok) {
          setStatus('idle');
          setError(`Could not import: ${result.message}`);
          return;
        }

        setStatus('idle');
        // E8 item (1): seed_from_map always writes to main.
        void invalidateModelHead(queryClient, modelId);
        onImported();
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not import capability map.');
      }
    },
    [modelId, userId, onImported, queryClient],
  );

  return { status, maps, error, importMap };
}

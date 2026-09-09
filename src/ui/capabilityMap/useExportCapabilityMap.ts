import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { Sector } from '../../contracts/capabilityMapContent';
import { exportCapabilityMapAsDraft } from '../../db/exportCapabilityMap';
import { supabase } from '../supabaseClient';

export type ExportCapabilityMapStatus = 'idle' | 'exporting';

export interface UseExportCapabilityMapInput {
  modelId: UUID;
  modelName: string;
  orgName: string;
  orgSlug: string;
  modelSlug: string;
  userId: UUID | null;
}

export interface UseExportCapabilityMapResult {
  status: ExportCapabilityMapStatus;
  /** Result of the last successful export, once it's finished. Cleared on the next run. */
  message: string | null;
  error: string | null;
  exportAsDraft: (sector: Sector, version: number) => Promise<void>;
}

/**
 * Sprint U4-1 C6's owner-only "Export as starter map" action
 * (`ExportCapabilityMapAction.tsx`): builds the model's own capability
 * tree into starter-map content and writes it as a new `draft`
 * `capability_maps` row via `atlas.export_capability_map_as_draft` — the
 * one privileged path an authenticated session has into those tables at
 * all (they have no plain `authenticated` write grant, unlike ordinary
 * model data). The CLI (`pnpm content:export-capability-map`,
 * scripts/exportCapabilityMap.ts) does the same underlying export
 * (`src/db/exportCapabilityMap.ts`'s `buildCapabilityMapExport`) but
 * writes a real content file instead — this action's own result never
 * touches `content/capability-maps/`, since a running app has no
 * filesystem to write to.
 */
export function useExportCapabilityMap(input: UseExportCapabilityMapInput): UseExportCapabilityMapResult {
  const { modelId, modelName, orgName, orgSlug, modelSlug, userId } = input;
  const [status, setStatus] = useState<ExportCapabilityMapStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportAsDraft = useCallback(
    async (sector: Sector, version: number) => {
      if (!userId) {
        setError('You must be signed in to export a capability map.');
        return;
      }
      setError(null);
      setMessage(null);
      setStatus('exporting');

      try {
        const result = await exportCapabilityMapAsDraft(supabase, { modelId, modelName, orgName, orgSlug, modelSlug, sector, version });
        setStatus('idle');
        if (!result.ok) {
          setError(`Could not export: ${result.message}`);
          return;
        }
        setMessage(`Exported ${String(result.content.items.length)} item(s) as ${sector} v${String(version)} (draft) — seedable into a model for review from "Start from a capability map".`);
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not export capability map.');
      }
    },
    [modelId, modelName, orgName, orgSlug, modelSlug, userId],
  );

  return { status, message, error, exportAsDraft };
}

import { useCallback, useEffect, useState } from 'react';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { getElementsByIds } from '../../db/elements';
import { listLandscapeEdges, listSupportsEdgesForSystems, listSystemsForLandscape } from '../../db/landscape';
import { refParamOf, resolveRef, type Ref } from '../../db/ref';
import { clearViewLayouts, getOrCreateModelView, listViewLayouts, upsertViewLayouts } from '../../db/views';
import type { ViewRow } from '../../db/types';
import { computeLandscapeLayout, type LandscapeLayout } from './layout';
import { supabase } from '../supabaseClient';

export interface LandscapeData {
  commitId: UUID;
  view: ViewRow;
  systemsById: Map<UUID, ElementsHeadRow>;
  edges: RelationshipsHeadRow[];
  layout: LandscapeLayout;
}

export type LandscapeState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'refNotFound' } | { status: 'ready'; data: LandscapeData };

/**
 * Only the capabilities actually named by a `supports` edge are looked up
 * (for lane labels) — a system can support a sub-capability, not only a
 * root one, so this is driven by the edges found, not by walking the whole
 * capability tree.
 */
async function loadCapabilitiesById(commitId: UUID, supportsEdges: RelationshipsHeadRow[]): Promise<Map<UUID, ElementsHeadRow>> {
  const capabilityIds = [...new Set(supportsEdges.map((edge) => edge.to_element_id))];
  return getElementsByIds(supabase, commitId, capabilityIds);
}

export interface UseLandscapeResult {
  state: LandscapeState;
  /** UI-principles §6.4: deletes every `view_layouts` row for this view and re-runs auto-layout. */
  resetLayout: () => void;
}

/**
 * Loads the landscape's data and computes its layout, merging in any
 * previously-saved `view_layouts` positions and persisting whatever's newly
 * computed — so a second visit renders the same picture until someone
 * resets it (UI-principles §6.4).
 */
export function useLandscape(modelId: UUID, orgId: UUID, userId: UUID | null, ref: Ref): UseLandscapeResult {
  const [state, setState] = useState<LandscapeState>({ status: 'loading' });
  const [resetToken, setResetToken] = useState(0);
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!userId) return undefined;
    const currentUserId = userId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const commitId = await resolveRef(supabase, modelId, ref);
      if (!commitId) {
        if (!cancelled) setState({ status: 'refNotFound' });
        return;
      }

      const systems = await listSystemsForLandscape(supabase, commitId);
      const systemIds = systems.map((s) => s.element_id);
      const [edges, supportsEdges] = await Promise.all([listLandscapeEdges(supabase, commitId, systemIds), listSupportsEdgesForSystems(supabase, commitId, systemIds)]);
      const capabilitiesById = await loadCapabilitiesById(commitId, supportsEdges);

      const view = await getOrCreateModelView(supabase, { id: crypto.randomUUID(), orgId, modelId, kind: 'landscape', name: 'Landscape', createdBy: currentUserId });
      const savedLayout = await listViewLayouts(supabase, view.id);
      const savedById = new Map(
        savedLayout
          .filter((row): row is typeof row & { x: number; y: number } => row.x !== null && row.y !== null)
          .map((row) => [row.subject_id, row]),
      );

      const computed = computeLandscapeLayout(systems, supportsEdges, capabilitiesById);
      const nodes = computed.nodes.map((node) => {
        const saved = savedById.get(node.elementId);
        return saved ? { elementId: node.elementId, x: saved.x, y: saved.y } : node;
      });
      const layout: LandscapeLayout = { ...computed, nodes };

      const missing = computed.nodes.filter((node) => !savedById.has(node.elementId));
      if (missing.length > 0) {
        await upsertViewLayouts(
          supabase,
          missing.map((node) => ({ orgId, viewId: view.id, subjectType: 'element' as const, subjectId: node.elementId, x: node.x, y: node.y, updatedBy: currentUserId })),
        );
      }

      const systemsById = new Map(systems.map((s) => [s.element_id, s]));
      if (!cancelled) setState({ status: 'ready', data: { commitId, view, systemsById, edges, layout } });
    }

    load().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the landscape' });
    });

    return () => {
      cancelled = true;
    };
    // `ref`'s string form (`refParam`) is the real dependency, same pitfall
    // and same fix as useElementPage.ts — `ref` itself is read from the
    // closure, always the latest one.
  }, [modelId, orgId, userId, refParam, resetToken]);

  const resetLayout = useCallback(() => {
    setState((prev) => {
      if (prev.status === 'ready' && prev.data.view.id) {
        clearViewLayouts(supabase, prev.data.view.id)
          .catch(() => undefined)
          .finally(() => {
            setResetToken((t) => t + 1);
          });
      }
      return prev;
    });
  }, []);

  return { state, resetLayout };
}

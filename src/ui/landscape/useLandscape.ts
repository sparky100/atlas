import { useCallback, useEffect, useState } from 'react';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { resolveBranchModeProjection, projectionElementsByIds, projectionLandscapeEdges, projectionSupportsEdgesForSystems, projectionSystemsForLandscape } from '../../db/branchProjection';
import { listSupportsEdgesForCapabilities } from '../../db/capabilityMap';
import { getElementsByIds } from '../../db/elements';
import { listLandscapeEdges, listSupportsEdgesForSystems, listSystemsForLandscape } from '../../db/landscape';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import { clearViewLayouts, getOrCreateModelView, listViewLayouts, upsertViewLayouts } from '../../db/views';
import type { ViewMode } from '../../db/viewMode';
import type { VersionDiff } from '../../engine/versionDiff';
import type { ViewRow } from '../../db/types';
import type { LandscapeLayout } from './layout';
import { computeLandscapeLayoutInWorker } from './layoutWorkerClient';
import { supabase } from '../supabaseClient';

export interface LandscapeData {
  commitId: UUID;
  view: ViewRow;
  systemsById: Map<UUID, ElementsHeadRow>;
  edges: RelationshipsHeadRow[];
  layout: LandscapeLayout;
  /** Populated only when `ref` is a branch and `mode === 'diff'` (UI-principles §6.2/§6.3) — `null` for `main`/`tag`, and for `asIs`/`toBe`, where there's nothing to highlight against. */
  diff: VersionDiff | null;
}

/**
 * The systems supporting exactly `capabilityId` — the same exact-match
 * relationship a capability tile's own supporting-system count already
 * uses (src/ui/capabilityMap/metrics.ts's `supportingSystemIds`), so
 * "zoom into this tile's landscape" always shows exactly the systems the
 * tile's own count named, never a parent/child-aggregated superset. Only
 * meaningful against `main`/a tag — the capability filter is a director's-
 * door zoom affordance (§3.1), not part of the As-is/To-be/Diff selector,
 * so a branch ref never calls this (`capabilityId` is only ever passed by
 * LandscapePage when `ref.kind !== 'branch'`).
 */
async function loadSupportingSystemIds(commitId: UUID, capabilityId: UUID): Promise<Set<UUID>> {
  const edges = await listSupportsEdgesForCapabilities(supabase, commitId, [capabilityId]);
  return new Set(edges.map((edge) => edge.from_element_id));
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
 *
 * `capabilityId`, when given, is the "optional capability filter"
 * UI-principles §6.1's Landscape row itself names — *not* a separate view:
 * `scope_element_id` must be null for `landscape` (SPEC §3.9's own check
 * constraint), so a filtered landscape is still the model's one landscape
 * `views` row, just rendering a subset of its systems. Positions saved
 * under the unfiltered view are reused as-is for whichever of them are
 * currently in scope.
 *
 * Sprint C1: when `ref.kind === 'branch'`, this folds the branch's own
 * as-is/to-be state via the engine instead of querying `elements_head`/
 * `relationships_head` (SPEC §1 S-2: a change branch's head is never
 * materialised) — `src/db/branchProjection.ts`'s in-memory equivalents of
 * this hook's own main/tag queries, so the layout/grouping code below is
 * unchanged either way. `mode` is meaningless for `main`/`tag` (the As-is/
 * To-be/Diff control is hidden there, §6.2) and is only read for a branch.
 */
export function useLandscape(modelId: UUID, orgId: UUID, userId: UUID | null, ref: Ref, mode: ViewMode, capabilityId: UUID | null = null): UseLandscapeResult {
  const [state, setState] = useState<LandscapeState>({ status: 'loading' });
  const [resetToken, setResetToken] = useState(0);
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!userId) return undefined;
    const currentUserId = userId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      let commitId: UUID;
      let allSystems: ElementsHeadRow[];
      let branchId: UUID | null = null;
      let diff: VersionDiff | null = null;
      // Populated only for a branch ref, closed over below so every
      // downstream query (edges, supports, capability lookups) reads the
      // same folded state instead of re-resolving it per call.
      let systemsSource:
        | { edges: (systemIds: UUID[]) => RelationshipsHeadRow[]; supports: (systemIds: UUID[]) => RelationshipsHeadRow[]; byIds: (ids: UUID[]) => Map<UUID, ElementsHeadRow>; supportingSystemIds: (capId: UUID) => Set<UUID> }
        | undefined;

      if (ref.kind === 'branch') {
        const branch = await resolveBranchRef(supabase, ref);
        if (!branch) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        const resolved = await resolveBranchModeProjection(supabase, modelId, branch, mode);
        if (!resolved) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolved.commitId;
        branchId = branch.id;
        diff = resolved.diff;
        allSystems = projectionSystemsForLandscape(resolved.projection);
        systemsSource = {
          edges: (systemIds) => projectionLandscapeEdges(resolved.projection, systemIds),
          supports: (systemIds) => projectionSupportsEdgesForSystems(resolved.projection, systemIds),
          byIds: (ids) => projectionElementsByIds(resolved.projection, ids),
          supportingSystemIds: (capId) => new Set(resolved.projection.relationshipsHead.filter((r) => r.relationship_type === 'supports' && r.to_element_id === capId).map((r) => r.from_element_id)),
        };
      } else {
        const resolvedCommitId = await resolveRef(supabase, modelId, ref);
        if (!resolvedCommitId) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolvedCommitId;
        allSystems = await listSystemsForLandscape(supabase, commitId);
      }

      const supportingIds = capabilityId ? (systemsSource ? systemsSource.supportingSystemIds(capabilityId) : await loadSupportingSystemIds(commitId, capabilityId)) : null;
      const systems = supportingIds ? allSystems.filter((s) => supportingIds.has(s.element_id)) : allSystems;
      const systemIds = systems.map((s) => s.element_id);
      const [edges, supportsEdges] = systemsSource
        ? [systemsSource.edges(systemIds), systemsSource.supports(systemIds)]
        : await Promise.all([listLandscapeEdges(supabase, commitId, systemIds), listSupportsEdgesForSystems(supabase, commitId, systemIds)]);
      const capabilitiesById = systemsSource
        ? systemsSource.byIds([...new Set(supportsEdges.map((edge) => edge.to_element_id))])
        : await loadCapabilitiesById(commitId, supportsEdges);

      const view = await getOrCreateModelView(supabase, { id: crypto.randomUUID(), orgId, modelId, kind: 'landscape', name: 'Landscape', createdBy: currentUserId, branchId });
      const savedLayout = await listViewLayouts(supabase, view.id);
      const savedById = new Map(
        savedLayout
          .filter((row): row is typeof row & { x: number; y: number } => row.x !== null && row.y !== null)
          .map((row) => [row.subject_id, row]),
      );

      // UI-principles §8.6: layout runs off the main thread.
      const computed = await computeLandscapeLayoutInWorker(systems, supportsEdges, capabilitiesById);
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
      if (!cancelled) setState({ status: 'ready', data: { commitId, view, systemsById, edges, layout, diff } });
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
  }, [modelId, orgId, userId, refParam, mode, resetToken, capabilityId]);

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

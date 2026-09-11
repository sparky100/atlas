import { useEffect, useState } from 'react';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { resolveBranchModeProjection, projectionActorsForLandscape, projectionElementsByIds, projectionLandscapeEdges, projectionSupportsEdgesForSystems, projectionSystemsForLandscape } from '../../db/branchProjection';
import { listSupportsEdgesForCapabilities } from '../../db/capabilityMap';
import { getElementsByIds } from '../../db/elements';
import { listActorsForLandscape, listLandscapeEdges, listSupportsEdgesForSystems, listSystemsForLandscape } from '../../db/landscape';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import { getOrCreateModelView } from '../../db/views';
import type { ViewMode } from '../../db/viewMode';
import type { VersionDiff } from '../../engine/versionDiff';
import type { ViewRow } from '../../db/types';
import { l1AncestorOf, loadCapabilityAncestry } from '../elements/capabilityDepth';
import { computeLandscapeGroups, type LandscapeGroups } from './landscapeGroups';
import type { LandscapeLayout } from './layout';
import { computeLandscapeLayoutInWorker } from './layoutWorkerClient';
import { supabase } from '../supabaseClient';

export interface LandscapeData {
  commitId: UUID;
  view: ViewRow;
  systemsById: Map<UUID, ElementsHeadRow>;
  /** Landscape canvas, structural (item 3) — every Actor at this commit, keyed for `LandscapeCanvas.tsx`'s own actor-row render, the same shape `systemsById` already has. */
  actorsById: Map<UUID, ElementsHeadRow>;
  edges: RelationshipsHeadRow[];
  layout: LandscapeLayout;
  /** Sprint U4-2b item 13: the same systems/actors, grouped for the <768px list renderer (`LandscapeMobileList.tsx`) instead of laid out in pixels — computed once here, alongside `layout`, from the exact same inputs, rather than re-derived from `layout`'s own pixel output. */
  groups: LandscapeGroups;
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
 * Every capability actually named by a `supports` edge, mapped to its own
 * level-1 ancestor (Sprint U4-1 B4: "lanes are level-1 capabilities only;
 * every supports rolls up to its level-1 ancestor via parent_id") — driven
 * by the edges found, not by walking the whole capability tree, since a
 * system can support a sub-capability at any depth. `byIds` abstracts over
 * this hook's two sources (a real round trip for `main`/a tag, the branch
 * projection's own in-memory lookup for a branch ref) the same way the
 * rest of this file already does.
 */
async function loadL1AncestorByCapabilityId(
  byIds: (ids: readonly UUID[]) => Promise<Map<UUID, ElementsHeadRow>>,
  supportsEdges: readonly RelationshipsHeadRow[],
): Promise<Map<UUID, ElementsHeadRow>> {
  const capabilityIds = [...new Set(supportsEdges.map((edge) => edge.to_element_id))];
  const leaves = await byIds(capabilityIds);
  const ancestry = await loadCapabilityAncestry(byIds, leaves);
  const l1ByCapabilityId = new Map<UUID, ElementsHeadRow>();
  for (const id of capabilityIds) {
    const l1 = l1AncestorOf(id, ancestry);
    if (l1) l1ByCapabilityId.set(id, l1);
  }
  return l1ByCapabilityId;
}

export interface UseLandscapeResult {
  state: LandscapeState;
}

/**
 * Loads the landscape's data and computes its layout fresh every time
 * (Sprint U4-2b item 6, UI-principles §6.4): no `view_layouts` read or
 * write for the landscape kind any more, and no "Reset layout" action to
 * go with it — auto-layout runs on every open, full stop. The algorithm is
 * already deterministic for the same query result (`layout.ts`'s own
 * module comment — CLAUDE.md rule 6), so two people still see the same
 * picture; what's gone is the old "first visit's layout wins until
 * someone resets it" persistence, which bought nothing a deterministic
 * algorithm doesn't already give for free, at the cost of a stale picture
 * after the model itself changed shape. A drag (there is no per-node drag
 * gesture built yet — only the canvas-wide pan `LandscapeCanvas.tsx`
 * implements) would be session-only state in that component if one is
 * ever added, never written back here.
 *
 * `capabilityId`, when given, is the "optional capability filter"
 * UI-principles §6.1's Landscape row itself names — *not* a separate view:
 * `scope_element_id` must be null for `landscape` (SPEC §3.9's own check
 * constraint), so a filtered landscape is still the model's one landscape
 * `views` row, just rendering a subset of its systems.
 *
 * Sprint C1: when `ref.kind === 'branch'`, this folds the branch's own
 * as-is/to-be state via the engine instead of querying `elements_head`/
 * `relationships_head` (SPEC §1 S-2: a change branch's head is never
 * materialised) — `src/db/branchProjection.ts`'s in-memory equivalents of
 * this hook's own main/tag queries, so the layout/grouping code below is
 * unchanged either way. `mode` is meaningless for `main`/`tag` (the As-is/
 * To-be/Diff control is hidden there, §6.2) and is only read for a branch.
 */
export function useLandscape(
  modelId: UUID | null,
  orgId: UUID | null,
  userId: UUID | null,
  ref: Ref,
  mode: ViewMode,
  capabilityId: UUID | null = null,
  /**
   * Sprint U4-2a item 2 ("main-branch lookup once per route, shared"): the
   * caller's own already-fetched `main` head. `LandscapePage` already calls
   * `useMainBranch` itself (for its own search-pool/canAdd logic) — without
   * this, `ref.kind === 'main'` (the common case: no `?ref=` at all) meant
   * this hook *also* resolved the exact same row itself via `resolveRef`, a
   * second identical `branches?...kind=eq.main` request racing the first
   * one on every load, confirmed live via the network log.
   *
   * For a `main` ref this hook now *waits* for the hint rather than falling
   * back to its own `resolveRef` when it's momentarily absent (its own
   * effect comment explains why: racing the two would occasionally still
   * dedupe correctly, but just as often mean the hint arriving a beat later
   * re-triggers this whole effect — a duplicate full landscape load, worse
   * than the duplicate branch-row request this was meant to remove).
   * Meaningless for `tag:`/`commit:`/`branch:` refs (there's no `main` row
   * in play) — `null` there is the only ever value and never blocks them.
   */
  mainCommitIdHint: UUID | null = null,
  /**
   * Item 7: the canvas's own on-screen width at layout time — `LandscapePage.tsx`'s
   * `useCanvasWidth` measurement of `<main>`, passed straight through to
   * `computeLandscapeLayoutInWorker`/`computeLandscapeLayout` (their own
   * parameter doc has the full reasoning). `undefined` (no measurement
   * yet, e.g. the very first render before the `ResizeObserver` fires)
   * means "use the floor" there, same as omitting it entirely.
   */
  layoutWidthHint?: number,
): UseLandscapeResult {
  const [state, setState] = useState<LandscapeState>({ status: 'loading' });
  const refParam = refParamOf(ref);

  useEffect(() => {
    // Sprint U4-2a item 2's resolved-model gate: `modelId`/`orgId` used to
    // be typed as plain `UUID`, which just meant every caller fed this
    // `model?.id ?? ''` (LandscapePage.tsx's own fix, alongside
    // useBreadcrumbElement.ts) rather than the `?? null` convention every
    // other model-scoped hook uses — this effect never checked them, so it
    // ran `resolveRef(supabase, '', ref)` on the render before the page's
    // own model resolved. Gating here means the effect (and every child
    // hook downstream of `state`) simply doesn't run yet, rather than
    // running once with a hollow id and once for real.
    if (!userId || !modelId || !orgId) return undefined;
    // Wait for the caller's own main-branch fetch rather than racing it:
    // if this fired its own `resolveRef` in parallel with the caller's
    // `useMainBranch` (as it used to, unconditionally) and only used the
    // hint when it happened to already be there, the hint arriving a beat
    // later would change this effect's own dependencies and re-run the
    // *entire* load a second time — trading one small duplicate branch-row
    // request for a duplicate full landscape load, worse than the bug this
    // was meant to fix. Waiting means this effect runs exactly once for a
    // `main` ref, using the caller's already-resolved commit id.
    if (ref.kind === 'main' && !mainCommitIdHint) return undefined;
    const currentModelId = modelId;
    const currentOrgId = orgId;
    const currentUserId = userId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      let commitId: UUID;
      let allSystems: ElementsHeadRow[];
      let allActors: ElementsHeadRow[];
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
        const resolved = await resolveBranchModeProjection(supabase, currentModelId, branch, mode);
        if (!resolved) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolved.commitId;
        branchId = branch.id;
        diff = resolved.diff;
        allSystems = projectionSystemsForLandscape(resolved.projection);
        allActors = projectionActorsForLandscape(resolved.projection);
        systemsSource = {
          edges: (systemIds) => projectionLandscapeEdges(resolved.projection, systemIds),
          supports: (systemIds) => projectionSupportsEdgesForSystems(resolved.projection, systemIds),
          byIds: (ids) => projectionElementsByIds(resolved.projection, ids),
          supportingSystemIds: (capId) => new Set(resolved.projection.relationshipsHead.filter((r) => r.relationship_type === 'supports' && r.to_element_id === capId).map((r) => r.from_element_id)),
        };
      } else if (ref.kind === 'main' && mainCommitIdHint) {
        // Shared lookup: the caller already resolved `main`, so skip this
        // hook's own `resolveRef` round trip entirely — see this
        // parameter's own doc comment above. Everything past the commit id
        // itself (systems/actors) is unique to this hook, same as the
        // fallback branch below.
        commitId = mainCommitIdHint;
        [allSystems, allActors] = await Promise.all([listSystemsForLandscape(supabase, commitId), listActorsForLandscape(supabase, commitId)]);
      } else {
        const resolvedCommitId = await resolveRef(supabase, currentModelId, ref);
        if (!resolvedCommitId) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolvedCommitId;
        [allSystems, allActors] = await Promise.all([listSystemsForLandscape(supabase, commitId), listActorsForLandscape(supabase, commitId)]);
      }

      const supportingIds = capabilityId ? (systemsSource ? systemsSource.supportingSystemIds(capabilityId) : await loadSupportingSystemIds(commitId, capabilityId)) : null;
      const systems = supportingIds ? allSystems.filter((s) => supportingIds.has(s.element_id)) : allSystems;
      const systemIds = systems.map((s) => s.element_id);
      const [edges, supportsEdges] = systemsSource
        ? [systemsSource.edges(systemIds), systemsSource.supports(systemIds)]
        : await Promise.all([listLandscapeEdges(supabase, commitId, systemIds), listSupportsEdgesForSystems(supabase, commitId, systemIds)]);
      const byIds: (ids: readonly UUID[]) => Promise<Map<UUID, ElementsHeadRow>> = systemsSource ? (ids) => Promise.resolve(systemsSource.byIds([...ids])) : (ids) => getElementsByIds(supabase, commitId, ids);
      const l1AncestorByCapabilityId = await loadL1AncestorByCapabilityId(byIds, supportsEdges);

      // Still recorded (ADR-011: "a view is a saved query") — just never
      // consulted for layout any more (item 6). `getOrCreateScopedView`'s
      // own module comment names capability_map's identical stance.
      const view = await getOrCreateModelView(supabase, { id: crypto.randomUUID(), orgId: currentOrgId, modelId: currentModelId, kind: 'landscape', name: 'Landscape', createdBy: currentUserId, branchId });

      // UI-principles §8.6: layout runs off the main thread. Fresh every
      // load (item 6) — no saved position to merge in, for systems or
      // actors alike.
      const layout: LandscapeLayout = await computeLandscapeLayoutInWorker(systems, supportsEdges, l1AncestorByCapabilityId, allActors, layoutWidthHint);

      const systemsById = new Map(systems.map((s) => [s.element_id, s]));
      const actorsById = new Map(allActors.map((a) => [a.element_id, a]));
      // Item 13: the same classification `computeLandscapeLayoutInWorker`
      // used for pixel placement, without any of the pixel math — cheap
      // enough (a handful of Map operations) to run on the main thread,
      // unlike `layout` itself.
      const groups = computeLandscapeGroups(systems, supportsEdges, l1AncestorByCapabilityId, allActors, edges);
      if (!cancelled) setState({ status: 'ready', data: { commitId, view, systemsById, actorsById, edges, layout, groups, diff } });
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
  }, [modelId, orgId, userId, refParam, mode, capabilityId, mainCommitIdHint, layoutWidthHint]);

  return { state };
}

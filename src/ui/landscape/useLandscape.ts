import { useEffect, useState } from 'react';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import {
  resolveBranchModeProjection,
  projectionActorsForLandscape,
  projectionContainersForLandscape,
  projectionElementsByIds,
  projectionLandscapeEdges,
  projectionSupportsEdgesForSystems,
  projectionSystemsForLandscape,
} from '../../db/branchProjection';
import { getElementsByIds } from '../../db/elements';
import { listActorsForLandscape, listContainersForLandscape, listLandscapeEdges, listSupportsEdgesForSystems, listSystemsForLandscape } from '../../db/landscape';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import { getOrCreateModelView } from '../../db/views';
import type { ViewMode } from '../../db/viewMode';
import type { VersionDiff } from '../../engine/versionDiff';
import type { ViewRow } from '../../db/types';
import { l1AncestorOf, loadCapabilityAncestry } from '../elements/capabilityDepth';
import { isPlatform } from '../elements/systemKind';
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
 * `enabled` (Sprint U4-2c item 2): `false` skips this effect entirely,
 * leaving `state` at `{ status: 'loading' }` forever — `LandscapePage.tsx`
 * passes `capabilityId === null` here, since the capability-scoped flat
 * list (`useCapabilityLandscape.ts`) replaces this hook's own lane-based
 * canvas/mobile-list rendering outright whenever `?capability=` is set
 * (never both at once), and there'd be nothing to gain from this hook's own
 * network round trips and worker layout running for a view that will never
 * render. `useLandscape` itself has no capability filter of its own any
 * more for the identical reason — the old exact-match filter this
 * parameter used to gate is `useCapabilityLandscape.ts`'s job now, rolled
 * up through descendant capabilities rather than an exact match.
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
  /** See this function's own doc comment above. */
  enabled: boolean,
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
    if (!userId || !modelId || !orgId || !enabled) return undefined;
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
      let allContainers: ElementsHeadRow[];
      let branchId: UUID | null = null;
      let diff: VersionDiff | null = null;
      // Populated only for a branch ref, closed over below so every
      // downstream query (edges, supports, capability lookups) reads the
      // same folded state instead of re-resolving it per call.
      let systemsSource: { edges: (systemIds: UUID[]) => RelationshipsHeadRow[]; supports: (systemIds: UUID[]) => RelationshipsHeadRow[]; byIds: (ids: UUID[]) => Map<UUID, ElementsHeadRow> } | undefined;

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
        allContainers = projectionContainersForLandscape(resolved.projection);
        systemsSource = {
          edges: (systemIds) => projectionLandscapeEdges(resolved.projection, systemIds),
          supports: (systemIds) => projectionSupportsEdgesForSystems(resolved.projection, systemIds),
          byIds: (ids) => projectionElementsByIds(resolved.projection, ids),
        };
      } else if (ref.kind === 'main' && mainCommitIdHint) {
        // Shared lookup: the caller already resolved `main`, so skip this
        // hook's own `resolveRef` round trip entirely — see this
        // parameter's own doc comment above. Everything past the commit id
        // itself (systems/actors) is unique to this hook, same as the
        // fallback branch below.
        commitId = mainCommitIdHint;
        [allSystems, allActors, allContainers] = await Promise.all([
          listSystemsForLandscape(supabase, commitId),
          listActorsForLandscape(supabase, commitId),
          listContainersForLandscape(supabase, commitId),
        ]);
      } else {
        const resolvedCommitId = await resolveRef(supabase, currentModelId, ref);
        if (!resolvedCommitId) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolvedCommitId;
        [allSystems, allActors, allContainers] = await Promise.all([
          listSystemsForLandscape(supabase, commitId),
          listActorsForLandscape(supabase, commitId),
          listContainersForLandscape(supabase, commitId),
        ]);
      }

      // "Platforms and modules": a platform's own module (Container)
      // children get their own landscape tile, placed by their own
      // `supports` edge — folded into `allSystems` right here so every
      // downstream step (edge/supports fetch, layout, groups) already
      // treats a module exactly like a system, with no changes needed to
      // any of them. Label composed as "Platform · Module" (a shallow
      // copy — never mutates the loaded row) — the prompt's own tile text;
      // the link target and lane placement both still key off the module's
      // own `element_id`.
      const platformsById = new Map(allSystems.filter((s) => isPlatform(s)).map((s) => [s.element_id, s]));
      const moduleNodes: ElementsHeadRow[] = [];
      for (const container of allContainers) {
        const platform = container.parent_id !== null ? platformsById.get(container.parent_id) : undefined;
        if (platform) moduleNodes.push({ ...container, name: `${platform.name} · ${container.name}` });
      }
      if (moduleNodes.length > 0) allSystems = [...allSystems, ...moduleNodes];

      const systemIds = allSystems.map((s) => s.element_id);
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
      const layout: LandscapeLayout = await computeLandscapeLayoutInWorker(allSystems, supportsEdges, l1AncestorByCapabilityId, allActors, layoutWidthHint);

      const systemsById = new Map(allSystems.map((s) => [s.element_id, s]));
      const actorsById = new Map(allActors.map((a) => [a.element_id, a]));
      // Item 13: the same classification `computeLandscapeLayoutInWorker`
      // used for pixel placement, without any of the pixel math — cheap
      // enough (a handful of Map operations) to run on the main thread,
      // unlike `layout` itself.
      const groups = computeLandscapeGroups(allSystems, supportsEdges, l1AncestorByCapabilityId, allActors, edges);
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
  }, [modelId, orgId, userId, refParam, mode, enabled, mainCommitIdHint, layoutWidthHint]);

  return { state };
}

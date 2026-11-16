import { useEffect, useState } from 'react';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import {
  projectionActorsForLandscape,
  projectionContainersForLandscape,
  projectionElementsByIds,
  projectionLandscapeEdges,
  projectionOwnsEdgesForSystems,
  projectionSupportsEdgesForSystems,
  projectionSystemsForLandscape,
} from '../../db/branchProjection';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import { filterLandscapeEdges, filterOwnsEdgesForSystems, filterSupportsEdgesForSystems, listActorsForLandscape, listAllLandscapeEdgeRows, listAllOwnsEdgeRows, listAllSupportsEdgeRows, listContainersForLandscape, listSystemsForLandscape } from '../../db/landscape';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import { getOrCreateModelView } from '../../db/views';
import type { ViewMode } from '../../db/viewMode';
import { loadPlannedFuture, type PlannedFuture } from '../../db/plannedFuture';
import { cloneHead } from '../../engine/deltas';
import { lifecycleStateOf } from '../../engine/elementRead/fitAndExposure';
import { serializeHeadProjection, type HeadProjection } from '../../engine/projection';
import { computeVersionDiff, type VersionDiff } from '../../engine/versionDiff';
import type { ViewRow } from '../../db/types';
import { loadHeadAtCommitCached, resolveBranchModeProjectionCached } from '../query/cachedBranchProjection';
import { todayIsoDate } from './asAt';
import { l1AncestorOf, loadCapabilityAncestry } from '../elements/capabilityDepth';
import { moduleDisplayName } from '../elements/moduleDisplayName';
import { isIntegrationPlatform, isPlatform } from '../elements/systemKind';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface LandscapeData {
  commitId: UUID;
  view: ViewRow;
  systemsById: Map<UUID, ElementsHeadRow>;
  /** ADR-026: each interface (a container of an integration platform) mapped to its platform — a flow `via` an interface routes through, and highlights with, the platform's tile. */
  platformIdByInterfaceId: Map<UUID, UUID>;
  /** Landscape canvas, structural (item 3) — every Actor at this commit, keyed for `LandscapeCanvas.tsx`'s own actor-row render, the same shape `systemsById` already has. */
  actorsById: Map<UUID, ElementsHeadRow>;
  edges: RelationshipsHeadRow[];
  /**
   * V2 "landscape focus and filters": this hook used to compute `layout`/
   * `groups` itself, right here, from these two plus `systemsById`/
   * `actorsById` above. Now it just fetches and exposes the raw inputs —
   * `useLandscapeDisplay.ts` is the one that calls `computeLandscapeLayout`/
   * `computeLandscapeGroups` (still off the main thread, via the same Web
   * Worker), so it can recompute both whenever a filter or a lane collapse/
   * pin preference changes, from data already sitting here, with no
   * Supabase round trip — this hook's own effect (and its dependency array)
   * stays exactly as it was, deliberately unaware any of that exists.
   */
  supportsEdges: RelationshipsHeadRow[];
  /** V2b's Inspector panel, Selection section's own "owners by role" — `owns` edges targeting a system at this commit, same "raw input, fetched once here" shape as `supportsEdges` above. */
  ownsEdges: RelationshipsHeadRow[];
  l1AncestorByCapabilityId: Map<UUID, ElementsHeadRow>;
  /** Populated only when `ref` is a branch and `mode === 'diff'` (UI-principles §6.2/§6.3) — `null` for `main`/`tag`, and for `asIs`/`toBe`, where there's nothing to highlight against. */
  diff: VersionDiff | null;
  /** Populated only for a view "as at" a future date (`asAt`): what was laid on, what was left out, and what the date leaves without a system. `null` for today. */
  future: PlannedFuture | null;
  /** How many systems and modules today's picture leaves out because they are not live yet (planned) or are past their end (retired). Always zero for a change branch or a future date, which show them on purpose. */
  hiddenByDate: { planned: number; retired: number };
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
 * Loads the landscape's raw data fresh every time (Sprint U4-2b item 6,
 * UI-principles §6.4): no `view_layouts` read or write for the landscape
 * kind any more, and no "Reset layout" action to go with it. Layout itself
 * is no longer computed here (V2 "landscape focus and filters" — see
 * `LandscapeData`'s own comment) — `useLandscapeDisplay.ts` derives it from
 * this hook's output, fresh, every time it's asked, off the same
 * deterministic algorithm (`layout.ts`'s own module comment — CLAUDE.md
 * rule 6), so two people still see the same picture for the same filters/
 * lane state. A drag (there is no per-node drag gesture built yet — only
 * the canvas-wide pan `LandscapeCanvas.tsx` implements) would be
 * session-only state in that component if one is ever added, never written
 * back here.
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
  /** "View as at": a future ISO date (`asat.ts`'s `parseAsAtParam`), main only — `null` is today. A change-branch ref has its own As-is/To-be/Diff control, so this is ignored for one. */
  asAt: string | null = null,
  /** With `asAt`: mark what differs from today (added/removed/changed), using the same diff styling as a change's Diff mode. */
  highlightChanges = true,
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
    const futureAsAt = ref.kind === 'main' ? asAt : null;
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
      let future: PlannedFuture | null = null;
      // Populated only for `main`/a tag: everything that needs just the
      // commit id, fetched in ONE parallel round (it used to be three
      // dependent rounds — lists, then edges, then capability ancestors —
      // plus the saved-view lookup after all of those). Edge rows are
      // fetched whole and narrowed in memory below (CLAUDE.md rule 8's
      // shape); the capability list gives every level-1 ancestor without
      // the old per-level lookups.
      let commitScope:
        | { edgeRows: RelationshipsHeadRow[]; supportsRows: RelationshipsHeadRow[]; ownsRows: RelationshipsHeadRow[]; capabilities: ElementsHeadRow[]; view: ViewRow }
        | undefined;
      const loadCommitScope = async (commit: UUID): Promise<[ElementsHeadRow[], ElementsHeadRow[], ElementsHeadRow[]]> => {
        const [systems, actors, containers, edgeRows, supportsRows, ownsRows, capabilities, view] = await Promise.all([
          listSystemsForLandscape(supabase, commit),
          listActorsForLandscape(supabase, commit),
          listContainersForLandscape(supabase, commit),
          listAllLandscapeEdgeRows(supabase, commit),
          listAllSupportsEdgeRows(supabase, commit),
          listAllOwnsEdgeRows(supabase, commit),
          listCapabilitiesForMap(supabase, commit),
          getOrCreateModelView(supabase, { id: crypto.randomUUID(), orgId: currentOrgId, modelId: currentModelId, kind: 'landscape', name: 'Landscape', createdBy: currentUserId, branchId: null }),
        ]);
        commitScope = { edgeRows, supportsRows, ownsRows, capabilities, view };
        return [systems, actors, containers];
      };
      // Populated only for a branch ref, closed over below so every
      // downstream query (edges, supports, capability lookups) reads the
      // same folded state instead of re-resolving it per call.
      let systemsSource:
        | { edges: (systemIds: UUID[], actorIds: UUID[]) => RelationshipsHeadRow[]; supports: (systemIds: UUID[]) => RelationshipsHeadRow[]; owns: (systemIds: UUID[]) => RelationshipsHeadRow[]; byIds: (ids: UUID[]) => Map<UUID, ElementsHeadRow> }
        | undefined;

      // A folded projection (a change branch's, or the planned future) stands in for the head tables: every query below reads it in memory.
      const projectionLists = (projection: HeadProjection): [ElementsHeadRow[], ElementsHeadRow[], ElementsHeadRow[]] => [
        projectionSystemsForLandscape(projection),
        projectionActorsForLandscape(projection),
        projectionContainersForLandscape(projection),
      ];
      const projectionSource = (projection: HeadProjection): NonNullable<typeof systemsSource> => ({
        edges: (systemIds, actorIds) => projectionLandscapeEdges(projection, systemIds, actorIds),
        supports: (systemIds) => projectionSupportsEdgesForSystems(projection, systemIds),
        owns: (systemIds) => projectionOwnsEdgesForSystems(projection, systemIds),
        byIds: (ids) => projectionElementsByIds(projection, ids),
      });

      if (ref.kind === 'branch') {
        const branch = await resolveBranchRef(supabase, ref);
        if (!branch) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        const resolved = await resolveBranchModeProjectionCached(supabase, currentModelId, branch, mode);
        if (!resolved) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolved.commitId;
        branchId = branch.id;
        diff = resolved.diff;
        [allSystems, allActors, allContainers] = projectionLists(resolved.projection);
        systemsSource = projectionSource(resolved.projection);
      } else if (ref.kind === 'main' && mainCommitIdHint && futureAsAt !== null && futureAsAt > todayIsoDate()) {
        // View as at a future date: today's head with the planned changes that land by then laid on top (`engine/plannedFuture.ts`). Read-only — nothing is stored.
        commitId = mainCommitIdHint;
        future = await loadPlannedFuture(supabase, currentModelId, mainCommitIdHint, futureAsAt, todayIsoDate(), (c) => loadHeadAtCommitCached(supabase, currentModelId, c));
        let renderHead = future.head;
        if (highlightChanges) {
          // Same as a change's Diff mode: what the date removes stays on the canvas, ghosted; what it adds or changes is marked.
          diff = computeVersionDiff(future.today, future.head);
          renderHead = cloneHead(future.head);
          for (const e of diff.elements) if (e.state === 'removed' && e.asIs) renderHead.elements.set(e.elementId, e.asIs);
          for (const r of diff.relationships) if (r.state === 'removed' && r.asIs) renderHead.relationships.set(r.relationshipId, r.asIs);
        }
        const futureProjection = serializeHeadProjection(renderHead);
        [allSystems, allActors, allContainers] = projectionLists(futureProjection);
        systemsSource = projectionSource(futureProjection);
      } else if (ref.kind === 'main' && mainCommitIdHint) {
        // Shared lookup: the caller already resolved `main`, so skip this
        // hook's own `resolveRef` round trip entirely — see this
        // parameter's own doc comment above. Everything past the commit id
        // itself (systems/actors) is unique to this hook, same as the
        // fallback branch below.
        commitId = mainCommitIdHint;
        [allSystems, allActors, allContainers] = await loadCommitScope(commitId);
      } else {
        const resolvedCommitId = await resolveRef(supabase, currentModelId, ref);
        if (!resolvedCommitId) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolvedCommitId;
        [allSystems, allActors, allContainers] = await loadCommitScope(commitId);
      }

      // Today's picture (main or a tag) shows what is live today: a planned system doesn't exist until its Introduced date, and a retired one is gone — and so are the links to either (`engine/elementRead/fitAndExposure.ts`). A change branch and a future date show them on purpose.
      const hiddenByDate = { planned: 0, retired: 0 };
      if (ref.kind !== 'branch' && futureAsAt === null) {
        const now = new Date();
        const datedById = new Map([...allSystems, ...allContainers].map((e) => [e.element_id, e]));
        const live = (e: ElementsHeadRow): boolean => {
          const state = lifecycleStateOf(e, datedById, now);
          if (state === 'active') return true;
          hiddenByDate[state] += 1;
          return false;
        };
        allSystems = allSystems.filter(live);
        allContainers = allContainers.filter(live);
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
        const platform = container.parent_id !== null ? (platformsById.get(container.parent_id) ?? null) : null;
        if (platform) moduleNodes.push({ ...container, name: moduleDisplayName(container, platform) });
      }
      if (moduleNodes.length > 0) allSystems = [...allSystems, ...moduleNodes];
      const integrationPlatformIds = new Set(allSystems.filter((s) => s.element_type === 'system' && isIntegrationPlatform(s)).map((s) => s.element_id));
      const platformIdByInterfaceId = new Map(allContainers.flatMap((c) => (c.parent_id !== null && integrationPlatformIds.has(c.parent_id) ? [[c.element_id, c.parent_id] as const] : [])));

      const systemIds = allSystems.map((s) => s.element_id);
      // S1 item 11a: an actor's own `uses` edge to a system needs the
      // actor's id in this fetch's own endpoint set too, or it's silently
      // dropped the way a systems-only fetch always used to.
      const actorIds = allActors.map((a) => a.element_id);
      let edges: RelationshipsHeadRow[];
      let supportsEdges: RelationshipsHeadRow[];
      let ownsEdges: RelationshipsHeadRow[];
      let l1AncestorByCapabilityId: Map<UUID, ElementsHeadRow>;
      let view: ViewRow;
      if (systemsSource) {
        edges = systemsSource.edges(systemIds, actorIds);
        supportsEdges = systemsSource.supports(systemIds);
        ownsEdges = systemsSource.owns(systemIds);
        const projectionByIds = systemsSource.byIds;
        l1AncestorByCapabilityId = await loadL1AncestorByCapabilityId((ids) => Promise.resolve(projectionByIds([...ids])), supportsEdges);
        // Still recorded (ADR-011: "a view is a saved query") — just never
        // consulted for layout any more (item 6). `getOrCreateScopedView`'s
        // own module comment names capability_map's identical stance.
        view = await getOrCreateModelView(supabase, { id: crypto.randomUUID(), orgId: currentOrgId, modelId: currentModelId, kind: 'landscape', name: 'Landscape', createdBy: currentUserId, branchId });
      } else if (commitScope) {
        edges = filterLandscapeEdges(commitScope.edgeRows, systemIds, actorIds);
        supportsEdges = filterSupportsEdgesForSystems(commitScope.supportsRows, systemIds);
        ownsEdges = filterOwnsEdgesForSystems(commitScope.ownsRows, systemIds);
        const capabilitiesById = new Map(commitScope.capabilities.map((c) => [c.element_id, c]));
        l1AncestorByCapabilityId = new Map();
        for (const id of new Set(supportsEdges.map((edge) => edge.to_element_id))) {
          const l1 = l1AncestorOf(id, capabilitiesById);
          if (l1) l1AncestorByCapabilityId.set(id, l1);
        }
        view = commitScope.view;
      } else {
        throw new Error('useLandscape: no data source resolved');
      }

      const systemsById = new Map(allSystems.map((s) => [s.element_id, s]));
      const actorsById = new Map(allActors.map((a) => [a.element_id, a]));
      if (!cancelled) setState({ status: 'ready', data: { commitId, view, systemsById, platformIdByInterfaceId, actorsById, edges, supportsEdges, ownsEdges, l1AncestorByCapabilityId, diff, future, hiddenByDate } });
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load the landscape.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the landscape' });
    });

    return () => {
      cancelled = true;
    };
    // `ref`'s string form (`refParam`) is the real dependency, same pitfall
    // and same fix as useElementPage.ts — `ref` itself is read from the
    // closure, always the latest one.
  }, [modelId, orgId, userId, refParam, mode, enabled, mainCommitIdHint, asAt, highlightChanges]);

  return { state };
}

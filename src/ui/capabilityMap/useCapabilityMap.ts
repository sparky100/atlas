import { useEffect, useState } from 'react';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { projectionElementsByIds } from '../../db/branchProjection';
import { hasAnySystem, listSupportsEdgesForAllCapabilities, listCapabilitiesForMap } from '../../db/capabilityMap';
import { getElementsByIds } from '../../db/elements';
import { listOwnsEdges } from '../../db/elementBrowse';
import { computeSelfOwnedCapabilityIds, listAllReplacesEdges } from '../../db/healthFindings';
import { lifecycleStateOf, replacedElementIds, supportsEdgesInForce } from '../../engine/elementRead/fitAndExposure';
import { listAllEnablesEdges } from '../../db/valueStreams';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import type { ViewMode } from '../../db/viewMode';
import { loadHeadAtCommitCached, resolveBranchModeProjectionCached } from '../query/cachedBranchProjection';
import { loadPlannedFuture, type PlannedFuture } from '../../db/plannedFuture';
import { serializeHeadProjection, type HeadProjection } from '../../engine/projection';
import { todayIsoDate } from '../landscape/asAt';
import { capabilitiesChangedByDate } from './asAtChanges';
import { getOrCreateModelView } from '../../db/views';
import type { ViewRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { effectiveModuleAttributes } from '../elements/moduleAttributes';
import { computeCapabilityMapTree, type CapabilityMapTree } from './layout';
import { supabase } from '../supabaseClient';

export interface CapabilityMapData {
  commitId: UUID;
  view: ViewRow;
  tree: CapabilityMapTree;
  supportsEdges: RelationshipsHeadRow[];
  systemsById: Map<UUID, ElementsHeadRow>;
  /** Sprint U4-1 C4: the model-wide answer, not derived from `systemsById` above — see `hasAnySystem`'s own comment for why those are different facts. */
  hasSystems: boolean;
  /** Every capability at this ref, every level — `tree` is the same set already nested into L1/L2/L3; kept flat here too since the capability rollup (`capabilityRollup.ts`) needs a plain list/map to walk subtrees and resolve ancestors, not the tree shape. */
  capabilities: ElementsHeadRow[];
  /** `src/db/healthFindings.ts`'s `computeSelfOwnedCapabilityIds` result — the capability rollup's own owner-coverage input, computed once here rather than per tile. */
  selfOwnedIds: ReadonlySet<UUID>;
  /** V2b's Inspector, Selection section's own "owners by role" — every live `owns` edge in the model (already fetched below for `selfOwnedIds`, previously discarded once that boolean set was computed). */
  ownsEdges: RelationshipsHeadRow[];
  /** Every actor referenced as an `owns` edge's own `from` (`relationshipTypeRules.ts`: an owner is always an actor) — resolved once here so the Inspector's Selection section can show owner *names*, not just `selfOwnedIds`' own boolean. */
  actorsById: Map<UUID, ElementsHeadRow>;
  /** F6 Step 6: every live `enables` edge at this ref (capability → stage) — "enables N stages" on a domain/card, and the capability page's own outbound "Enables" group. */
  enablesEdges: RelationshipsHeadRow[];
  /** ADR-001 amendment: every element with a live `replaces` edge pointing at it (`replacedElementIds`) — `metrics.ts`'s `lifecycleExposure` reads a recorded replacement as "not exposed". */
  replacedIds: ReadonlySet<UUID>;
  /** Supporting systems and modules left out because they are planned (not live yet) or retired. Zero for a change branch, which shows its plan as it is. */
  hiddenByDate: { planned: number; retired: number };
  /** For a future "as at" date: the planned changes laid on and the capabilities whose supporting systems differ from today. `null` for today (or a change). */
  future: { picture: PlannedFuture; changedCapabilityIds: ReadonlySet<UUID> } | null;
}

export type CapabilityMapState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'refNotFound' } | { status: 'ready'; data: CapabilityMapData };

export interface UseCapabilityMapResult {
  state: CapabilityMapState;
  /** Re-fetches everything at the current ref — used after a successful import/add (Sprint U2 step 2), same purpose as useElementPage.ts's `reload`. */
  reload: () => void;
}

/**
 * Loads the capability map's data (UI-principles §6.1, §3.1). Unlike the
 * landscape (src/ui/landscape/useLandscape.ts), this never reads or writes
 * `view_layouts`: the map is plain DOM/CSS (src/ui/capabilityMap/layout.ts's
 * module comment explains why), so there is no manual position to persist
 * — ADR-011's litmus test is trivially satisfied by never writing a row in
 * the first place. `getOrCreateModelView` still records the `views` row
 * itself ("a view is a saved query", ADR-011), which is what a future
 * feature (per-user expand state, annotations) would hang off later.
 *
 * #244: a branch ref used to be resolved straight to its head commit via
 * `resolveRef`, then queried against `elements_head`/`relationships_head`
 * filtered by that commit id — but (per SPEC S-2, the same assumption
 * `useLandscape.ts`/`useCapabilityLandscape.ts` already build around) a
 * change branch's head is never materialised there, so the map silently
 * showed empty/stale content for a branch ref instead of the branch's own
 * state. Mirrors `useCapabilityLandscape.ts`'s main/tag-vs-branch split: a
 * branch ref reads the already-folded arrays off
 * `resolveBranchModeProjectionCached`'s `HeadProjection` and derives
 * everything in memory; main/tag are unchanged, still the direct
 * commit-scoped queries below.
 */
export function useCapabilityMap(
  modelId: UUID,
  orgId: UUID,
  userId: UUID | null,
  ref: Ref,
  mode: ViewMode,
  /** S1 item 15 (A2 remainder): the caller's own already-resolved main head commit id — same race-tolerant dedup shape `useStructureView.ts`'s own parameter comment explains. */
  mainCommitIdHint: UUID | null = null,
  /** "View as at": a future ISO date (`landscape/asAt.ts`'s `parseAsAtParam`), main only — `null` is today. */
  asAt: string | null = null,
): UseCapabilityMapResult {
  const [state, setState] = useState<CapabilityMapState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const refParam = refParamOf(ref);

  useEffect(() => {
    // S1 item 15: guard on `modelId` too, not just `userId` — same fix as
    // `useBreadcrumbElement.ts`'s own precedent for this exact shape (the
    // page's `model?.id ?? ''` fires this effect once before its own model
    // resolves; left unguarded, `reportError`'s new catch-all here would
    // otherwise post a banner that outlives the load that follows it).
    if (!userId || !modelId) return undefined;
    const currentUserId = userId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      let commitId: UUID;
      let capabilities: ElementsHeadRow[];
      let hasSystems: boolean;
      let supportsEdges: RelationshipsHeadRow[];
      let systemsById: Map<UUID, ElementsHeadRow>;
      let ownsEdges: RelationshipsHeadRow[];
      let actorsById: Map<UUID, ElementsHeadRow>;
      let enablesEdges: RelationshipsHeadRow[];
      let replacedIds: Set<UUID>;
      let preloadedView: ViewRow | null = null;

      let future: PlannedFuture | null = null;
      const futureAsAt = ref.kind === 'main' && mainCommitIdHint !== null && asAt !== null && asAt > todayIsoDate() ? asAt : null;

      if (ref.kind === 'branch' || futureAsAt !== null) {
        let projection: HeadProjection;
        if (futureAsAt !== null && mainCommitIdHint !== null) {
          // View as at a future date: today's head with the agreed planned changes that land by then laid on top. Read-only — nothing is stored.
          future = await loadPlannedFuture(supabase, modelId, mainCommitIdHint, futureAsAt, todayIsoDate(), (c) => loadHeadAtCommitCached(supabase, modelId, c));
          projection = serializeHeadProjection(future.head);
          commitId = mainCommitIdHint;
        } else {
          const branch = await resolveBranchRef(supabase, ref);
          if (!branch) {
            if (!cancelled) setState({ status: 'refNotFound' });
            return;
          }
          const resolved = await resolveBranchModeProjectionCached(supabase, modelId, branch, mode);
          if (!resolved) {
            if (!cancelled) setState({ status: 'refNotFound' });
            return;
          }
          projection = resolved.projection;
          commitId = resolved.commitId;
        }
        capabilities = projection.elementsHead.filter((e) => e.element_type === 'capability');
        hasSystems = projection.elementsHead.some((e) => e.element_type === 'system');
        replacedIds = replacedElementIds(projection.relationshipsHead);
        const capabilityIdSet = new Set(capabilities.map((c) => c.element_id));
        supportsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'supports' && capabilityIdSet.has(r.to_element_id));
        const systemIds = [...new Set(supportsEdges.map((edge) => edge.from_element_id))];
        systemsById = projectionElementsByIds(projection, systemIds);

        const missingPlatformIds = [
          ...new Set(
            [...systemsById.values()]
              .filter((e): e is ElementsHeadRow & { parent_id: UUID } => e.element_type === 'container' && e.parent_id !== null && !systemsById.has(e.parent_id))
              .map((e) => e.parent_id),
          ),
        ];
        if (missingPlatformIds.length > 0) {
          const platformsById = projectionElementsByIds(projection, missingPlatformIds);
          for (const [id, row] of platformsById) systemsById.set(id, row);
        }
        for (const [id, row] of systemsById) {
          if (row.element_type !== 'container' || row.parent_id === null) continue;
          const platform = systemsById.get(row.parent_id);
          if (platform) systemsById.set(id, effectiveModuleAttributes(row, platform));
        }

        ownsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'owns');
        enablesEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'enables');
        const ownerActorIds = [...new Set(ownsEdges.map((edge) => edge.from_element_id))];
        actorsById = ownerActorIds.length > 0 ? projectionElementsByIds(projection, ownerActorIds) : new Map<UUID, ElementsHeadRow>();
      } else {
        const resolvedCommitId = ref.kind === 'main' && mainCommitIdHint ? mainCommitIdHint : await resolveRef(supabase, modelId, ref);
        if (!resolvedCommitId) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolvedCommitId;

        // Round 1: every read that needs only the commit id, together —
        // this used to be eight requests one after another. The saved-view
        // lookup is independent of the data entirely, so it rides along.
        const [caps, hasSys, loadedSupportsEdges, loadedOwnsEdges, loadedEnablesEdges, loadedReplacesEdges, loadedView] = await Promise.all([
          listCapabilitiesForMap(supabase, commitId),
          hasAnySystem(supabase, commitId),
          listSupportsEdgesForAllCapabilities(supabase, commitId),
          listOwnsEdges(supabase, commitId),
          listAllEnablesEdges(supabase, commitId),
          listAllReplacesEdges(supabase, commitId),
          getOrCreateModelView(supabase, { id: crypto.randomUUID(), orgId, modelId, kind: 'capability_map', name: 'Capability map', createdBy: currentUserId }),
        ]);
        capabilities = caps;
        hasSystems = hasSys;
        const capabilityIdSet = new Set(capabilities.map((c) => c.element_id));
        supportsEdges = loadedSupportsEdges.filter((r) => capabilityIdSet.has(r.to_element_id));
        ownsEdges = loadedOwnsEdges;
        enablesEdges = loadedEnablesEdges;
        replacedIds = replacedElementIds(loadedReplacesEdges);
        preloadedView = loadedView;
        // Round 2: the supporting systems and the owning actors don't depend on each other.
        const systemIds = [...new Set(supportsEdges.map((edge) => edge.from_element_id))];
        const ownerActorIds = [...new Set(ownsEdges.map((edge) => edge.from_element_id))];
        [systemsById, actorsById] = await Promise.all([getElementsByIds(supabase, commitId, systemIds), getElementsByIds(supabase, commitId, ownerActorIds)]);

        // "Platforms and modules": a module (Container) supporting a
        // capability may inherit its own unset lifecycle/criticality/hosting/
        // domain from its platform (`effectiveModuleAttributes`'s own doc
        // comment) — but the platform itself typically has no *direct*
        // supports edge of its own, so it's usually missing from
        // `systemsById` above. A second, small lookup for just those missing
        // parent ids, then every module's own entry is replaced with its
        // resolved-effective row; `metrics.ts` never needs to know any of
        // this happened, since it only ever reads `.attributes` off whatever
        // row `systemsById` hands it.
        const missingPlatformIds = [
          ...new Set(
            [...systemsById.values()]
              .filter((e): e is ElementsHeadRow & { parent_id: UUID } => e.element_type === 'container' && e.parent_id !== null && !systemsById.has(e.parent_id))
              .map((e) => e.parent_id),
          ),
        ];
        if (missingPlatformIds.length > 0) {
          const platformsById = await getElementsByIds(supabase, commitId, missingPlatformIds);
          for (const [id, row] of platformsById) systemsById.set(id, row);
        }
        for (const [id, row] of systemsById) {
          if (row.element_type !== 'container' || row.parent_id === null) continue;
          const platform = systemsById.get(row.parent_id);
          if (platform) systemsById.set(id, effectiveModuleAttributes(row, platform));
        }
      }

      const view = preloadedView ?? (await getOrCreateModelView(supabase, { id: crypto.randomUUID(), orgId, modelId, kind: 'capability_map', name: 'Capability map', createdBy: currentUserId }));
      const tree = computeCapabilityMapTree(capabilities);
      // A system past its planned end stops counting as supporting a capability (Retire copies the links to the replacement and keeps the old ones).
      // A change branch shows its plan as it is; main and a tag show what is live.
      const hiddenByDate = { planned: 0, retired: 0 };
      let futureResult: CapabilityMapData['future'] = null;
      if (future !== null && futureAsAt !== null) {
        // As at the chosen date: a system past its planned end by then stops counting, one introduced by then counts. Compared with the same rule applied to today.
        const asAtDate = new Date(`${futureAsAt}T00:00:00`);
        supportsEdges = supportsEdgesInForce(supportsEdges, systemsById, asAtDate);
        const todayProjection = serializeHeadProjection(future.today);
        const todayCaps = todayProjection.elementsHead.filter((e) => e.element_type === 'capability');
        const todayCapIds = new Set(todayCaps.map((c) => c.element_id));
        const todayById = new Map(todayProjection.elementsHead.map((e) => [e.element_id, e]));
        const todaySupports = supportsEdgesInForce(
          todayProjection.relationshipsHead.filter((r) => r.relationship_type === 'supports' && todayCapIds.has(r.to_element_id)),
          todayById,
          new Date(),
        );
        futureResult = { picture: future, changedCapabilityIds: capabilitiesChangedByDate(todayCapIds, new Set(capabilities.map((c) => c.element_id)), todaySupports, supportsEdges) };
      } else if (ref.kind !== 'branch') {
        const now = new Date();
        for (const id of new Set(supportsEdges.map((edge) => edge.from_element_id))) {
          const supporter = systemsById.get(id);
          const state = supporter ? lifecycleStateOf(supporter, systemsById, now) : 'active';
          if (state !== 'active') hiddenByDate[state] += 1;
        }
        supportsEdges = supportsEdgesInForce(supportsEdges, systemsById, now);
      }
      const selfOwnedIds = computeSelfOwnedCapabilityIds(capabilities, supportsEdges, ownsEdges);

      if (!cancelled) setState({ status: 'ready', data: { commitId, view, tree, supportsEdges, systemsById, hasSystems, capabilities, selfOwnedIds, ownsEdges, actorsById, enablesEdges, replacedIds, hiddenByDate, future: futureResult } });
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load the capability map.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the capability map' });
    });

    return () => {
      cancelled = true;
    };
    // Same pitfall/fix as useElementPage.ts / useLandscape.ts: `refParam`
    // (a stable string) is the real dependency, not `ref` itself.
  }, [modelId, orgId, userId, refParam, mode, reloadToken, mainCommitIdHint, asAt]);

  return {
    state,
    reload: () => {
      setReloadToken((t) => t + 1);
    },
  };
}

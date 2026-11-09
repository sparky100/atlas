import { Loading } from '../components/Loading/Loading';
import { ModelEmptyState } from '../components/EmptyState/ModelEmptyState';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb, type BreadcrumbSegment } from '../components/Breadcrumb/Breadcrumb';
import { MakeStartPageButton } from '../profile/MakeStartPageButton';
import { domainCoverageSummary } from '../capabilityMap/domainSummary';
import { Chip } from '../components/Chip/Chip';
import { Button } from '../components/Button/Button';
import { CommentsPanel } from '../components/CommentsPanel/CommentsPanel';
import { DiffLegend } from '../components/DiffBadge/DiffLegend';
import { ElementSearchAdd } from '../components/ElementSearchAdd/ElementSearchAdd';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useThreadCounts } from '../comments/useThreadCounts';
import { useModels } from '../models/useModels';
import { canEditBranch, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refLabelOf, refParamOf, refQueryParam } from '../../db/ref';
import { parseViewMode } from '../../db/viewMode';
import { BranchViewModeControl } from '../branches/BranchViewModeControl';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ViewingBranchBanner } from '../branches/ViewingBranchBanner/ViewingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useEditingBranch } from '../branches/useEditingBranch';
import { hintedModelId, useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { isViewingMode } from '../branches/viewingMode';
import { AsAtControl } from '../landscape/AsAtControl';
import { AS_AT_COMPARE_PARAM, AS_AT_PARAM, parseAsAtParam, todayIsoDate } from '../landscape/asAt';
import { FutureSummary } from '../landscape/FutureSummary';
import { CapabilityLandscapeList } from '../landscape/CapabilityLandscapeList';
import { Inspector } from '../components/Inspector/Inspector';
import { useInspectorCollapsedPreference } from '../components/Inspector/useInspectorCollapsedPreference';
import { LandscapeCanvas } from '../landscape/LandscapeCanvas';
import { LandscapeInspectorContent } from '../landscape/LandscapeInspectorContent';
import { landscapeInspectorNeighbours, landscapeInspectorSupports } from '../landscape/landscapeInspectorSelection';
import { ownersByRole } from '../elements/ownersByRole';
import { parseLandscapeFilters, landscapeFiltersToSearchParams } from '../landscape/landscapeFilterParams';
import { LANDSCAPE_COLOUR_BY_OPTIONS } from '../landscape/landscapeColour';
import { LandscapeMobileList } from '../landscape/LandscapeMobileList';
import { ExportViewButtons } from '../components/ExportViewButtons/ExportViewButtons';
import { landscapeExportPlan, landscapeViewLabel } from '../exports/landscapeExport';
import { exportDate, stampRefLabel } from '../exports/viewExport';
import { listLandscapeLaneOptions, type LandscapeLaneDisplayOptions } from '../landscape/layout';
import { useCanvasWidth } from '../landscape/useCanvasWidth';
import { useCapabilityLandscape } from '../landscape/useCapabilityLandscape';
import { useIsNarrowViewport } from '../landscape/useIsNarrowViewport';
import { useLandscape } from '../landscape/useLandscape';
import { useLandscapeColourByPreference } from '../landscape/useLandscapeColourByPreference';
import { useLandscapeDisplay } from '../landscape/useLandscapeDisplay';
import { useLandscapeLaneDisplayPreference } from '../landscape/useLandscapeLaneDisplayPreference';
import { fitForPurposeToneFor } from '../elements/fitForPurposeTone';
import { useElementExport } from '../elements/useElementExport';
import { criticalityOf, lifecycleStatusOf, type BrowseRow } from '../../db/elementBrowse';
import { dispositionOf } from '../elements/disposition';
import { useAttributeDefinitions } from '../orgs/useAttributeDefinitions';
import { useBreadcrumbElement } from '../nav/useBreadcrumbElement';
import { parseCapabilityParam, zoomQueryString } from '../nav/zoomParams';
import { useRouteTiming } from '../perf/useRouteTiming';
import { downloadImportPrompt } from '../import/downloadImportPrompt';
import { LandscapeFind, type LandscapeFindOption } from '../landscape/LandscapeFind';
import { supabase } from '../supabaseClient';
import styles from './LandscapePage.module.css';

/**
 * The Landscape view (UI-principles.md §6.1, Sprint U1 step 4a): systems in
 * swim-lanes by the capability they support, `uses`/`flows_to` edges
 * between them. Sprint U2 step 3 adds the "optional capability filter"
 * §6.1's own Landscape row names (`?capability=`, src/ui/nav/zoomParams.ts)
 * — the zoom chain's second stop, reached from a capability tile's own
 * "→ Landscape" link — and Context/Container/Component, which reuse the
 * same renderer with their own query and layout preset (this step, not a
 * later one anymore). No Web Worker for those three (see their own view
 * comments); the landscape itself keeps its Sprint U1 4b worker/viewport-
 * culling/LOD work — the only view kind with §8.6's performance budget.
 *
 * Blocking: element creation adds the search-first "Add" control here for
 * systems and actors (src/ui/components/ElementSearchAdd/ElementSearchAdd.tsx)
 * — the empty-state affordance the landscape never had before ("Add a
 * System from the element page" pointed at a page you could only reach by
 * already knowing a system's id, i.e. nowhere).
 *
 * Sprint U4-1 E1: at >= 768px (the app's own mobile breakpoint —
 * ModelNav.tsx/UserMenu.tsx/UI-principles.md §2 — 390px, the sprint's own
 * narrow-mobile floor from C2, is a Playwright viewport width to prove no
 * horizontal overflow at, not a second breakpoint) the header actions row
 * is "+ Add system", "+ Add actor" inline. Below it, those two collapse
 * into one "+ Add" disclosure — `useIsNarrowViewport` decides which
 * arrangement actually *mounts* (not a CSS-only show/hide of both) so
 * `ElementSearchAdd`'s own search-pool fetch never runs twice for one page
 * load.
 *
 * Sprint U4-2b item 6: "Reset layout" (and the "⋯" overflow menu it used
 * to be the narrow viewport's only occupant of) is gone entirely — the
 * landscape auto-lays-out on every open now, with no `view_layouts` row to
 * reset (`useLandscape.ts`'s own comment, UI-principles §6.4).
 *
 * Sprint U4-2b item 7: `useCanvasWidth` measures `<main>` and feeds that
 * width through `useLandscape` as the layout's width hint — see that
 * hook's own comment.
 *
 * Sprint U4-2b item 13: the same 768px breakpoint also decides which
 * *content* renderer mounts below the header — `LandscapeMobileList` (a
 * collapsible list, `landscapeGroups.ts`'s own module comment has the full
 * grouping rules) instead of `LandscapeCanvas`, never both. The desktop
 * canvas itself, and everything about it (the `.mainWithCanvas` full-width
 * treatment — keyed on viewport width alone, see `canvasWidthClass` below),
 * stays exactly as it was — the list is a second renderer for the same
 * `state.data`, not a replacement, and doesn't need any of the canvas's
 * own pixel/viewport-culling/worker machinery, so it renders inside the
 * page's ordinary centred column instead. It does share `useThreadCounts`
 * and the comments panel with the canvas as of S1 item 12 (below) — that
 * part was the one real gap between the two renderers, not something
 * canvas-specific by nature.
 *
 * S1 item 12: "markers and panel on the mobile landscape list and the
 * capability-scoped list" — `LandscapeMobileList`/`CapabilityLandscapeList`
 * both now take the same `threadCounts` map (`useThreadCounts`, already
 * fetched once per view — `CapabilityLandscapeList`'s own is a second call
 * scoped to its own system-id set, since `useLandscape` never runs while a
 * capability filter is active) and an `onCommentMarkerClick` callback
 * reusing this page's existing `commentsPanelElementId`/`autoFocusComposer`
 * state — the same shape the canvas's own `onCommentMarkerClick` already
 * used, just reaching two more renderers instead of one.
 */
export function LandscapePage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { ref } = useSelectedRef();
  const viewing = isViewingMode(searchParams);
  const mode = parseViewMode(searchParams.get('mode'));
  const capabilityId = parseCapabilityParam(searchParams.get('capability'));
  const { userId } = useAuth();
  // "View as at": a future date for the landscape on main — `?asat=`. Today (the default) is no param at all. Not for a change's own ref (it has As-is/To-be/Diff) or the capability-scoped list.
  const [todayIso] = useState(() => todayIsoDate());
  const asAt = ref.kind === 'main' && capabilityId === null ? parseAsAtParam(searchParams.get(AS_AT_PARAM), todayIso) : null;
  const highlightChanges = searchParams.get(AS_AT_COMPARE_PARAM) !== 'off';

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { label: branchLabel } = useBranchLabel(ref);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const { branch: editingBranch } = useEditingBranch(model?.id ?? null, ref);
  // Search always scans main's real head, regardless of which ref/branch is
  // being viewed (src/db/elementSearch.ts's own module comment) — only the
  // write target (`editingBranch`) varies with the ref.
  const { branch: mainBranch, loading: mainBranchLoading, reload: reloadMainBranch } = useMainBranch(model?.id ?? null);
  // S1 item 15 (A2 remainder): `mainBranch` is already resolved above —
  // hand its head commit id through as `useBreadcrumbElement`'s own dedup
  // hint (that hook's own parameter comment) rather than letting it run a
  // second, redundant `resolveRef` for the common `ref.kind === 'main'` case.
  const capability = useBreadcrumbElement(hintedModelId(model?.id, ref, mainBranchLoading), ref, capabilityId, mainBranch?.head_commit_id ?? null);
  const canEdit = !viewing && asAt === null && editingBranch !== null && canEditBranch(role, editingBranch);
  // ADR-018 guarantees both are never null in practice (every branch always
  // has a real head, from genesis onward) — `BranchRow`'s own type hasn't
  // been narrowed to match yet (a separate, wider cleanup touching every
  // `!branch.head_commit_id` guard in src/db), so this control checks it
  // explicitly rather than asserting it away.
  const searchCommitId = mainBranch?.head_commit_id ?? null;
  const writeHeadCommitId = editingBranch?.head_commit_id ?? null;
  const canAdd = canEdit && searchCommitId !== null && writeHeadCommitId !== null;

  // Item 7: `<main>`'s own measured width, fed to `useLandscape` as the
  // layout's width hint — see `useCanvasWidth.ts`'s own comment for why
  // `<main>` (rendered in every state) is what gets measured, not the
  // canvas element itself.
  const { ref: canvasWidthRef, width: canvasWidth } = useCanvasWidth();

  // Sprint U4-2a item 2: `searchCommitId` above is already `mainBranch`'s
  // head, from the one `useMainBranch` call this route makes — handing it
  // to `useLandscape` as its main-commit hint means `ref.kind === 'main'`
  // (no `?ref=` at all, the common case) never re-fetches the identical
  // `main` row a second time. See useLandscape.ts's own doc comment.
  //
  // Sprint U4-2c item 2: `useLandscape` itself only ever runs while
  // `capabilityId` is absent (its own `enabled` doc comment) — whenever
  // it's set, `useCapabilityLandscape` below is the one hook actually
  // loading anything, and this page renders `CapabilityLandscapeList`
  // instead of the canvas/mobile list either one of the other two hooks
  // feeds.
  const { state } = useLandscape(model?.id ?? null, organisation?.id ?? null, userId, ref, mode, capabilityId === null, searchCommitId, asAt, highlightChanges);
  const { state: capabilityLandscapeState } = useCapabilityLandscape(model?.id ?? null, ref, mode, capabilityId, searchCommitId);
  // E8 ("performance") phase 1: this route's own resolve/first-paint/data-complete marks — see useRouteTiming.ts's own module comment. Either hook's own `ready` covers this route (plain vs. capability-scoped), whichever is actually active.
  useRouteTiming('landscape', capabilityId === null ? state.status === 'ready' : capabilityLandscapeState.status === 'ready');
  // V2 "landscape focus and filters": `?capabilities=`/`?lifecycle=`/
  // `?criticality=`/`?kind=`/`?domain=` — parsed fresh from `searchParams`
  // (itself stable across renders unless the URL's own query string
  // changes, react-router's own `useSearchParams` memoises it that way),
  // so this stays a stable reference across every render that doesn't
  // actually change the filter — required for `useLandscapeDisplay`'s own
  // effect dependency array to settle rather than recompute forever.
  const filters = useMemo(() => parseLandscapeFilters(searchParams), [searchParams]);
  // Decision 1 (UI-principles.md §10): per-lane collapse/expand and pin,
  // remembered per user — converted from the hook's own plain arrays into
  // the `Set`-based shape `layout.ts` takes, memoised on those arrays' own
  // identity so an unrelated re-render doesn't rebuild (and thereby
  // recompute layout for) a `laneDisplay` that hasn't actually changed.
  const { collapsedLaneKeys, expandedLaneKeys, pinnedLaneKeys, hiddenLaneKeys, setLaneCollapsed, setLanePinned, reorderPinnedLane, setLaneHidden } = useLandscapeLaneDisplayPreference(userId);
  const laneDisplay = useMemo<LandscapeLaneDisplayOptions>(
    () => ({ collapsedLaneKeys: new Set(collapsedLaneKeys), expandedLaneKeys: new Set(expandedLaneKeys), pinnedLaneKeys, hiddenLaneKeys: new Set(hiddenLaneKeys) }),
    [collapsedLaneKeys, expandedLaneKeys, pinnedLaneKeys, hiddenLaneKeys],
  );
  // People and teams that only own things have no line on this view, so they are hidden unless asked for; same unpersisted shape as `showConnections`.
  const [showOwners, setShowOwners] = useState(false);
  const displayInput = state.status === 'ready' ? state.data : null;
  const displayState = useLandscapeDisplay(displayInput, filters, laneDisplay, canvasWidth ?? undefined, showOwners);
  // The Inspector's own hide-toggle list needs every lane key+label
  // regardless of hidden state (`layout.ts`'s `listLandscapeLaneOptions`
  // doc comment) — `displayState.display.layout.lanes` alone can't supply
  // this once a lane is hidden, since that array stops including it
  // entirely. Cheap (no row/height geometry), so computed inline rather
  // than routed through the layout worker.
  const laneOptions = useMemo(
    () => (displayInput ? listLandscapeLaneOptions([...displayInput.systemsById.values()], displayInput.supportsEdges, displayInput.l1AncestorByCapabilityId, [...displayInput.actorsById.values()]) : []),
    [displayInput],
  );
  // The Inspector lists lanes in the order the canvas draws them: pinned
  // lanes first, in the user's own pin order (what its ↑/↓ buttons
  // reorder), then the rest in their existing order (`layout.ts`'s `pinTier`).
  const orderedLaneOptions = useMemo(() => {
    if (pinnedLaneKeys.length === 0) return laneOptions;
    const tier = (key: string) => {
      const index = pinnedLaneKeys.indexOf(key);
      return index === -1 ? pinnedLaneKeys.length : index;
    };
    return [...laneOptions].sort((a, b) => tier(a.key) - tier(b.key));
  }, [laneOptions, pinnedLaneKeys]);
  // V2: click-to-focus — plain, unpersisted view state, the same shape
  // `routeViaPlatforms`/`commentsOnlyFilter` already use below.
  const [rawFocusedElementId, setFocusedElementId] = useState<UUID | null>(null);
  // "Find on this landscape": a fresh object per pick, so the canvas re-centres even on the same tile.
  const [centreRequest, setCentreRequest] = useState<{ elementId: UUID } | null>(null);
  // "Edges hidden by default; 'Show connections' toggle" — same unpersisted
  // per-session shape as `routeViaPlatforms` below; the real toggle lives
  // in the new focus panel now.
  const [showConnections, setShowConnections] = useState(false);
  // A filter or lane-collapse change can remove the currently-focused tile
  // from the layout entirely (filtered out, or its lane just collapsed) —
  // a *derived* value (never written back to `rawFocusedElementId` itself)
  // rather than an effect that calls `setFocusedElementId` on every such
  // change: every reader below sees the tile as unfocused the instant it's
  // no longer drawn, with no extra render round trip.
  const focusedElementId = useMemo(() => {
    if (rawFocusedElementId === null || displayState.status !== 'ready') return rawFocusedElementId;
    const stillPresent = displayState.display.layout.nodes.some((n) => n.elementId === rawFocusedElementId) || displayState.display.layout.actorNodes.some((n) => n.elementId === rawFocusedElementId);
    return stillPresent ? rawFocusedElementId : null;
  }, [rawFocusedElementId, displayState]);
  // Every level-1 capability lane in the model, independent of any filter
  // currently active — the filter bar's own capability facet needs the
  // whole universe of choices, not just what the current (possibly
  // already-filtered) layout still shows (`LandscapeFilterBar.tsx`'s own
  // prop comment).
  const capabilityOptions = useMemo(() => {
    if (state.status !== 'ready') return [];
    const byId = new Map<UUID, string>();
    for (const capability of state.data.l1AncestorByCapabilityId.values()) byId.set(capability.element_id, capability.name);
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [state]);
  // V2b: the shared Inspector's own collapsed/expanded resting state — see
  // `useInspectorCollapsedPreference.ts`'s own module comment. A current
  // selection always forces it open regardless of this value
  // (`Inspector.tsx`'s own `open` derivation), so this only governs the
  // resting state with nothing focused.
  const { collapsed: inspectorCollapsed, setCollapsed: setInspectorCollapsed } = useInspectorCollapsedPreference(userId);
  const focusedElement = focusedElementId && state.status === 'ready' ? (state.data.systemsById.get(focusedElementId) ?? state.data.actorsById.get(focusedElementId) ?? null) : null;
  // Every system/actor/module node this landscape can draw, by id — the
  // Inspector's Connections section needs to resolve a neighbour's name
  // regardless of which of the three it is. Memoised on `state` (a new
  // object only on an actual reload) rather than rebuilt on every render
  // while a selection is active.
  const allNodesById = useMemo(() => (state.status === 'ready' ? new Map([...state.data.systemsById, ...state.data.actorsById]) : new Map<UUID, ElementsHeadRow>()), [state]);
  const inspectorNeighbours = useMemo(
    () => (focusedElement && state.status === 'ready' ? landscapeInspectorNeighbours(focusedElement.element_id, state.data.edges, allNodesById) : []),
    [focusedElement, state, allNodesById],
  );
  const inspectorOwnersByRole = useMemo(
    () => (focusedElement && state.status === 'ready' ? ownersByRole(focusedElement.element_id, state.data.ownsEdges, state.data.actorsById) : new Map<string, ElementsHeadRow[]>()),
    [focusedElement, state],
  );
  const inspectorSupports = useMemo(
    () => (focusedElement && state.status === 'ready' ? landscapeInspectorSupports(focusedElement.element_id, state.data.supportsEdges, state.data.l1AncestorByCapabilityId) : []),
    [focusedElement, state],
  );

  // §8.8's canvas `f` shortcut — its first real binding (V2), now the
  // Inspector's own Filters section (item 2: the top filter strip is gone):
  // force the panel open (a collapsed strip has nothing to focus into),
  // then — once that's committed and the section's own DOM exists — open
  // every facet's `<details>` and move focus to the first one.
  const filtersSectionRef = useRef<HTMLDivElement>(null);
  const [pendingOpenFilterBar, setPendingOpenFilterBar] = useState(false);
  const openFilterBar = () => {
    setInspectorCollapsed(false);
    setPendingOpenFilterBar(true);
  };
  useEffect(() => {
    if (!pendingOpenFilterBar) return;
    const container = filtersSectionRef.current;
    if (!container) return;
    container.querySelectorAll('details').forEach((details) => {
      details.open = true;
    });
    container.querySelector('summary')?.focus();
    setPendingOpenFilterBar(false);
  }, [pendingOpenFilterBar, inspectorCollapsed]);

  // Sprint U4-1 E1: see this component's own module comment.
  const narrow = useIsNarrowViewport(768);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const navigate = useNavigate();
  const addMenuId = useId();

  // Sprint M1b (`docs/HANDOFF-M1b-comments.md`'s Canvas section, direction
  // 5a): the panel is scoped to one system at a time, opened by clicking a
  // node's own comment marker or by `c`/`n` on the hovered node
  // (`LandscapeCanvas`'s own prop comments) — the canvas has no other
  // "selected node" concept yet, so hover stands in for it.
  const [commentsPanelElementId, setCommentsPanelElementId] = useState<UUID | null>(null);
  const [autoFocusComposer, setAutoFocusComposer] = useState(false);
  const anchorIds = state.status === 'ready' ? [...state.data.systemsById.keys()] : [];
  const threadCountsState = useThreadCounts(model?.id ?? null, anchorIds);
  const threadCounts = threadCountsState.status === 'ready' ? threadCountsState.counts : undefined;
  // S1 item 12: "markers ... on the capability-scoped list" — `useLandscape`
  // itself never runs while `capabilityId` is set (its own `enabled` doc
  // comment above), so its own `anchorIds`/`threadCounts` above are always
  // empty in that mode; this is `CapabilityLandscapeList`'s own separate
  // system-id set, fetched the same way, not a second mechanism.
  const capabilitySystemIds = capabilityLandscapeState.status === 'ready' ? [...capabilityLandscapeState.data.rows.primary, ...capabilityLandscapeState.data.rows.secondary].map((row) => row.system.element_id) : [];
  const capabilityThreadCountsState = useThreadCounts(model?.id ?? null, capabilitySystemIds);
  const capabilityThreadCounts = capabilityThreadCountsState.status === 'ready' ? capabilityThreadCountsState.counts : undefined;
  // F8: the capability-scoped list's own export — the visible systems of one
  // capability, mapped to the same `BrowseRow` shape the browse table's
  // export uses, so CSV/XLSX share the one builder.
  const { definitions: attributeDefinitions } = useAttributeDefinitions(organisation?.id ?? null, userId);
  const capabilityExportRows = useMemo<BrowseRow[]>(() => {
    if (capabilityLandscapeState.status !== 'ready') return [];
    return [...capabilityLandscapeState.data.rows.primary, ...capabilityLandscapeState.data.rows.secondary].map((row) => ({
      element: row.system,
      owner: row.owner,
      lifecycleStatus: lifecycleStatusOf(row.system),
      criticality: criticalityOf(row.system),
      disposition: dispositionOf(row.system),
      // `row.system.name` is already "Platform · Module"-qualified where it
      // applies (`useCapabilityLandscape.ts`'s own `withModuleLabels` pass)
      // — `null` here just means `moduleDisplayName` leaves that already-
      // qualified name alone rather than re-qualifying it a second time.
      parent: null,
    }));
  }, [capabilityLandscapeState]);
  const capabilityExport = useElementExport({
    modelId: model?.id ?? '',
    commitId: searchCommitId,
    definitions: attributeDefinitions,
    rows: capabilityExportRows,
    filenameBase: capability?.name ?? 'capability',
  });
  // M1 close-out item 1's own "per-session 'comments on this view' filter"
  // — plain component state, not `user_preferences` or anything else
  // persisted server-side: it resets on every fresh visit to this page
  // (a new tab, a reload), the same "per session" scope `reorderMode`
  // (CapabilityMapPage.tsx) already gives a view-only toggle that isn't
  // worth carrying across visits.
  const [commentsOnlyFilter, setCommentsOnlyFilter] = useState(false);
  // Prompt 7k item 1: the landscape's own colour-by mode — desktop canvas
  // only; unlike the comments-only filter above, this one genuinely has no
  // equivalent on the mobile list (a fill colour has nothing to mean on a
  // plain list row) — see the comments-only filter's own comment for why
  // the comparison doesn't hold for it any more (S1 item 12).
  const { colourBy, setColourBy } = useLandscapeColourByPreference(userId);
  const colourById = useId();
  // Prompt 7k item 4: "route via platforms" — direct edges by default,
  // same unpersisted-per-session shape as `commentsOnlyFilter` above
  // (the plan's own note: "unpersisted local/URL state, not a new
  // preference column, to keep this item's migration footprint at zero").
  const [routeViaPlatforms, setRouteViaPlatforms] = useState(false);

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Loading />
          </main>
        </div>
      </div>
    );
  }

  const refQuery = refQueryParam(ref, viewing);
  // Bare ref string (no `viewing`) for `ElementSearchAdd`'s own `refParam`
  // prop — every one of its three call sites below only ever renders while
  // `canAdd` is true, which already folds in `!viewing` (`canEdit` above),
  // so it never needs to carry `viewing` forward itself.
  const refParam = refParamOf(ref);
  const segments: BreadcrumbSegment[] = capability ? [{ label: capability.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/capability-map?${refQuery}` }] : [];
  // Landscape canvas, structural (item 3): an actor has no Context view of
  // its own (the zoom chain is system-specific), so this goes straight to
  // the actor's own element page instead — the same target item 13's
  // mobile list uses for both its system and actor rows' own tap target
  // ("tap → element page", `LandscapeMobileList.tsx`'s own prop comment).
  const elementHref = (elementId: string) => `/o/${orgSlug ?? ''}/m/${model.slug}/e/${elementId}?${refQuery}`;
  // V3 ("container context pages"): a module tile's own `elementId` is a
  // Container, which now has a Context view of its own too, the same as an
  // ordinary system or a platform's own band tile — every node this
  // landscape draws (other than an actor, handled by `elementHref` above)
  // now goes to the same Context-view target.
  const nodeHref = (systemId: string) => `/o/${orgSlug ?? ''}/m/${model.slug}/context/${systemId}?${zoomQueryString({ ref, capabilityId, viewing })}`;
  // Item 11: a lane key that isn't `$external`/`$unassigned` is a level-1
  // capability's own element id (`layout.ts`'s `placementFor`) — its
  // element page, same shape as `elementHref` above, works regardless of
  // where in the capability tree it sits (unlike a capability-map anchor,
  // which would need to know the map's own scroll position).
  const capabilityHref = (capabilityId: string) => `/o/${orgSlug ?? ''}/m/${model.slug}/e/${capabilityId}?${refQuery}`;

  // Shared between the >=768px inline row and the <768px "+ Add" menu
  // (E1) — same two controls, a different wrapper around them.
  const addControls = canAdd && (
    <>
      <ElementSearchAdd
        elementType="system"
        buttonLabel="+ Add system"
        parentId={null}
        modelId={model.id}
        orgId={organisation?.id ?? ''}
        userId={userId}
        searchCommitId={searchCommitId}
        branch={editingBranch}
        expectedHeadCommitId={writeHeadCommitId}
        orgSlug={organisation?.slug ?? ''}
        modelSlug={model.slug}
        refParam={refParam}
        onCreated={reloadMainBranch}
      />
      <ElementSearchAdd
        elementType="actor"
        buttonLabel="+ Add actor"
        parentId={null}
        modelId={model.id}
        orgId={organisation?.id ?? ''}
        userId={userId}
        searchCommitId={searchCommitId}
        branch={editingBranch}
        expectedHeadCommitId={writeHeadCommitId}
        orgSlug={organisation?.slug ?? ''}
        modelSlug={model.slug}
        refParam={refParam}
        onCreated={reloadMainBranch}
      />
      <Button variant="secondary" onClick={() => { void navigate(`/o/${orgSlug ?? ''}/m/${model.slug}/capture`); }}>
        Import…
      </Button>
    </>
  );

  // Sprint U4-2a item 5: "canvas routes fill the viewport" — only where the
  // canvas *can* render at this viewport width. Item 13: never on mobile —
  // the list renders inside the ordinary column, full-width treatment is a
  // canvas-specific need this content doesn't have.
  const hasContent = displayState.status === 'ready' && (displayState.display.layout.nodes.length > 0 || displayState.display.layout.actorNodes.length > 0);
  const showCanvas = hasContent && !narrow;
  // Item 7 regression fix: the CSS-class decision below must NOT depend on
  // `hasContent` (load state), unlike `showCanvas` above (correct for
  // deciding *what renders*). `<main>` is the element `canvasWidthRef`
  // measures, and that measurement feeds `useLandscapeDisplay`'s
  // `layoutWidthHint` — itself one of that hook's own effect dependencies. Coupling the class
  // to `hasContent` meant every loading→ready transition flipped the class,
  // resized `<main>`, re-fired the `ResizeObserver`, and re-triggered the
  // very reload that flips `hasContent` again: an infinite loop (confirmed
  // live — the page never finished loading). Keying the class on `!narrow`
  // alone keeps `<main>`'s width stable across loading/ready/error/empty,
  // since the canvas is never shown on mobile regardless of content.
  //
  // Item 2: never full-bleed while a capability filter is active either —
  // `CapabilityLandscapeList` is an ordinary-column flat list on every
  // viewport width, the same reasoning `!narrow` already gives mobile.
  const canvasWidthClass = !narrow && capabilityId === null;

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main ref={canvasWidthRef} className={[styles.main, canvasWidthClass ? styles.mainWithCanvas : ''].filter(Boolean).join(' ')}>
        {viewing ? <ViewingBranchBanner activeRef={ref} /> : <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} />}
        <Breadcrumb
          org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
          model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
          refLabel={refLabelOf(ref, branchLabel)}
          segments={segments}
        />
        <div className={styles.header}>
          {/* Sprint U4-2c item 2: "Title 'Systems supporting X (N)'" — replaces the ordinary "Landscape" title outright while a capability filter is active, rather than appending to it, the same way this whole header's controls below (colour-by, comments-only, route-via-platforms) don't apply to the flat list either. `(N)` only once the count is actually known. */}
          <Text as="h1" size="2xl" className={styles.title}>
            {capability ? `Systems supporting ${capability.name}${capabilityLandscapeState.status === 'ready' ? ` (${String(capabilityLandscapeState.data.rows.count)})` : ''}` : 'Landscape'}
          </Text>
          {!capability && <MakeStartPageButton page="landscape" />}
          {/* Capability rollup: the same "N/M supported" fraction and owner-coverage badge every level-1 tile surface shows — see `capabilityRollup.ts`'s own module comment. Shown only once the rollup is known and only while genuinely scoped to a real capability (never for the ordinary lane-based Landscape). */}
          {capability && capabilityLandscapeState.status === 'ready' && (
            <div className={styles.actions}>
              <Chip tone={capabilityLandscapeState.data.rollup.supportedCapabilityCount === 0 ? 'warn' : 'neutral'}>
                {domainCoverageSummary(capabilityLandscapeState.data.rollup.supportedCapabilityCount, capabilityLandscapeState.data.rollup.totalCapabilityCount)}
              </Chip>
              {capabilityLandscapeState.data.rollup.isOwned ? (
                <Chip tone="ok">owned</Chip>
              ) : (
                <Link to={`/o/${orgSlug ?? ''}/m/${model.slug}/e/${capability.element_id}`}>
                  <Chip tone="warn">no owner recorded</Chip>
                </Link>
              )}
              {capabilityLandscapeState.data.rollup.fitForPurpose !== null && (
                <Chip tone={fitForPurposeToneFor(capabilityLandscapeState.data.rollup.fitForPurpose)}>
                  fit · {capabilityLandscapeState.data.rollup.fitForPurpose}
                </Chip>
              )}
              <Button
                variant="secondary"
                disabled={capabilityExportRows.length === 0 || capabilityExport.status === 'working'}
                onClick={() => {
                  void capabilityExport.exportCsv();
                }}
              >
                Export CSV
              </Button>
              <Button
                variant="secondary"
                disabled={capabilityExportRows.length === 0 || capabilityExport.status === 'working'}
                onClick={() => {
                  void capabilityExport.exportXlsx();
                }}
              >
                Export XLSX
              </Button>
            </div>
          )}
          {capabilityExport.error !== null && <Text as="p">{capabilityExport.error}</Text>}
          {/* F13 step 1: a stamped picture of the landscape as laid out — every member, desktop and mobile alike (the layout is computed either way). Not for the flat capability-filtered list, which has its own CSV/XLSX export above. */}
          {!capability && state.status === 'ready' && displayState.status === 'ready' && hasContent && (
            <div className={styles.actions}>
              <ExportViewButtons
                what="landscape"
                build={() => {
                  const stamp = { modelName: model.name, refLabel: stampRefLabel(ref, branchLabel), date: exportDate() };
                  return {
                    plan: landscapeExportPlan({ layout: displayState.display.layout, systemsById: state.data.systemsById, actorsById: state.data.actorsById, colourBy, stamp }),
                    stamp: { ...stamp, viewLabel: landscapeViewLabel(colourBy) },
                  };
                }}
              />
            </div>
          )}
          {/* Prompt 7k item 1: the landscape's own colour-by mode — desktop canvas only, same scoping as the comments-only filter beside it. */}
          {state.status === 'ready' && showCanvas && (
            <div className={styles.actions}>
              <div className={styles.colourByControl}>
                <label htmlFor={colourById}>
                  <Text as="span" size="sm" tone="muted">
                    Colour by
                  </Text>
                </label>
                <select
                  id={colourById}
                  className={styles.select}
                  value={colourBy}
                  onChange={(e) => {
                    setColourBy(e.target.value as typeof colourBy);
                  }}
                >
                  <option value="none">None</option>
                  {LANDSCAPE_COLOUR_BY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {/* M1 close-out item 1: "the per-session 'comments on this view' filter" — desktop canvas only. Unlike the marker/panel wiring itself (which the mobile list now shares, S1 item 12), this specific *filter* (dimming every tile with no thread at all) has no equivalent on a plain list row — there's nothing to visually dim a row's own text down from. Toggled independently of `+ Add`, so it's its own `.actions` group rather than folded into `addControls`. */}
          {state.status === 'ready' && displayState.status === 'ready' && hasContent && (
            <div className={styles.actions}>
              <LandscapeFind
                options={narrow ? findOptionsFromGroups(displayState.display.groups) : findOptions(displayState.display.layout, state.data.systemsById, state.data.actorsById)}
                onPick={(elementId) => {
                  // The canvas focuses the tile (fading the rest, as a click does) and centres it; the mobile list has no focus, so it opens the group and highlights the row instead.
                  if (!narrow) setFocusedElementId(elementId);
                  setCentreRequest({ elementId });
                }}
              />
            </div>
          )}
          {state.status === 'ready' && showCanvas && (
            <div className={styles.actions}>
              <label className={styles.commentsOnlyToggle}>
                <input
                  type="checkbox"
                  checked={commentsOnlyFilter}
                  onChange={(e) => {
                    setCommentsOnlyFilter(e.target.checked);
                  }}
                />
                <Text as="span" size="sm" tone="muted">
                  Comments on this view
                </Text>
              </label>
            </div>
          )}
          {state.status === 'ready' && !narrow && addControls && <div className={styles.actions}>{addControls}</div>}
          {state.status === 'ready' && narrow && canAdd && (
            <div className={styles.actions}>
              <div className={styles.menuWrapper}>
                <button
                  type="button"
                  className={styles.menuToggle}
                  aria-expanded={addMenuOpen}
                  aria-controls={addMenuId}
                  onClick={() => {
                    setAddMenuOpen((o) => !o);
                  }}
                >
                  <Text as="span">+ Add</Text>
                </button>
                <div id={addMenuId} className={[styles.menu, addMenuOpen ? styles.open : ''].filter(Boolean).join(' ')}>
                  {addControls}
                </div>
              </div>
            </div>
          )}
        </div>

        {ref.kind === 'main' && capabilityId === null && (
          <AsAtControl
            asAt={asAt}
            todayIso={todayIso}
            highlightChanges={highlightChanges}
            onChange={(next) => {
              setSearchParams((prev) => {
                const updated = new URLSearchParams(prev);
                if (next === null) updated.delete(AS_AT_PARAM);
                else updated.set(AS_AT_PARAM, next);
                return updated;
              });
            }}
            onHighlightChange={(next) => {
              setSearchParams((prev) => {
                const updated = new URLSearchParams(prev);
                if (next) updated.delete(AS_AT_COMPARE_PARAM);
                else updated.set(AS_AT_COMPARE_PARAM, 'off');
                return updated;
              });
            }}
          />
        )}
        {asAt !== null && state.status === 'ready' && state.data.future !== null && <FutureSummary future={state.data.future} asAt={asAt} orgSlug={orgSlug ?? ''} modelSlug={model.slug} />}
        {asAt !== null && highlightChanges && state.status === 'ready' && <DiffLegend />}
        {ref.kind === 'branch' && (
          <BranchViewModeControl
            mode={mode}
            onChange={(next) => {
              setSearchParams((prev) => {
                const updated = new URLSearchParams(prev);
                updated.set('mode', next);
                return updated;
              });
            }}
          />
        )}
        {ref.kind === 'branch' && mode === 'diff' && <DiffLegend />}

        {/* Sprint U4-2c item 2: while a capability filter is active, `CapabilityLandscapeList` (desktop and mobile alike — no lanes, no cross-lane chips, so no viewport split either) replaces every bit of the lane-based rendering below it, which `useLandscape` itself no longer even loads (its own `enabled` doc comment). Branches on `capabilityId` (the URL param `useCapabilityLandscape` actually reads), not `capability` (the breadcrumb element, which can still be loading) — see the title above for the one place that distinction matters. */}
        {capabilityId !== null ? (
          <>
            {capabilityLandscapeState.status === 'loading' && <Loading />}
            {capabilityLandscapeState.status === 'error' && <Text as="p">{capabilityLandscapeState.message}</Text>}
            {capabilityLandscapeState.status === 'refNotFound' && <ModelEmptyState orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />}
            {capabilityLandscapeState.status === 'ready' && (
              <>
                <CapabilityLandscapeList
                  rows={capabilityLandscapeState.data.rows}
                  elementHref={elementHref}
                  contextHref={nodeHref}
                  threadCounts={capabilityThreadCounts}
                  onCommentMarkerClick={(elementId) => {
                    setCommentsPanelElementId(elementId);
                    setAutoFocusComposer(false);
                  }}
                />
                {commentsPanelElementId && (
                  <CommentsPanel
                    orgId={organisation?.id ?? ''}
                    modelId={model.id}
                    userId={userId}
                    role={role}
                    anchorType="element"
                    anchorId={commentsPanelElementId}
                    subjectName={[...capabilityLandscapeState.data.rows.primary, ...capabilityLandscapeState.data.rows.secondary].find((row) => row.system.element_id === commentsPanelElementId)?.system.name ?? ''}
                    unresolvedCount={capabilityThreadCounts?.get(commentsPanelElementId)?.open ?? 0}
                    branchId={ref.kind === 'branch' ? (editingBranch?.id ?? null) : null}
                    viewKind="landscape"
                    autoFocusComposer={autoFocusComposer}
                    onClose={() => {
                      setCommentsPanelElementId(null);
                    }}
                  />
                )}
              </>
            )}
          </>
        ) : (
          <>
            {state.status === 'loading' && <Loading />}
            {state.status === 'error' && <Text as="p">{state.message}</Text>}
            {state.status === 'refNotFound' && <ModelEmptyState orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />}
            {/* V2: the raw fetch (`state`) can be ready while layout/grouping is still computing in the worker (`useLandscapeDisplay`) — a brief gap this hook's own split introduces that the old single-effect version never had. */}
            {state.status === 'ready' && displayState.status === 'loading' && <Loading />}
            {displayState.status === 'error' && <Text as="p">{displayState.message}</Text>}
            {state.status === 'ready' && displayState.status === 'ready' && displayState.display.layout.nodes.length === 0 && displayState.display.layout.actorNodes.length === 0 && (
              <div>
                <EmptyState>No systems yet.</EmptyState>
                {canAdd && (
                  <div className={styles.actions}>
                    <ElementSearchAdd
                      elementType="system"
                      buttonLabel="Add a system"
                      parentId={null}
                      modelId={model.id}
                      orgId={organisation?.id ?? ''}
                      userId={userId}
                      searchCommitId={searchCommitId}
                      branch={editingBranch}
                      expectedHeadCommitId={writeHeadCommitId}
                      orgSlug={organisation?.slug ?? ''}
                      modelSlug={model.slug}
                      refParam={refParam}
                      onCreated={reloadMainBranch}
                    />
                    <Button variant="secondary" onClick={() => { void navigate(`/o/${orgSlug ?? ''}/m/${model.slug}/capture`); }}>
                      Import…
                    </Button>
                    <Button variant="ghost" onClick={() => void downloadImportPrompt(supabase, model.id, model.slug)}>
                      AI prompt for preparing an import file
                    </Button>
                  </div>
                )}
              </div>
            )}
            {/* Item 13: <768px renders the list, never the canvas — same `state.data`. S1 item 12 adds comment markers/panel here too, the same `threadCounts` map the canvas already computes — no viewport-fit math needed, this list has no pixels to lay out. */}
            {state.status === 'ready' && displayState.status === 'ready' && hasContent && narrow && (
              <>
                <LandscapeMobileList
                  groups={displayState.display.groups}
                  elementHref={elementHref}
                  contextHref={nodeHref}
                  threadCounts={threadCounts}
                  revealElement={centreRequest}
                  onCommentMarkerClick={(elementId) => {
                    setCommentsPanelElementId(elementId);
                    setAutoFocusComposer(false);
                  }}
                />
                {commentsPanelElementId && (
                  <CommentsPanel
                    orgId={organisation?.id ?? ''}
                    modelId={model.id}
                    userId={userId}
                    role={role}
                    anchorType="element"
                    anchorId={commentsPanelElementId}
                    subjectName={state.data.systemsById.get(commentsPanelElementId)?.name ?? ''}
                    unresolvedCount={threadCounts?.get(commentsPanelElementId)?.open ?? 0}
                    branchId={ref.kind === 'branch' ? (editingBranch?.id ?? null) : null}
                    viewKind="landscape"
                    autoFocusComposer={autoFocusComposer}
                    onClose={() => {
                      setCommentsPanelElementId(null);
                    }}
                  />
                )}
              </>
            )}
            {state.status === 'ready' && displayState.status === 'ready' && showCanvas && (
              <div className={styles.canvasRow}>
                <LandscapeCanvas
                  layout={displayState.display.layout}
                  systemsById={state.data.systemsById}
                  actorsById={state.data.actorsById}
                  edges={state.data.edges}
                  diff={state.data.diff}
                  nodeHref={nodeHref}
                  actorHref={elementHref}
                  capabilityHref={capabilityHref}
                  threadCounts={threadCounts}
                  commentsOnlyFilter={commentsOnlyFilter}
                  colourBy={colourBy}
                  routeViaPlatforms={routeViaPlatforms}
                  focusedElementId={focusedElementId}
                  onFocusElement={setFocusedElementId}
                  centreOn={centreRequest}
                  platformIdByInterfaceId={state.data.platformIdByInterfaceId}
                  onClearFocus={() => {
                    setFocusedElementId(null);
                  }}
                  showConnections={showConnections}
                  onOpenFilterBar={openFilterBar}
                  onCommentMarkerClick={(elementId) => {
                    setCommentsPanelElementId(elementId);
                    setAutoFocusComposer(false);
                  }}
                  onToggleCommentsPanel={(elementId) => {
                    if (commentsPanelElementId !== null) {
                      setCommentsPanelElementId(null);
                    } else if (elementId) {
                      setCommentsPanelElementId(elementId);
                      setAutoFocusComposer(false);
                    }
                  }}
                  onNewCommentShortcut={(elementId) => {
                    setCommentsPanelElementId(elementId);
                    setAutoFocusComposer(true);
                  }}
                />
                <Inspector
                  collapsed={inspectorCollapsed}
                  onToggleCollapsed={() => {
                    setInspectorCollapsed(!inspectorCollapsed);
                  }}
                  hasSelection={focusedElementId !== null}
                >
                  <LandscapeInspectorContent
                    focusedElement={focusedElement}
                    neighbours={inspectorNeighbours}
                    ownersByRole={inspectorOwnersByRole}
                    supports={inspectorSupports}
                    elementHref={elementHref}
                    contextHref={focusedElement && focusedElement.element_type !== 'actor' ? nodeHref : undefined}
                    onClearFocus={() => {
                      setFocusedElementId(null);
                    }}
                    routeViaPlatforms={routeViaPlatforms}
                    onRouteViaPlatformsChange={setRouteViaPlatforms}
                    showConnections={showConnections}
                    onShowConnectionsChange={setShowConnections}
                    showOwners={showOwners}
                    onShowOwnersChange={setShowOwners}
                    lanes={displayState.display.layout.lanes}
                    laneOptions={orderedLaneOptions}
                    pinnedLaneKeys={pinnedLaneKeys}
                    hiddenLaneKeys={hiddenLaneKeys}
                    onSetLaneCollapsed={setLaneCollapsed}
                    onSetLanePinned={setLanePinned}
                    onReorderPinnedLane={reorderPinnedLane}
                    onSetLaneHidden={setLaneHidden}
                    filters={filters}
                    onFiltersChange={(next) => {
                      setSearchParams((prev) => landscapeFiltersToSearchParams(next, prev));
                    }}
                    capabilityOptions={capabilityOptions}
                    filtersSectionRef={filtersSectionRef}
                  />
                </Inspector>
                {commentsPanelElementId && (
                  <CommentsPanel
                    orgId={organisation?.id ?? ''}
                    modelId={model.id}
                    userId={userId}
                    role={role}
                    anchorType="element"
                    anchorId={commentsPanelElementId}
                    subjectName={state.data.systemsById.get(commentsPanelElementId)?.name ?? ''}
                    unresolvedCount={threadCounts?.get(commentsPanelElementId)?.open ?? 0}
                    branchId={ref.kind === 'branch' ? (editingBranch?.id ?? null) : null}
                    viewKind="landscape"
                    autoFocusComposer={autoFocusComposer}
                    onClose={() => {
                      setCommentsPanelElementId(null);
                    }}
                  />
                )}
              </div>
            )}
          </>
        )}
        </main>
      </div>
    </div>
  );
}

/** Every tile the landscape is drawing, as "Find on this landscape" options — systems and actors, alphabetical. */
function findOptions(layout: { nodes: readonly { elementId: UUID }[]; actorNodes: readonly { elementId: UUID }[] }, systemsById: ReadonlyMap<UUID, ElementsHeadRow>, actorsById: ReadonlyMap<UUID, ElementsHeadRow>): LandscapeFindOption[] {
  const options: LandscapeFindOption[] = [];
  for (const node of layout.nodes) {
    const element = systemsById.get(node.elementId);
    if (element) options.push({ elementId: element.element_id, name: element.name, detail: element.element_type });
  }
  for (const node of layout.actorNodes) {
    const element = actorsById.get(node.elementId);
    if (element) options.push({ elementId: element.element_id, name: element.name, detail: 'actor' });
  }
  return options.sort((a, b) => a.name.localeCompare(b.name) || a.elementId.localeCompare(b.elementId));
}

/** The mobile list's version of `findOptions`: every actor and every system placed in a group (a system referenced in a second lane is still one row, so each id is offered once). */
function findOptionsFromGroups(groups: { actors: readonly ElementsHeadRow[]; groups: readonly { members: readonly { system: ElementsHeadRow }[] }[] }): LandscapeFindOption[] {
  const byId = new Map<UUID, LandscapeFindOption>();
  for (const actor of groups.actors) byId.set(actor.element_id, { elementId: actor.element_id, name: actor.name, detail: 'actor' });
  for (const group of groups.groups) for (const { system } of group.members) byId.set(system.element_id, { elementId: system.element_id, name: system.name, detail: system.element_type });
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.elementId.localeCompare(b.elementId));
}

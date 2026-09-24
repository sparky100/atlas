import { useId, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Button } from '../components/Button/Button';
import { CommentsPanel } from '../components/CommentsPanel/CommentsPanel';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ViewingBranchBanner } from '../branches/ViewingBranchBanner/ViewingBranchBanner';
import { useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { isViewingMode } from '../branches/viewingMode';
import { useThreadCounts } from '../comments/useThreadCounts';
import { useModels } from '../models/useModels';
import { canBackfillCapabilityOrder, canEditOnMain, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refLabelOf, refQueryParam } from '../../db/ref';
import { BackfillCapabilityOrderAction } from '../capabilityMap/BackfillCapabilityOrderAction';
import { CapabilityMapAddForm } from '../capabilityMap/CapabilityMapAddForm';
import { CapabilityMapImportPanel } from '../capabilityMap/CapabilityMapImportPanel';
import { CapabilityMapInspectorContent } from '../capabilityMap/CapabilityMapInspectorContent';
import { capabilityMapLevelOf } from '../capabilityMap/capabilityMapInspectorSelection';
import { CapabilityMapView } from '../capabilityMap/CapabilityMapView';
import { ExportCapabilityMapAction } from '../capabilityMap/ExportCapabilityMapAction';
import { tileCapabilityIds } from '../capabilityMap/layout';
import { useBackfillCapabilityOrder } from '../capabilityMap/useBackfillCapabilityOrder';
import { useCapabilityMap } from '../capabilityMap/useCapabilityMap';
import { useColourByPreference } from '../capabilityMap/useColourByPreference';
import { Inspector } from '../components/Inspector/Inspector';
import { useInspectorCollapsedPreference } from '../components/Inspector/useInspectorCollapsedPreference';
import { useHomeMode } from '../home/useHomeMode';
import { downloadImportPrompt } from '../import/downloadImportPrompt';
import { useRouteTiming } from '../perf/useRouteTiming';
import { supabase } from '../supabaseClient';
import styles from './CapabilityMapPage.module.css';

/**
 * The capability map (UI-principles §6.1, §3.1 — Sprint U2 step 1): the
 * model's own capability elements, nested by nothing more than
 * `parent_id`. This is the zoom chain's first stop (§2.1): every tile's
 * supporting-system count is also a link into the landscape filtered to
 * exactly those systems (Sprint U2 step 3 — see CapabilityMapView.tsx's
 * own comment); from there, Context, Container and Component are the
 * remaining four levels.
 *
 * Sprint U2 step 2's tailoring flow lives here too: `refNotFound` (an
 * unknown tag or branch ref — never main any more, since ADR-018 gives
 * every model's main branch a real genesis commit the instant it's
 * created) still gets the import panel for that case. The empty-map
 * moment that matters in practice — main resolves fine but has no
 * capabilities yet — is `ready` with an empty tree: the import panel
 * (seed from a starter map, the primary action once any map is published)
 * shows there, and "+ Add capability" (this page's own header action
 * area, Sprint U4-1 C5 — always available whenever `canEdit`, whether
 * the map is empty or not, not just CapabilityMapView's own former
 * empty-state fallback) is already visible above it — both owner/
 * architect only, same gate as `Edit` (ADR-015).
 *
 * Sprint U4-2a check B5: "Export as starter map" (Sprint U4-1 C6's
 * owner-only maintenance action) sits in a "⋯" overflow menu beside
 * "+ Add capability", not as a button of its own below the header — same
 * always-collapsed `menuWrapper`/`menuToggle`/`menu` pattern
 * `ElementHeader.tsx`'s own overflow menu uses. Gated on the tree being
 * non-empty (same condition the old standalone row used) — nothing to
 * export from an empty map.
 *
 * S1 item 13: "'Backfill capability order' owner action in the overflow
 * menu" joins Export in the same menu, gated narrower still
 * (`canBackfillCapabilityOrder` — owner only, not owner/architect) since
 * the prompt's own wording calls it out as an owner action specifically.
 * Idempotent (`useBackfillCapabilityOrder.ts`'s own comment) — safe to
 * leave in the menu rather than needing to time its removal to the moment
 * every model happens to be caught up.
 *
 * Sprint U4-2b item 5: "Sync descriptions from starter map" is gone from
 * this menu (and from the UI entirely — `SyncDescriptionsAction.tsx`/
 * `useSyncDescriptions.ts` deleted). It was a one-off repair action for
 * models seeded before Bug A2's fix (commit 4e63ca5) — real maintenance
 * surface for a one-time data problem, not a standing part of this page's
 * own workflow. The underlying repair still exists as
 * `scripts/syncDescriptionsFromMap.ts` (that script's own comment names
 * when it's safe to delete entirely).
 *
 * Check D1: `<main>` escapes the page's usual centred max-width once the
 * map has real content (`hasContent`, below) — `.mainWithMap`'s own
 * comment in this file's module CSS has the full reasoning, same pattern
 * `LandscapePage.tsx`'s `hasCanvas`/`.mainWithCanvas` already uses.
 */
export function CapabilityMapPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams] = useSearchParams();
  const { ref } = useSelectedRef();
  const viewing = isViewingMode(searchParams);
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canEdit = ref.kind === 'main' && canEditOnMain(role);
  const { branch: mainBranch, reload: reloadMainBranch } = useMainBranch(model?.id ?? null);

  // #244: no As-is/To-be/Diff selector on this page (unlike LandscapePage's
  // `?mode=` control) — always the branch's own current state, the same
  // default `parseViewMode` itself falls back to when `?mode=` is absent.
  const { state, reload } = useCapabilityMap(model?.id ?? '', organisation?.id ?? '', userId, ref, 'toBe', mainBranch?.head_commit_id ?? null);
  // E8 ("performance") phase 1: this route's own resolve/first-paint/data-complete marks — see useRouteTiming.ts's own module comment.
  useRouteTiming('capability-map', state.status === 'ready');
  // S2 flow 1 bug fix: every mutation on this page (importing a starter
  // map, adding a capability, reordering one, backfilling order) commits
  // to main, moving its head — the caller must refresh `mainBranch` itself
  // (`useMainBranch.ts`'s own reload doc comment: "call after any commit
  // that may have moved main's head"), not just re-run `useCapabilityMap`
  // at the *old*, now-stale `head_commit_id` it was given. Every one of
  // this page's own `onCreated`/`onReordered`/`onBackfilled`/`onImported`
  // callbacks used to pass the bare `reload` above and hit exactly this:
  // the mutation genuinely lands (a real commit is created server-side)
  // but the page keeps re-fetching the commit from before it, so nothing
  // ever appears to change. `reloadAll` is every one of those callbacks
  // now.
  const reloadAll = () => {
    reloadMainBranch();
    reload();
  };
  // S1 item 13: called unconditionally here (not inside `BackfillCapabilityOrderAction`
  // itself) — see that component's own module comment for why owning this
  // hook one level up, in a component that stays mounted across the
  // `reload` it triggers, is what lets its own success message survive to
  // be seen at all.
  const backfillOrder = useBackfillCapabilityOrder({ modelId: model?.id ?? '', userId, onBackfilled: reloadAll });

  // Sprint U4-1 C4: "exposure for director home mode, coverage for
  // architect" — the same home_mode this org's ModelHome.tsx switches
  // doors on, not a capability-map-local concept. `hasSystems` only
  // exists once the load resolves; `false` while it hasn't is a harmless
  // transient default (colourBy isn't rendered anywhere until `ready`).
  const { homeMode } = useHomeMode(userId, canEditOnMain(role));
  const { colourBy, setColourBy } = useColourByPreference(userId, homeMode, state.status === 'ready' ? state.data.hasSystems : false);
  // Sprint U4-2a item 3: owned here, not inside CapabilityMapView itself —
  // that component gets unmounted/remounted by this page's own
  // `state.status === 'ready' &&` gate every time a reorder's `onReordered`
  // triggers `reload` (state cycles through 'loading' first), which would
  // silently reset a toggle living inside it back to `false` after every
  // single move. See CapabilityMapView.tsx's own prop comment.
  const [reorderMode, setReorderMode] = useState(false);
  // S1 item 13: which L2 cards have their L3 children expanded — lifted
  // here for exactly the same reason `reorderMode` already is (its own
  // comment above): an L3 reorder's own `onReordered` triggers this same
  // `reload`-cycled remount of `CapabilityMapView`, which would otherwise
  // silently collapse every expanded L2 back to closed right after a
  // successful move.
  const [expanded, setExpanded] = useState<Set<UUID>>(new Set());
  const toggleExpanded = (id: UUID): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // Capability map redesign: domains collapsed by default, one open at a
  // time — the same single-open accordion shape this page's pre-redesign
  // mobile-only treatment already used (`expandedL1`), now the only
  // interaction model at every width. `null` (collapsed) unless deep-
  // linked into via `?domain=<capabilityId>` (e.g. "Open capability map →"
  // from a specific domain on Home) — the lazy initializer reads
  // `searchParams` once, on this component's first mount only, the same
  // "session-only, not persisted" state `expanded` above already is (and
  // for the same reload/remount-survival reason — see that state's own
  // comment). An id that doesn't match any real domain is harmless: no
  // row ever matches it, so it just never renders expanded.
  const [expandedDomainId, setExpandedDomainId] = useState<UUID | null>(() => searchParams.get('domain'));
  const toggleDomain = (id: UUID): void => {
    setExpandedDomainId((prev) => (prev === id ? null : id));
  };
  // Sprint U4-2a check B5: "Sync descriptions"/"Export as starter map" move
  // from two always-visible buttons of their own into one "⋯" overflow
  // menu beside "+ Add capability" — same always-collapsed pattern
  // ElementHeader.tsx's own overflow menu uses (ElementHeader.module.css's
  // own comment: unlike LandscapePage's E1 disclosures, this one isn't
  // viewport-conditional, so no `useIsNarrowViewport` here).
  const [maintenanceMenuOpen, setMaintenanceMenuOpen] = useState(false);
  const maintenanceMenuId = useId();

  // M1 close-out item 2: "markers on tiles (bottom-right, same rule) and
  // the panel" — same shape LandscapePage.tsx's own comments panel state
  // already uses (a single open-panel id, hover has no equivalent here
  // since tiles aren't a hover surface the way canvas nodes are).
  const [commentsPanelCapabilityId, setCommentsPanelCapabilityId] = useState<UUID | null>(null);
  const anchorIds = state.status === 'ready' ? tileCapabilityIds(state.data.tree) : [];
  const threadCountsState = useThreadCounts(model?.id ?? null, anchorIds);
  const threadCounts = threadCountsState.status === 'ready' ? threadCountsState.counts : undefined;
  const commentsPanelCapabilityName =
    state.status === 'ready' && commentsPanelCapabilityId
      ? (state.data.tree.l1.flatMap((column) => column.l2.flatMap((card) => [card.capability, ...card.l3])).find((c) => c.element_id === commentsPanelCapabilityId)?.name ?? '')
      : '';

  // V2b: the shared Inspector's own "which row is inspected" state — same
  // single-open-id shape `commentsPanelCapabilityId` above already uses,
  // opened via `CapabilityMapView`'s own `onInspectClick` (a small inline
  // button rendered at every level, since this view has no click-to-focus
  // concept of its own to repurpose — every row's primary link still
  // navigates, unchanged).
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<UUID | null>(null);
  const { collapsed: inspectorCollapsed, setCollapsed: setInspectorCollapsed } = useInspectorCollapsedPreference(userId);

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Text tone="muted">Loading…</Text>
          </main>
        </div>
      </div>
    );
  }

  const refParam = refQueryParam(ref, viewing);
  // Check D1: same "only once there's real content" condition
  // LandscapePage.tsx's own `hasCanvas` uses — the empty-map/import-panel
  // state keeps the ordinary centred column, since there's no map yet to
  // give the width to.
  const hasContent = state.status === 'ready' && (state.data.tree.l1.length > 0 || state.data.tree.orphans.length > 0);
  // V2b Inspector: the selected tile's own row and level — looked up fresh
  // from this render's own `state.data` rather than cached alongside the
  // id, so a reload (an import, an add, a reorder) that changes the tree
  // never leaves the Inspector pointing at a stale row.
  const selectedCapability = state.status === 'ready' && selectedCapabilityId ? (state.data.capabilities.find((c) => c.element_id === selectedCapabilityId) ?? null) : null;
  const selectedLevel = state.status === 'ready' && selectedCapabilityId ? capabilityMapLevelOf(selectedCapabilityId, state.data.tree) : null;

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={[styles.main, hasContent ? styles.mainWithMap : ''].filter(Boolean).join(' ')}>
        {viewing ? <ViewingBranchBanner activeRef={ref} /> : <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />}
        <Breadcrumb
          org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
          model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
          refLabel={refLabelOf(ref)}
        />
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            Capability map
          </Text>
          {canEdit && mainBranch && state.status === 'ready' && (
            <div className={styles.actions}>
              <CapabilityMapAddForm
                tree={state.data.tree}
                modelId={model.id}
                orgId={organisation?.id ?? ''}
                userId={userId}
                branch={mainBranch}
                expectedHeadCommitId={state.data.commitId}
                onCreated={reloadAll}
              />
              {(state.data.tree.l1.length > 0 || state.data.tree.orphans.length > 0) && (
                <div className={styles.menuWrapper}>
                  <button
                    type="button"
                    className={styles.menuToggle}
                    aria-expanded={maintenanceMenuOpen}
                    aria-controls={maintenanceMenuId}
                    aria-label="Capability map actions"
                    onClick={() => {
                      setMaintenanceMenuOpen((o) => !o);
                    }}
                  >
                    <span aria-hidden="true">⋯</span>
                  </button>
                  <div id={maintenanceMenuId} className={[styles.menu, maintenanceMenuOpen ? styles.open : ''].filter(Boolean).join(' ')}>
                    <ExportCapabilityMapAction
                      modelId={model.id}
                      modelName={model.name}
                      orgName={organisation?.name ?? ''}
                      orgSlug={organisation?.slug ?? ''}
                      modelSlug={model.slug}
                      userId={userId}
                    />
                    {/* S1 item 13: owner-only, narrower than the `canEdit` gate this whole menu is already behind — see `canBackfillCapabilityOrder`'s own comment. */}
                    {canBackfillCapabilityOrder(role) && (
                      <BackfillCapabilityOrderAction status={backfillOrder.status} message={backfillOrder.message} error={backfillOrder.error} onBackfill={() => { void backfillOrder.backfill(); }} />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && canEdit && (
          <>
            <CapabilityMapImportPanel modelId={model.id} userId={userId} onImported={reloadAll} />
            <Button variant="ghost" onClick={() => void downloadImportPrompt(supabase, model.id, model.slug)}>
              Download AI import prompt
            </Button>
          </>
        )}
        {state.status === 'refNotFound' && !canEdit && <Text as="p">Nothing here yet.</Text>}
        {state.status === 'ready' && state.data.tree.l1.length === 0 && state.data.tree.orphans.length === 0 && canEdit && (
          <>
            <CapabilityMapImportPanel modelId={model.id} userId={userId} onImported={reloadAll} />
            <Button variant="ghost" onClick={() => void downloadImportPrompt(supabase, model.id, model.slug)}>
              Download AI import prompt
            </Button>
          </>
        )}
        {state.status === 'ready' && (() => {
          const reorderCapability = canEdit && mainBranch ? { modelId: model.id, orgId: organisation?.id ?? '', userId, branch: mainBranch, expectedHeadCommitId: state.data.commitId, onReordered: reloadAll } : undefined;
          return (
            <div className={hasContent ? styles.mapRow : undefined}>
              <CapabilityMapView
                tree={state.data.tree}
                supportsEdges={state.data.supportsEdges}
                enablesEdges={state.data.enablesEdges}
                systemsById={state.data.systemsById}
                capabilities={state.data.capabilities}
                selfOwnedIds={state.data.selfOwnedIds}
                colourBy={colourBy}
                orgSlug={organisation?.slug ?? ''}
                modelSlug={model.slug}
                refParam={refParam}
                reorderCapability={reorderCapability}
                reorderMode={reorderMode}
                expandedDomainId={expandedDomainId}
                onToggleDomain={toggleDomain}
                expanded={expanded}
                onToggleExpand={toggleExpanded}
                threadCounts={threadCounts}
                onCommentMarkerClick={setCommentsPanelCapabilityId}
                onInspectClick={setSelectedCapabilityId}
              />
              {/* V2b: net-new on this view (no prior focus/filter panel to replace) — gated on `hasContent` the same way colour-by's own control used to be (`capability-map-actions.engine.spec.ts`'s own "no view content for it to control yet"), since an empty map has nothing to inspect or filter either. */}
              {hasContent && (
                <Inspector
                  collapsed={inspectorCollapsed}
                  onToggleCollapsed={() => {
                    setInspectorCollapsed(!inspectorCollapsed);
                  }}
                  hasSelection={selectedCapabilityId !== null}
                >
                  <CapabilityMapInspectorContent
                    selectedCapability={selectedCapability}
                    selectedLevel={selectedLevel}
                    supportsEdges={state.data.supportsEdges}
                    systemsById={state.data.systemsById}
                    ownsEdges={state.data.ownsEdges}
                    actorsById={state.data.actorsById}
                    selfOwnedIds={state.data.selfOwnedIds}
                    elementHref={(elementId) => `/o/${orgSlug ?? ''}/m/${model.slug}/e/${elementId}?${refParam}`}
                    orgSlug={organisation?.slug ?? ''}
                    modelSlug={model.slug}
                    refParam={refParam}
                    colourBy={colourBy}
                    onColourByChange={setColourBy}
                    hasSystems={state.data.hasSystems}
                    reorderMode={reorderMode}
                    onReorderModeChange={setReorderMode}
                    canReorder={reorderCapability !== undefined}
                  />
                </Inspector>
              )}
            </div>
          );
        })()}
        {commentsPanelCapabilityId && (
          <CommentsPanel
            orgId={organisation?.id ?? ''}
            modelId={model.id}
            userId={userId}
            role={role}
            anchorType="element"
            anchorId={commentsPanelCapabilityId}
            subjectName={commentsPanelCapabilityName}
            unresolvedCount={threadCounts?.get(commentsPanelCapabilityId)?.open ?? 0}
            branchId={ref.kind === 'branch' ? ref.branchId : null}
            viewKind="capability_map"
            onClose={() => {
              setCommentsPanelCapabilityId(null);
            }}
          />
        )}
        </main>
      </div>
    </div>
  );
}

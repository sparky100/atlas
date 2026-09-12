import { useId, useState } from 'react';
import { useParams } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { CommentsPanel } from '../components/CommentsPanel/CommentsPanel';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { useThreadCounts } from '../comments/useThreadCounts';
import { useModels } from '../models/useModels';
import { canEditOnMain, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refLabelOf, refParamOf } from '../../db/ref';
import { CapabilityMapAddForm } from '../capabilityMap/CapabilityMapAddForm';
import { CapabilityMapImportPanel } from '../capabilityMap/CapabilityMapImportPanel';
import { CapabilityMapView } from '../capabilityMap/CapabilityMapView';
import { ExportCapabilityMapAction } from '../capabilityMap/ExportCapabilityMapAction';
import { tileCapabilityIds } from '../capabilityMap/layout';
import { useCapabilityMap } from '../capabilityMap/useCapabilityMap';
import { useColourByPreference } from '../capabilityMap/useColourByPreference';
import { useHomeMode } from '../home/useHomeMode';
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
  const { ref } = useSelectedRef();
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canEdit = ref.kind === 'main' && canEditOnMain(role);
  const { branch: mainBranch } = useMainBranch(model?.id ?? null);

  const { state, reload } = useCapabilityMap(model?.id ?? '', organisation?.id ?? '', userId, ref);

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

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Text tone="muted">Loading…</Text>
          </main>
        </div>
      </div>
    );
  }

  const refParam = refParamOf(ref);
  // Check D1: same "only once there's real content" condition
  // LandscapePage.tsx's own `hasCanvas` uses — the empty-map/import-panel
  // state keeps the ordinary centred column, since there's no map yet to
  // give the width to.
  const hasContent = state.status === 'ready' && (state.data.tree.l1.length > 0 || state.data.tree.orphans.length > 0);

  return (
    <div>
      <AppHeader />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={[styles.main, hasContent ? styles.mainWithMap : ''].filter(Boolean).join(' ')}>
        <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />
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
                onCreated={reload}
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
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && canEdit && <CapabilityMapImportPanel modelId={model.id} userId={userId} onImported={reload} />}
        {state.status === 'refNotFound' && !canEdit && <Text as="p">This model has no commits yet at this ref.</Text>}
        {state.status === 'ready' && state.data.tree.l1.length === 0 && state.data.tree.orphans.length === 0 && canEdit && (
          <CapabilityMapImportPanel modelId={model.id} userId={userId} onImported={reload} />
        )}
        {state.status === 'ready' && (
          <CapabilityMapView
            tree={state.data.tree}
            supportsEdges={state.data.supportsEdges}
            systemsById={state.data.systemsById}
            hasSystems={state.data.hasSystems}
            colourBy={colourBy}
            onColourByChange={setColourBy}
            orgSlug={organisation?.slug ?? ''}
            modelSlug={model.slug}
            refParam={refParam}
            reorderCapability={
              canEdit && mainBranch ? { modelId: model.id, orgId: organisation?.id ?? '', userId, branch: mainBranch, expectedHeadCommitId: state.data.commitId, onReordered: reload } : undefined
            }
            reorderMode={reorderMode}
            onReorderModeChange={setReorderMode}
            threadCounts={threadCounts}
            onCommentMarkerClick={setCommentsPanelCapabilityId}
          />
        )}
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

import { useId, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useMainBranch } from '../branches/useMainBranch';
import { useModels } from '../models/useModels';
import { canEditOnMain, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { parseRefParam, refLabelOf, refParamOf } from '../../db/ref';
import { CapabilityMapAddForm } from '../capabilityMap/CapabilityMapAddForm';
import { CapabilityMapImportPanel } from '../capabilityMap/CapabilityMapImportPanel';
import { CapabilityMapView } from '../capabilityMap/CapabilityMapView';
import { ExportCapabilityMapAction } from '../capabilityMap/ExportCapabilityMapAction';
import { SyncDescriptionsAction } from '../capabilityMap/SyncDescriptionsAction';
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
 * Sprint U4-2a check B5: "Sync descriptions"/"Export as starter map"
 * (Sprint U4-1 C6's owner-only maintenance actions) sit in a "⋯" overflow
 * menu beside "+ Add capability", not as two buttons of their own below
 * the header — same always-collapsed `menuWrapper`/`menuToggle`/`menu`
 * pattern `ElementHeader.tsx`'s own overflow menu uses. Gated on the tree
 * being non-empty (same condition the old standalone row used) — nothing
 * to sync or export from an empty map.
 */
export function CapabilityMapPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams] = useSearchParams();
  const ref = parseRefParam(searchParams.get('ref'));
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

  return (
    <div>
      <AppHeader />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
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
                    <SyncDescriptionsAction modelId={model.id} userId={userId} onSynced={reload} />
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
          />
        )}
        </main>
      </div>
    </div>
  );
}

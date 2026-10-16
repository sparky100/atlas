import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb, type BreadcrumbSegment } from '../components/Breadcrumb/Breadcrumb';
import { Inspector } from '../components/Inspector/Inspector';
import { useInspectorCollapsedPreference } from '../components/Inspector/useInspectorCollapsedPreference';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refLabelOf, refQueryParam } from '../../db/ref';
import { parseViewMode } from '../../db/viewMode';
import { BranchViewModeControl } from '../branches/BranchViewModeControl';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ViewingBranchBanner } from '../branches/ViewingBranchBanner/ViewingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { isViewingMode } from '../branches/viewingMode';
import { ContextInspectorContent } from '../context/ContextInspectorContent';
import { contextInspectorFocusedNeighbour } from '../context/contextInspectorSelection';
import { ContextView } from '../context/ContextView';
import { IntegrationPlatformContextView } from '../context/IntegrationPlatformContextView';
import { PlatformStructureView } from '../context/PlatformStructureView';
import { useElementContext } from '../context/useElementContext';
import { useIsNarrowViewport } from '../landscape/useIsNarrowViewport';
import { parseCapabilityParam } from '../nav/zoomParams';
import { useBreadcrumbElement } from '../nav/useBreadcrumbElement';
import styles from './ViewPage.module.css';

/**
 * The Context view route (UI-principles §6.1/§2.1 — Sprint U2 step 3): one
 * system or container, everything it connects to. The zoom chain's third
 * stop (capability → landscape → **context** → containers).
 *
 * V3 ("container context pages, platform context simplified to structure
 * only") extends this route from systems-only to any container too (item
 * 1 — a container is structurally terminal since "component" was removed,
 * S1 item 18, so it needs its own Context page rather than none at all),
 * and branches a platform-with-modules hub to `PlatformStructureView.tsx`
 * instead of the ordinary neighbour diagram (item 2). The breadcrumb grows
 * one segment for a container hub — its own platform parent, resolved via
 * `useBreadcrumbElement.ts` the same way the old Component page once
 * resolved a container's own parent system (that hook's own doc comment) —
 * giving the user's own named example, "DNO > Base > main > SAP > SAP FI".
 *
 * Check D1: `<main>` escapes the page's usual centred max-width once
 * there's real content (`ViewPage.module.css`'s own `.mainWithView`
 * comment has the full reasoning, shared with Container).
 */
export function ContextPage() {
  const { orgSlug, modelSlug, elementId } = useParams<{ orgSlug: string; modelSlug: string; elementId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { ref } = useSelectedRef();
  const viewing = isViewingMode(searchParams);
  const mode = parseViewMode(searchParams.get('mode'));
  const capabilityId = parseCapabilityParam(searchParams.get('capability'));
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const capability = useBreadcrumbElement(model?.id ?? null, ref, capabilityId);
  const { label: branchLabel } = useBranchLabel(ref);
  const { branch: mainBranch } = useMainBranch(model?.id ?? null);

  const state = useElementContext(model?.id ?? '', organisation?.id ?? '', userId, elementId ?? '', ref, mode);
  // See ElementPage.tsx's identical effect for why this is a real
  // navigate(-1) rather than a fallback route.
  useEffect(() => {
    if (state.status === 'notPresentAtRef') void navigate(-1);
  }, [state.status, navigate]);

  const hub = state.status === 'ready' ? (state.data.kind === 'group' ? state.data.group.hub : state.data.hub) : null;
  // V3 item 1's own breadcrumb example ("DNO > Base > main > SAP > SAP FI"):
  // a container hub's own platform parent, resolved the same "just omit
  // that one segment" way every other breadcrumb lookup here already
  // works — `hub.parent_id` is `null` for a standalone solution container,
  // which simply means no extra segment, not an error.
  const platformParentId = hub?.element_type === 'container' ? hub.parent_id : null;
  const platformParent = useBreadcrumbElement(model?.id ?? null, ref, platformParentId, mainBranch?.head_commit_id ?? null);

  // V2b's Inspector, Context rollout: click-to-focus on the diagram's own
  // desktop canvas (`ContextDiagramCanvas.tsx`'s own doc comment) — the
  // hub never enters focus (it already has a permanent header), so this
  // only ever names a neighbour. `narrow` is computed here too, not just
  // inside `ContextView.tsx` — the Inspector is desktop-canvas only (like
  // Landscape's own, never Capability map's, since the mobile list's own
  // rows already show everything Selection/Connections would add).
  const [rawFocusedElementId, setRawFocusedElementId] = useState<UUID | null>(null);
  const { collapsed: inspectorCollapsed, setCollapsed: setInspectorCollapsed } = useInspectorCollapsedPreference(userId);
  const narrow = useIsNarrowViewport(768);
  const group = state.status === 'ready' && state.data.kind === 'group' ? state.data.group : null;
  const focusedNeighbour = group ? contextInspectorFocusedNeighbour(rawFocusedElementId, group) : null;
  // A stale id (the group reloaded and no longer names this neighbour)
  // reads as unfocused instead of holding onto a dangling id — same
  // "derived, never written back" shape `LandscapePage.tsx`'s own
  // `focusedElementId` uses.
  const focusedElementId = focusedNeighbour ? rawFocusedElementId : null;

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
  const segments: BreadcrumbSegment[] = [];
  if (capability) segments.push({ label: capability.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/capability-map?${refParam}` });
  if (platformParent) segments.push({ label: platformParent.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/context/${platformParent.element_id}?${refParam}` });
  if (hub) segments.push({ label: hub.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/context/${elementId ?? ''}?${refParam}` });

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={[styles.main, state.status === 'ready' ? styles.mainWithView : ''].filter(Boolean).join(' ')}>
        {viewing ? <ViewingBranchBanner activeRef={ref} /> : <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} />}
        <Breadcrumb
          org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
          model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
          refLabel={refLabelOf(ref, branchLabel)}
          segments={segments}
        />
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            Context
          </Text>
        </div>

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

        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && <Text as="p">Nothing here yet.</Text>}
        {state.status === 'notPresentAtRef' && <Text tone="muted">Going back…</Text>}
        {state.status === 'ready' && state.data.kind === 'platform-structure' && (
          <PlatformStructureView
            hub={state.data.hub}
            modules={state.data.modules}
            connections={state.data.connections}
            orgSlug={organisation?.slug ?? ''}
            modelSlug={model.slug}
            refParam={refParam}
            diff={state.data.diff}
          />
        )}
        {state.status === 'ready' && state.data.kind === 'integration-platform' && (
          <IntegrationPlatformContextView
            hub={state.data.hub}
            flows={state.data.flows}
            endpoints={state.data.endpoints}
            interfaces={state.data.interfaces}
            orgSlug={organisation?.slug ?? ''}
            modelSlug={model.slug}
            refParam={refParam}
          />
        )}
        {state.status === 'ready' && state.data.kind === 'group' && (
          <div className={narrow ? undefined : styles.contextRow}>
            <ContextView
              group={state.data.group}
              orgSlug={organisation?.slug ?? ''}
              modelSlug={model.slug}
              refParam={refParam}
              diff={state.data.diff}
              focusedElementId={focusedElementId}
              onFocusElement={setRawFocusedElementId}
              onClearFocus={() => {
                setRawFocusedElementId(null);
              }}
            />
            {/* V2b: desktop-canvas only — see this component's own comment above `narrow`. */}
            {!narrow && (
              <Inspector
                collapsed={inspectorCollapsed}
                onToggleCollapsed={() => {
                  setInspectorCollapsed(!inspectorCollapsed);
                }}
                hasSelection={focusedElementId !== null}
              >
                <ContextInspectorContent
                  group={state.data.group}
                  focusedElementId={focusedElementId}
                  elementHref={(id) => `/o/${orgSlug ?? ''}/m/${model.slug}/e/${id}?${refParam}`}
                  neighbourContextHref={(id) => `/o/${orgSlug ?? ''}/m/${model.slug}/context/${id}?${refParam}`}
                  onClearFocus={() => {
                    setRawFocusedElementId(null);
                  }}
                />
              </Inspector>
            )}
          </div>
        )}
        </main>
      </div>
    </div>
  );
}

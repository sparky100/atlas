import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Inspector } from '../components/Inspector/Inspector';
import { useInspectorCollapsedPreference } from '../components/Inspector/useInspectorCollapsedPreference';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ViewingBranchBanner } from '../branches/ViewingBranchBanner/ViewingBranchBanner';
import { useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { isViewingMode } from '../branches/viewingMode';
import { useModels } from '../models/useModels';
import { useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refLabelOf, refQueryParam } from '../../db/ref';
import { useIsNarrowViewport } from '../landscape/useIsNarrowViewport';
import { useRouteTiming } from '../perf/useRouteTiming';
import { useValueStreams } from '../valueStreams/useValueStreams';
import { ValueStreamInspectorContent } from '../valueStreams/ValueStreamInspectorContent';
import { ValueStreamsMobileList } from '../valueStreams/ValueStreamsMobileList';
import { ValueStreamsView } from '../valueStreams/ValueStreamsView';
import styles from './ValueStreamsPage.module.css';

/**
 * The Value streams page (F6/ADR-023): one row per stream, stages left to
 * right as tiles coloured by the shared rollup — the sprint's first named
 * view. No editing on this page yet (Step 5) — read-only, same as the
 * capability map's own map/Inspector split before its own add/reorder
 * controls existed. Desktop uses the shared `Inspector` panel
 * (`CapabilityMapPage.tsx`'s own precedent); below 768px
 * (`useIsNarrowViewport`, the app's one mobile breakpoint) the same
 * `ValueStreamInspectorContent` renders inline under the tapped stage
 * instead (`ValueStreamsMobileList.tsx`'s own accordion).
 */
export function ValueStreamsPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams] = useSearchParams();
  const { ref } = useSelectedRef();
  const viewing = isViewingMode(searchParams);
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const { branch: mainBranch } = useMainBranch(model?.id ?? null);

  const state = useValueStreams(model?.id ?? null, ref, mainBranch?.head_commit_id ?? null);
  useRouteTiming('value-streams', state.status === 'ready');

  const narrow = useIsNarrowViewport(768);
  const [selectedStageId, setSelectedStageId] = useState<UUID | null>(null);
  const { collapsed: inspectorCollapsed, setCollapsed: setInspectorCollapsed } = useInspectorCollapsedPreference(userId);

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

  const refParam = refQueryParam(ref, viewing);
  const elementHref = (elementId: UUID) => `/o/${orgSlug ?? ''}/m/${model.slug}/e/${elementId}?${refParam}`;
  const decisionsHref = `/o/${orgSlug ?? ''}/m/${model.slug}/decisions`;
  const selectedStage = state.status === 'ready' && selectedStageId ? state.data.rows.flatMap((row) => row.stages).find((s) => s.stage.element_id === selectedStageId) ?? null : null;

  return (
    <div>
      <AppHeader />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          {viewing ? <ViewingBranchBanner activeRef={ref} /> : <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />}
          <Breadcrumb
            org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
            model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
            refLabel={refLabelOf(ref)}
          />
          <Text as="h1" size="2xl">
            Value streams
          </Text>

          {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
          {state.status === 'error' && <Text as="p">{state.message}</Text>}
          {state.status === 'refNotFound' && <Text as="p">Nothing here yet.</Text>}
          {state.status === 'ready' && !narrow && (
            <div className={styles.row}>
              <ValueStreamsView rows={state.data.rows} selectedStageId={selectedStageId} onInspectStage={setSelectedStageId} />
              <Inspector
                collapsed={inspectorCollapsed}
                onToggleCollapsed={() => {
                  setInspectorCollapsed(!inspectorCollapsed);
                }}
                hasSelection={selectedStageId !== null}
              >
                <ValueStreamInspectorContent
                  selectedStage={selectedStage}
                  valueStreamsById={state.data.valueStreamsById}
                  tilesByCapabilityId={state.data.tilesByCapabilityId}
                  elementHref={elementHref}
                  decisionsHref={decisionsHref}
                  role={role}
                />
              </Inspector>
            </div>
          )}
          {state.status === 'ready' && narrow && (
            <ValueStreamsMobileList
              rows={state.data.rows}
              selectedStageId={selectedStageId}
              onSelectStage={(stageId) => {
                setSelectedStageId((current) => (current === stageId ? null : stageId));
              }}
              renderStageDetail={(stage) => (
                <ValueStreamInspectorContent
                  selectedStage={stage}
                  valueStreamsById={state.data.valueStreamsById}
                  tilesByCapabilityId={state.data.tilesByCapabilityId}
                  elementHref={elementHref}
                  decisionsHref={decisionsHref}
                  role={role}
                />
              )}
            />
          )}
        </main>
      </div>
    </div>
  );
}

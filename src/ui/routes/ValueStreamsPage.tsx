import { Loading } from '../components/Loading/Loading';
import { ModelEmptyState } from '../components/EmptyState/ModelEmptyState';
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
import { ElementSearchAdd } from '../components/ElementSearchAdd/ElementSearchAdd';
import { ValueStreamGateNotice } from '../components/ValueStreamGateNotice/ValueStreamGateNotice';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ViewingBranchBanner } from '../branches/ViewingBranchBanner/ViewingBranchBanner';
import { useEditingBranch } from '../branches/useEditingBranch';
import { useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { isViewingMode } from '../branches/viewingMode';
import { useModels } from '../models/useModels';
import { canCreateChangeBranch, canEditValueStreamStructure, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refLabelOf, refParamOf, refQueryParam } from '../../db/ref';
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
 * view. Step 5 adds its own structural edit: "+ Add value stream"
 * (top-level, `ElementSearchAdd` — a stage's own "+ Add stage" and
 * reorder live on the stream's element page instead, `ValueStreamStagesSection.tsx`),
 * gated by `canEditValueStreamStructure` (main, or a correct-intent
 * change — ADR-023 Decision 1), with `ValueStreamGateNotice` explaining
 * the gate wherever it blocks someone who could otherwise edit. Desktop
 * uses the shared `Inspector` panel
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
  const { branch: editingBranch } = useEditingBranch(model?.id ?? null, ref);
  // F6 (ADR-023): "+ Add value stream" is a structural, top-level create —
  // same `canEditValueStreamStructure` gate as everything else this sprint
  // calls structural, not the plainer `canEditBranch` every other search-
  // first "+ Add" on this codebase uses.
  const canEditValueStream = !viewing && editingBranch !== null && canEditValueStreamStructure(role, editingBranch);
  const searchCommitId = mainBranch?.head_commit_id ?? null;

  const state = useValueStreams(model?.id ?? null, ref, mainBranch?.head_commit_id ?? null);
  useRouteTiming('value-streams', state.status === 'ready');

  const narrow = useIsNarrowViewport(768);
  const [selectedStageId, setSelectedStageId] = useState<UUID | null>(null);
  const { collapsed: inspectorCollapsed, setCollapsed: setInspectorCollapsed } = useInspectorCollapsedPreference(userId);

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

  const refParam = refQueryParam(ref, viewing);
  const elementHref = (elementId: UUID) => `/o/${orgSlug ?? ''}/m/${model.slug}/e/${elementId}?${refParam}`;
  const decisionsHref = `/o/${orgSlug ?? ''}/m/${model.slug}/decisions`;
  const selectedStage = state.status === 'ready' && selectedStageId ? state.data.rows.flatMap((row) => row.stages).find((s) => s.stage.element_id === selectedStageId) ?? null : null;

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          {viewing ? <ViewingBranchBanner activeRef={ref} /> : <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />}
          <Breadcrumb
            org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
            model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
            refLabel={refLabelOf(ref)}
          />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Value streams
            </Text>
            {state.status === 'ready' && editingBranch && canEditValueStream && searchCommitId && (
              <ElementSearchAdd
                elementType="value_stream"
                buttonLabel="+ Add value stream"
                parentId={null}
                modelId={model.id}
                orgId={organisation?.id ?? ''}
                userId={userId}
                searchCommitId={searchCommitId}
                branch={editingBranch}
                expectedHeadCommitId={state.data.commitId}
                orgSlug={organisation?.slug ?? ''}
                modelSlug={model.slug}
                refParam={refParamOf(ref)}
              />
            )}
            {state.status === 'ready' && !canEditValueStream && canCreateChangeBranch(role) && <ValueStreamGateNotice orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} />}
          </div>

          {state.status === 'loading' && <Loading />}
          {state.status === 'error' && <Text as="p">{state.message}</Text>}
          {state.status === 'refNotFound' && <ModelEmptyState orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />}
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

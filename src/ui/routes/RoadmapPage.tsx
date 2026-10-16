import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Button } from '../components/Button/Button';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ViewingBranchBanner } from '../branches/ViewingBranchBanner/ViewingBranchBanner';
import { hintedModelId, useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { isViewingMode } from '../branches/viewingMode';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refLabelOf } from '../../db/ref';
import { RoadmapFilterBar } from '../roadmap/RoadmapFilterBar';
import { RoadmapView } from '../roadmap/RoadmapView';
import { useRoadmap } from '../roadmap/useRoadmap';
import { useRoadmapExport } from '../roadmap/useRoadmapExport';
import { parseRoadmapFilters, roadmapFiltersToSearchParams, parseRoadmapGroupBy, roadmapGroupByToSearchParams, parseRoadmapGranularity, roadmapGranularityToSearchParams, parseRoadmapHorizon, roadmapHorizonToSearchParams, parseRoadmapStartMonth, roadmapStartMonthToSearchParams, type RoadmapGroupBy, type RoadmapGranularity, type RoadmapHorizon } from '../roadmap/roadmapFilterParams';
import { defaultRoadmapWindowStart, shiftRoadmapWindowStart } from '../roadmap/roadmapTimelineScale';
import type { RoadmapFilters } from '../roadmap/roadmapFilter';
import type { RoadmapMode } from '../roadmap/roadmapEligibility';
import styles from './RoadmapPage.module.css';

function parseRoadmapMode(searchParams: URLSearchParams): RoadmapMode {
  return searchParams.get('roadmapMode') === 'asIs' ? 'asIs' : 'toBe';
}

/**
 * F5's own roadmap (R1, docs/prompts/atlas-prompt-pack.md) — the model's
 * own systems, plotted by their `introduced`/`plannedEnd`/`supportEndsAt`,
 * grouped by capability, with change markers from merged/planned branches.
 * PR1's own data layer (`useRoadmap.ts`, `roadmapChangeEvents.ts`) does
 * the real work; this page is chrome plus the filter/mode controls, the
 * same shape `CapabilityMapPage.tsx`/`LandscapePage.tsx` already
 * establish for a model-level view.
 *
 * Deliberately no add/edit affordance and no Inspector/comments-panel
 * integration in this first pass — F5's own prompt names rows, bars,
 * markers, filters, as-is/to-be and export, never element creation; the
 * `ViewKind`/`CommentsPanel` wiring every other view has is a real,
 * disclosed gap for a later pass, not an oversight (see the register).
 */
export function RoadmapPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { ref } = useSelectedRef();
  const viewing = isViewingMode(searchParams);
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { branch: mainBranch, loading: mainBranchLoading } = useMainBranch(model?.id ?? null);

  const { state } = useRoadmap(hintedModelId(model?.id, ref, mainBranchLoading) ?? '', organisation?.id ?? '', userId, ref, organisation?.slug ?? '', model?.slug ?? '', mainBranch?.head_commit_id ?? null);

  const mode = parseRoadmapMode(searchParams);
  const setMode = (next: RoadmapMode): void => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'asIs') nextParams.set('roadmapMode', 'asIs');
    else nextParams.delete('roadmapMode');
    setSearchParams(nextParams);
  };

  const filters = parseRoadmapFilters(searchParams);
  const setFilters = (next: RoadmapFilters): void => {
    setSearchParams(roadmapFiltersToSearchParams(next, searchParams));
  };

  const groupBy = parseRoadmapGroupBy(searchParams);
  const setGroupBy = (next: RoadmapGroupBy): void => {
    setSearchParams(roadmapGroupByToSearchParams(next, searchParams));
  };

  const granularity = parseRoadmapGranularity(searchParams);
  const setGranularity = (next: RoadmapGranularity): void => {
    setSearchParams(roadmapGranularityToSearchParams(next, searchParams));
  };

  const horizon = parseRoadmapHorizon(searchParams);
  const windowStart = parseRoadmapStartMonth(searchParams);
  const setHorizon = (next: RoadmapHorizon): void => {
    // Switching horizon re-centers the window — drop any explicit start so the default (centered on now) applies.
    setSearchParams(roadmapStartMonthToSearchParams(undefined, roadmapHorizonToSearchParams(next, searchParams)));
  };
  const nudge = (direction: -1 | 1): void => {
    const base = windowStart ?? defaultRoadmapWindowStart(horizon, new Date());
    setSearchParams(roadmapStartMonthToSearchParams(shiftRoadmapWindowStart(base, direction), searchParams));
  };
  const resetToday = (): void => {
    setSearchParams(roadmapStartMonthToSearchParams(undefined, searchParams));
  };

  const roadmapData = state.status === 'ready' ? state.data : null;
  // F6 Step 6: the same bars, grouped by capability or value stream — both
  // were computed by `useRoadmap`, so switching the toggle never refetches.
  const groups = groupBy === 'valueStream' ? (roadmapData?.valueStreamGroups ?? []) : groupBy === 'project' ? (roadmapData?.projectGroups ?? []) : (roadmapData?.groups ?? []);
  const roadmapExport = useRoadmapExport({
    groups,
    branchEvents: roadmapData?.branchEvents ?? [],
    mode,
    filters,
    granularity,
    horizon,
    windowStart,
    filenameBase: model?.name ?? 'roadmap',
  });
  const hasNothingToExport = roadmapData === null || (groups.length === 0 && roadmapData.branchEvents.length === 0);

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

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          {viewing ? <ViewingBranchBanner activeRef={ref} /> : <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />}
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel={refLabelOf(ref)} />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Roadmap
            </Text>
            {state.status === 'ready' && (
              <div className={styles.actions}>
                <Button variant="secondary" disabled={hasNothingToExport} onClick={roadmapExport.exportCsv}>
                  Export table
                </Button>
                <Button variant="secondary" disabled={hasNothingToExport} onClick={roadmapExport.exportPng}>
                  Export PNG
                </Button>
              </div>
            )}
          </div>
          {roadmapExport.error !== null && <Text as="p">{roadmapExport.error}</Text>}

          {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
          {state.status === 'error' && <Text as="p">{state.message}</Text>}
          {state.status === 'refNotFound' && <Text as="p">Nothing here yet.</Text>}
          {state.status === 'ready' && (
            <>
              <RoadmapFilterBar filters={filters} onFiltersChange={setFilters} mode={mode} onModeChange={setMode} groupBy={groupBy} onGroupByChange={setGroupBy} granularity={granularity} onGranularityChange={setGranularity} horizon={horizon} onHorizonChange={setHorizon} onNudge={nudge} onResetToday={resetToday} capabilitiesById={state.data.capabilitiesById} ownerActorsById={state.data.ownerActorsById} />
              <RoadmapView groupsLabel={groupBy === 'valueStream' ? 'Value streams' : groupBy === 'project' ? 'Projects' : 'Capability domains'} groups={groups} branchEvents={state.data.branchEvents} mode={mode} filters={filters} granularity={granularity} horizon={horizon} windowStart={windowStart} orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb, type BreadcrumbSegment } from '../components/Breadcrumb/Breadcrumb';
import { Button } from '../components/Button/Button';
import { DiffLegend } from '../components/DiffBadge/DiffLegend';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { parseRefParam, refLabelOf, refParamOf } from '../../db/ref';
import { parseViewMode } from '../../db/viewMode';
import { BranchViewModeControl } from '../branches/BranchViewModeControl';
import { useBranchLabel } from '../branches/useBranchLabel';
import { LandscapeCanvas } from '../landscape/LandscapeCanvas';
import { useLandscape } from '../landscape/useLandscape';
import { useBreadcrumbElement } from '../nav/useBreadcrumbElement';
import { parseCapabilityParam, zoomQueryString } from '../nav/zoomParams';
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
 */
export function LandscapePage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const ref = parseRefParam(searchParams.get('ref'));
  const mode = parseViewMode(searchParams.get('mode'));
  const capabilityId = parseCapabilityParam(searchParams.get('capability'));
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const capability = useBreadcrumbElement(model?.id ?? '', ref, capabilityId);
  const { label: branchLabel } = useBranchLabel(ref);

  const { state, resetLayout } = useLandscape(model?.id ?? '', organisation?.id ?? '', userId, ref, mode, capabilityId);

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader />
        <main className={styles.main}>
          <Text tone="muted">Loading…</Text>
        </main>
      </div>
    );
  }

  const refParam = refParamOf(ref);
  const segments: BreadcrumbSegment[] = capability ? [{ label: capability.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/capability-map?ref=${refParam}` }] : [];
  const nodeHref = (systemId: string) => `/o/${orgSlug ?? ''}/m/${model.slug}/context/${systemId}?${zoomQueryString({ ref, capabilityId })}`;

  return (
    <div>
      <AppHeader />
      <main className={styles.main}>
        <Breadcrumb
          org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
          model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
          refLabel={refLabelOf(ref, branchLabel)}
          segments={segments}
        />
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            Landscape{capability ? `: systems supporting ${capability.name}` : ''}
          </Text>
          {state.status === 'ready' && (
            <div className={styles.actions}>
              <Button variant="ghost" onClick={resetLayout}>
                Reset layout
              </Button>
            </div>
          )}
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
        {ref.kind === 'branch' && mode === 'diff' && <DiffLegend />}

        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && <Text as="p">This model has no commits yet at this ref.</Text>}
        {state.status === 'ready' && state.data.layout.nodes.length === 0 && (
          <EmptyState>{capability ? 'No systems support this capability yet.' : 'No systems yet. Add a System from the element page to see it here.'}</EmptyState>
        )}
        {state.status === 'ready' && state.data.layout.nodes.length > 0 && (
          <LandscapeCanvas layout={state.data.layout} systemsById={state.data.systemsById} edges={state.data.edges} diff={state.data.diff} nodeHref={nodeHref} />
        )}
      </main>
    </div>
  );
}

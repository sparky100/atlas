import { Loading } from '../components/Loading/Loading';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Button } from '../components/Button/Button';
import { DiffLegend } from '../components/DiffBadge/DiffLegend';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { optionImpactSystemIds } from '../decisions/decisionOptionImpact';
import { useDecision } from '../decisions/useDecision';
import { EMPTY_LANDSCAPE_FILTERS } from '../landscape/landscapeFilter';
import { LandscapeCanvas } from '../landscape/LandscapeCanvas';
import { useCanvasWidth } from '../landscape/useCanvasWidth';
import { useLandscape } from '../landscape/useLandscape';
import { useLandscapeDisplay } from '../landscape/useLandscapeDisplay';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './DecisionOptionLandscapePage.module.css';

/**
 * Read-only impact preview of one option. The default view contains only
 * changed systems and the system ends of changed connections; the full
 * landscape is an explicit context view. An unedited option has no impact
 * diagram. Nothing here selects an editing ref or writes to the model.
 */
export function DecisionOptionLandscapePage() {
  const { orgSlug, modelSlug, decisionId, branchId } = useParams<{ orgSlug: string; modelSlug: string; decisionId: string; branchId: string }>();
  const { userId } = useAuth();
  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { state: decisionState } = useDecision(model?.id ?? '', decisionId ?? '');

  const ref = useMemo(() => ({ kind: 'branch' as const, branchId: branchId ?? '' }), [branchId]);
  const { state } = useLandscape(model?.id ?? null, organisation?.id ?? null, userId, ref, 'diff', Boolean(model && branchId));

  const [showFullLandscape, setShowFullLandscape] = useState(false);
  const { ref: canvasRef, width: canvasWidth } = useCanvasWidth();

  // People and teams do not belong here: an option touches systems, not actors.
  // Drop them from the layout input so neither the lanes nor the canvas show them.
  const displayInput = useMemo(
    () => (state.status === 'ready' ? { ...state.data, actorsById: new Map() } : null),
    [state],
  );
  const hasEdits = displayInput?.diff?.elements.some((e) => e.state !== 'unchanged') === true || displayInput?.diff?.relationships.some((r) => r.state !== 'unchanged') === true;
  const noEditsYet = displayInput !== null && !hasEdits;
  const touchedSystemIds = useMemo(() => displayInput?.diff ? optionImpactSystemIds(displayInput.diff, new Set(displayInput.systemsById.keys())) : new Set<string>(), [displayInput]);
  const focusedInput = useMemo(() => {
    if (!displayInput || !hasEdits || touchedSystemIds.size === 0) return null;
    const systemsById = new Map([...displayInput.systemsById].filter(([id]) => touchedSystemIds.has(id)));
    return {
      ...displayInput,
      systemsById,
      supportsEdges: displayInput.supportsEdges.filter((edge) => systemsById.has(edge.from_element_id)),
      edges: displayInput.edges.filter((edge) => systemsById.has(edge.from_element_id) && systemsById.has(edge.to_element_id)),
    };
  }, [displayInput, hasEdits, touchedSystemIds]);
  const shownInput = showFullLandscape && hasEdits ? displayInput : focusedInput;
  const displayState = useLandscapeDisplay(shownInput, EMPTY_LANDSCAPE_FILTERS, undefined, canvasWidth ?? undefined);

  const elementHref = (elementId: string) => `/o/${orgSlug ?? ''}/m/${modelSlug ?? ''}/e/${elementId}`;
  const nodeHref = (systemId: string) => `/o/${orgSlug ?? ''}/m/${modelSlug ?? ''}/context/${systemId}`;

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

  const decisionTitle = decisionState.status === 'ready' ? decisionState.decision.title : 'Decision';

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main} ref={canvasRef}>
          <Breadcrumb
            org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
            model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
            refLabel="Proposed changes"
            segments={[
              { label: decisionTitle, href: `/o/${orgSlug ?? ''}/m/${model.slug}/decisions/${decisionId ?? ''}` },
              { label: 'Option impact', href: `/o/${orgSlug ?? ''}/m/${model.slug}/decisions/${decisionId ?? ''}/options/${branchId ?? ''}/landscape` },
            ]}
          />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Option impact
            </Text>
            {hasEdits && (
              <Button
                variant="secondary"
                onClick={() => {
                  setShowFullLandscape((v) => !v);
                }}
              >
                {showFullLandscape ? 'Focus on changed systems' : 'Show full landscape'}
              </Button>
            )}
          </div>
          {noEditsYet && (
            <div data-testid="option-diagram-no-edits">
              <Text as="p" tone="muted">
                Nothing has been drafted in this option yet, so there is no impact to preview.{' '}
                <Link to={`/o/${orgSlug ?? ''}/m/${model.slug}/changes/${branchId ?? ''}`}>Draft the obvious edits →</Link>
              </Text>
            </div>
          )}
          {hasEdits && touchedSystemIds.size === 0 && !showFullLandscape && (
            <Text as="p" tone="muted">This draft changes records, but no system or connection change can be drawn here. Review the edits on the change page, or show the full landscape for context.</Text>
          )}
          {shownInput !== null && <><Text as="p" size="sm" tone="muted">{showFullLandscape ? 'Full landscape for context; change markers identify this option’s edits.' : 'Only systems changed by this option and the ends of changed connections are shown.'}</Text><DiffLegend /></>}

          {state.status === 'loading' && <Loading />}
          {state.status === 'error' && <Text as="p">{state.message}</Text>}
          {state.status === 'refNotFound' && <Text as="p">This option no longer exists.</Text>}
          {state.status === 'ready' && displayState.status === 'ready' && shownInput !== null && (
            <div
              className={styles.canvasWrap}
              style={{ height: `${String(Math.max(240, Math.min(displayState.display.layout.height + 64, 640)))}px` }}
            >
              <LandscapeCanvas
                layout={displayState.display.layout}
                systemsById={shownInput.systemsById}
                actorsById={shownInput.actorsById}
                edges={shownInput.edges}
                diff={state.data.diff}
                showConnections
                nodeHref={nodeHref}
                actorHref={elementHref}
                capabilityHref={elementHref}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

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
import { impactedLaneKeys, scopeLaneKeys } from '../decisions/decisionOptionImpact';
import { useDecision } from '../decisions/useDecision';
import { EMPTY_LANDSCAPE_FILTERS } from '../landscape/landscapeFilter';
import { LandscapeCanvas } from '../landscape/LandscapeCanvas';
import { EMPTY_LANE_DISPLAY, listLandscapeLaneOptions, type LandscapeLaneDisplayOptions } from '../landscape/layout';
import { useCanvasWidth } from '../landscape/useCanvasWidth';
import { useLandscape } from '../landscape/useLandscape';
import { useLandscapeDisplay } from '../landscape/useLandscapeDisplay';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './DecisionOptionLandscapePage.module.css';

/**
 * "The decision process should allow the creation of option diagrams —
 * something that shows 'this option touches these elements' rather than
 * just saying it." Per the design conversation that shaped this: not a new
 * diagram type — `useLandscape` pointed at the option's own branch in
 * `mode: 'diff'` already *is* "what this option changed"
 * (`src/engine/versionDiff.ts`, the same diff tinting `LandscapeCanvas`
 * already draws for every other Diff-mode view). The one new piece is the
 * default: every capability lane with no changed system in it starts
 * hidden (`layout.ts`'s hide mechanism, `LandscapeLaneDisplayOptions.hiddenLaneKeys`),
 * computed fresh from the diff every render — never a saved preference,
 * never written to `user_preferences` — so opening this page shows only
 * what the option actually touches, with a "Show all lanes" escape hatch
 * for full context.
 *
 * Read-only by construction: no edit affordances (no add-system, no
 * comments, no filter bar) — an option's branch is somebody's in-progress
 * exploration, not something this preview writes to. Bypasses the app's
 * shared "selected ref" (`useSelectedRef`) entirely, unlike `LandscapePage`
 * — opening an option's diagram must never change what branch the rest of
 * the app is editing.
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

  const [showAllLanes, setShowAllLanes] = useState(false);
  const { ref: canvasRef, width: canvasWidth } = useCanvasWidth();

  // People and teams do not belong here: an option touches systems, not actors.
  // Drop them from the layout input so neither the lanes nor the canvas show them.
  const displayInput = useMemo(
    () => (state.status === 'ready' ? { ...state.data, actorsById: new Map() } : null),
    [state],
  );
  const laneOptions = useMemo(
    () => (displayInput ? listLandscapeLaneOptions([...displayInput.systemsById.values()], displayInput.supportsEdges, displayInput.l1AncestorByCapabilityId, []) : []),
    [displayInput],
  );
  const touched = useMemo(
    () => (displayInput?.diff ? impactedLaneKeys(displayInput.diff, [...displayInput.systemsById.values()], displayInput.supportsEdges, displayInput.l1AncestorByCapabilityId) : null),
    [displayInput],
  );
  // No edits yet: nothing is touched, so every lane would be hidden and only the unplaced people would show.
  // Show the decision's own scope as it is today instead, or every lane when the decision names none.
  const noEditsYet = touched !== null && touched.size === 0;
  const scopeIds = useMemo(() => {
    if (decisionState.status !== 'ready') return new Set<string>();
    return new Set(decisionState.links.filter((l) => l.linked_type === 'element').map((l) => l.linked_id));
  }, [decisionState]);
  const impacted = useMemo(() => {
    if (!displayInput || touched === null) return null;
    if (!noEditsYet) return touched;
    const scope = scopeLaneKeys(scopeIds, [...displayInput.systemsById.values()], displayInput.supportsEdges, displayInput.l1AncestorByCapabilityId);
    return scope.size > 0 ? scope : null;
  }, [displayInput, touched, noEditsYet, scopeIds]);
  const hiddenCount = impacted ? laneOptions.filter((o) => !impacted.has(o.key)).length : 0;
  const laneDisplay = useMemo<LandscapeLaneDisplayOptions>(() => {
    if (showAllLanes || !impacted) return EMPTY_LANE_DISPLAY;
    return { hiddenLaneKeys: new Set(laneOptions.filter((o) => !impacted.has(o.key)).map((o) => o.key)) };
  }, [showAllLanes, impacted, laneOptions]);
  const displayState = useLandscapeDisplay(displayInput, EMPTY_LANDSCAPE_FILTERS, laneDisplay, canvasWidth ?? undefined);

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
              { label: 'What this option touches', href: `/o/${orgSlug ?? ''}/m/${model.slug}/decisions/${decisionId ?? ''}/options/${branchId ?? ''}/landscape` },
            ]}
          />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              What this option touches
            </Text>
            {hiddenCount > 0 && (
              <Button
                variant="secondary"
                onClick={() => {
                  setShowAllLanes((v) => !v);
                }}
              >
                {showAllLanes ? `Hide ${String(hiddenCount)} untouched lane${hiddenCount === 1 ? '' : 's'}` : `Show ${String(hiddenCount)} untouched lane${hiddenCount === 1 ? '' : 's'}`}
              </Button>
            )}
          </div>
          {noEditsYet && (
            <div data-testid="option-diagram-no-edits">
              <Text as="p" tone="muted">
                No changes yet. This shows what the decision concerns as it is today.{' '}
                <Link to={`/o/${orgSlug ?? ''}/m/${model.slug}/changes/${branchId ?? ''}`}>Draft the obvious edits →</Link>
              </Text>
            </div>
          )}
          <DiffLegend />

          {state.status === 'loading' && <Loading />}
          {state.status === 'error' && <Text as="p">{state.message}</Text>}
          {state.status === 'refNotFound' && <Text as="p">This option no longer exists.</Text>}
          {state.status === 'ready' && displayState.status === 'ready' && displayInput !== null && (
            <div
              className={styles.canvasWrap}
              style={{ height: `${String(Math.max(320, Math.min(displayState.display.layout.height + 96, 720)))}px` }}
            >
              <LandscapeCanvas
                layout={displayState.display.layout}
                systemsById={displayInput.systemsById}
                actorsById={displayInput.actorsById}
                edges={displayInput.edges}
                diff={state.data.diff}
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

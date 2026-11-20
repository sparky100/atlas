import { Loading } from '../components/Loading/Loading';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getProject } from '../../db/projects';
import { supabase } from '../supabaseClient';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { DecisionView } from '../decisions/DecisionView';
import { useDecision } from '../decisions/useDecision';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useSelectedRef } from '../branches/useSelectedRef';
import { refLabelOf } from '../../db/ref';
import { useModels } from '../models/useModels';
import { useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/**
 * A single decision's own page (prompt pack F3 PR4, `/decisions/{id}`
 * route — routed on the decision's real id, `decisions` has no separate
 * slug column, same as `branches`).
 */
export function DecisionPage() {
  const { orgSlug, modelSlug, decisionId } = useParams<{ orgSlug: string; modelSlug: string; decisionId: string }>();
  const { userId } = useAuth();
  const { ref } = useSelectedRef();
  const { label: branchLabel } = useBranchLabel(ref);

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  // The one `useDecision` call for this page — `DecisionView` below reads
  // this same `state` and its write-result patches as props rather than
  // fetching its own second, independent copy (it used to; see
  // `DecisionView.tsx`'s own doc comment on why that duplication was
  // worth removing, not just wasteful).
  const { state, applyNewOption, applyNewConcern, applyDecisionUpdate, refreshOptionsAndArguments } = useDecision(model?.id ?? '', decisionId ?? '');
  const projectId = state.status === 'ready' ? state.decision.project_id : null;
  const project = useQuery({ queryKey: ['decisionPageProject', projectId], enabled: projectId !== null, queryFn: () => getProject(supabase, projectId!) });
  const title = state.status === 'ready' ? state.decision.title : 'Decision';

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

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel={refLabelOf(ref, branchLabel)} />
          {project.data && (
            <Text as="p" size="md" data-testid="decision-parent-project">
              Part of project:{' '}
              <Link to={`/o/${orgSlug ?? ''}/m/${model.slug}/projects/${project.data.id}`}>{project.data.title}</Link> ({project.data.status})
            </Text>
          )}
          <div className={styles.headerRow}>
            <Text as="h1" size="2xl">
              {title}
            </Text>
          </div>
          <DecisionView
            modelId={model.id}
            decisionId={decisionId ?? ''}
            orgId={organisation?.id ?? ''}
            orgSlug={orgSlug ?? ''}
            modelSlug={model.slug}
            role={role}
            state={state}
            applyNewOption={applyNewOption}
            applyNewConcern={applyNewConcern}
            applyDecisionUpdate={applyDecisionUpdate}
            refreshOptionsAndArguments={refreshOptionsAndArguments}
          />
        </main>
      </div>
    </div>
  );
}

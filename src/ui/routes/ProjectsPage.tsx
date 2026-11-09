import { Loading } from '../components/Loading/Loading';
import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { PageIntro } from '../components/PageIntro/PageIntro';
import { Text } from '../components/Text/Text';
import { WORK_COPY } from '../work/workCopy';
import { parseDecisionPrefillFromSearchParams } from '../decisions/decisionPrefill';
import { ProjectsView } from '../projects/ProjectsView';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useSelectedRef } from '../branches/useSelectedRef';
import { refLabelOf } from '../../db/ref';
import { useModels } from '../models/useModels';
import { useMembership } from '../orgs/useMembership';
import { canStartProject } from '../orgs/roleGates';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/**
 * F10 step 2 (ADR-024 §6.1): the Projects list, `/projects`. Like the
 * decisions list it isn't scoped to one ref — a project is model-wide
 * workflow, never branch-scoped — but the breadcrumb chip and the
 * "editing in a change" banner still reflect the selected ref. Reads the
 * same `startTitle`/… prefill params a finding's "Start a decision" uses
 * (step 7's "Start a project").
 */
export function ProjectsPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { userId } = useAuth();
  const { ref } = useSelectedRef();
  const { label: branchLabel } = useBranchLabel(ref);
  const [searchParams] = useSearchParams();
  const prefill = parseDecisionPrefillFromSearchParams(searchParams);

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canCreate = canStartProject(role);

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
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Projects
            </Text>
          </div>
          <PageIntro>{WORK_COPY.project}</PageIntro>
          <ProjectsView modelId={model.id} orgId={organisation?.id ?? ''} userId={userId} orgSlug={orgSlug ?? ''} modelSlug={model.slug} canCreate={canCreate} prefill={prefill} />
        </main>
      </div>
    </div>
  );
}

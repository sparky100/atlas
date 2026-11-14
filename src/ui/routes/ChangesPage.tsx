import { Loading } from '../components/Loading/Loading';
import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { PageIntro } from '../components/PageIntro/PageIntro';
import { Text } from '../components/Text/Text';
import { WORK_COPY } from '../work/workCopy';
import { ChangesView } from '../changes/ChangesView';
import { ChangesTabs } from '../changes/ChangesTabs/ChangesTabs';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useSelectedRef } from '../branches/useSelectedRef';
import { refLabelOf } from '../../db/ref';
import { useModels } from '../models/useModels';
import { canCreateChangeBranch, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/**
 * The changes list (Sprint C1 step 3, UI-principles §2.4's `/changes`
 * route): create a change branch (name, description, target date) and see
 * every change on this model. Like VersionsPage, this list isn't scoped to
 * one ref — it always reads every branch, not one ref's own fold — but
 * the breadcrumb's own `[ref]` chip and the "editing in a change" banner
 * still reflect the session's selected ref (`useSelectedRef`), same as
 * every other model route, rather than hardcoding `main` regardless of
 * what's actually selected.
 */
export function ChangesPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { userId } = useAuth();
  const { ref } = useSelectedRef();
  const { label: branchLabel } = useBranchLabel(ref);

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canCreate = canCreateChangeBranch(role);

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
              Changes
            </Text>
          </div>
          <PageIntro>{WORK_COPY.change}</PageIntro>
          <ChangesTabs orgSlug={orgSlug ?? ''} modelSlug={model.slug} modelId={model.id} current="all" />
          <ChangesView modelId={model.id} orgId={organisation?.id ?? ''} userId={userId} orgSlug={orgSlug ?? ''} modelSlug={model.slug} canCreate={canCreate} aiEnabled={organisation?.ai_assistant_enabled === true} isOwner={role === 'owner'} />
        </main>
      </div>
    </div>
  );
}

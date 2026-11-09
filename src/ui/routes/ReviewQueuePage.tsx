import { Loading } from '../components/Loading/Loading';
import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { PageIntro } from '../components/PageIntro/PageIntro';
import { Text } from '../components/Text/Text';
import { WORK_COPY } from '../work/workCopy';
import { ReviewQueueView } from '../reviews/ReviewQueueView';
import { ChangesTabs } from '../changes/ChangesTabs/ChangesTabs';
import { useSelectedRef } from '../branches/useSelectedRef';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/** The review queue's list (Sprint C1 step 7, UI-principles §2.4's `/review` route) — since F9 step 2, the Changes page's "Review queue" tab (UI-principles §2.0, §5): same `h1` as the All tab, with `ChangesTabs` marking which one is showing. Its URL is unchanged. */
export function ReviewQueuePage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { ref } = useSelectedRef();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);

  if (orgLoading || modelsLoading || !model || !organisation) {
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
      <AppHeader orgId={organisation.id} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />
          <Breadcrumb org={{ label: organisation.name, href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel="Review queue" />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Changes
            </Text>
          </div>
          <PageIntro>{WORK_COPY.review}</PageIntro>
          <ChangesTabs orgSlug={orgSlug ?? ''} modelSlug={model.slug} modelId={model.id} current="review" />
          <ReviewQueueView modelId={model.id} orgId={organisation.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} />
        </main>
      </div>
    </div>
  );
}

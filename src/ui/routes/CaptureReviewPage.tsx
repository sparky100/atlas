import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { CaptureReviewView } from '../capture/CaptureReviewView';
import { useSelectedRef } from '../branches/useSelectedRef';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/** F2 (full K1) PR15, SPEC-capture.md §10: one capture job's own review queue — mirrors `ReviewRequestPage.tsx`'s exact template. */
export function CaptureReviewPage() {
  const { orgSlug, modelSlug, jobId } = useParams<{ orgSlug: string; modelSlug: string; jobId: string }>();
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
            <Text tone="muted">Loading…</Text>
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
          <Breadcrumb
            org={{ label: organisation.name, href: `/o/${orgSlug ?? ''}` }}
            model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
            refLabel="Review queue"
            segments={[{ label: 'Review', href: `/o/${orgSlug ?? ''}/m/${model.slug}/review` }]}
          />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Capture review
            </Text>
          </div>
          <CaptureReviewView modelId={model.id} orgId={organisation.id} jobId={jobId ?? ''} reviewQueueHref={`/o/${orgSlug ?? ''}/m/${model.slug}/review`} />
        </main>
      </div>
    </div>
  );
}

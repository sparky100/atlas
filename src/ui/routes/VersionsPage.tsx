import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useSelectedRef } from '../branches/useSelectedRef';
import { useModels } from '../models/useModels';
import { canEditOnMain, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { VersionsView } from '../versions/VersionsView';
import styles from './ViewPage.module.css';

/**
 * The versions list (Sprint U2 step 4): tag main with a name and note,
 * open any tag read-only, or pick two to diff. There is no `[ref]` chip
 * here in the usual sense — this page is *about* every ref a model has,
 * not scoped to one — so the breadcrumb's ref chip always reads `main`
 * (the state this list itself is read from: `tags` and `main`'s current
 * head, never a historical commit's own view of its own tag list).
 */
export function VersionsPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { userId } = useAuth();
  const { ref } = useSelectedRef();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canTag = canEditOnMain(role);

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader />
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
      <AppHeader />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel="main" />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Versions
            </Text>
          </div>
          <VersionsView modelId={model.id} orgId={organisation?.id ?? ''} userId={userId} orgSlug={orgSlug ?? ''} modelSlug={model.slug} canTag={canTag} />
        </main>
      </div>
    </div>
  );
}

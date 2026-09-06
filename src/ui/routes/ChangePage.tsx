import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Text } from '../components/Text/Text';
import { ChangeView } from '../changes/ChangeView';
import { useChange } from '../changes/useChange';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { canCreateChangeBranch, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/**
 * A single change's page (Sprint C1 step 3, UI-principles §2.4's
 * `/changes/{branchSlug}` route, routed on the branch id — see
 * ChangeView's own comment on why). The breadcrumb's `[ref]` chip reads
 * `Change: {title}` exactly as §2.2 specifies for a branch ref.
 */
export function ChangePage() {
  const { orgSlug, modelSlug, branchId } = useParams<{ orgSlug: string; modelSlug: string; branchId: string }>();
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canEdit = canCreateChangeBranch(role);
  const { branch } = useChange(branchId ?? '');

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

  const refLabel = branch ? `Change: ${branch.title ?? branch.name}` : 'Change';

  return (
    <div>
      <AppHeader />
      <main className={styles.main}>
        <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel={refLabel} />
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            {branch?.title ?? branch?.name ?? 'Change'}
          </Text>
        </div>
        <ChangeView branchId={branchId ?? ''} canEdit={canEdit} />
      </main>
    </div>
  );
}

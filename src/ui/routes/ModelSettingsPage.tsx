import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useSelectedRef } from '../branches/useSelectedRef';
import { ModelSettingsView } from '../models/ModelSettingsView';
import { useModels } from '../models/useModels';
import { useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ModelSettingsPage.module.css';

/**
 * Sprint 7j item 1: model settings (`/o/:org/m/:model/settings`, owner/
 * architect) — rename/slug/description, Archive/Restore, Delete. Entry
 * from `ModelHome.tsx`'s own overflow menu.
 */
export function ModelSettingsPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { userId } = useAuth();
  const { ref } = useSelectedRef();
  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);

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
          <EditingBranchBanner activeRef={ref} showModeShortcuts={false} />
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel="Settings" />
          <Text as="h1" size="2xl">
            Model settings
          </Text>
          <ModelSettingsView
            model={model}
            role={role}
            orgId={organisation?.id ?? ''}
            orgSlug={orgSlug ?? ''}
            onChanged={() => {
              // listModelsForOrg (useModels' own effect) already re-fetches
              // on org/user change but not on a settings mutation — the
              // simplest correct refresh here is a full reload rather than
              // a second, parallel piece of state this page would have to
              // keep in sync with `models` itself.
              window.location.reload();
            }}
          />
        </main>
      </div>
    </div>
  );
}

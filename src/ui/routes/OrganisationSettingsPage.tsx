import { Loading } from '../components/Loading/Loading';
import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { OrganisationSettingsView } from '../orgs/OrganisationSettingsView';
import { useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './OrganisationSettingsPage.module.css';

/**
 * Sprint 7j item 2: organisation settings (`/o/:org/settings`, any member —
 * the view's own controls gate to owner) — rename/slug, member directory,
 * Delete organisation. Entry from `OrgHome.tsx`'s own settings affordance
 * beside `OrgSwitcher`.
 */
export function OrganisationSettingsPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const { userId } = useAuth();
  const { organisation, loading: orgLoading, error: orgError } = useOrganisationBySlug(orgSlug ?? '');
  const { role } = useMembership(organisation?.id ?? null, userId);

  if (orgLoading) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <main className={styles.main}>
          <Loading />
        </main>
      </div>
    );
  }

  if (orgError !== null || !organisation) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <main className={styles.main}>
          <Text as="p">{orgError ?? `No organisation found for "${orgSlug ?? ''}", or you're not a member of it.`}</Text>
        </main>
      </div>
    );
  }

  return (
    <div>
      <AppHeader orgId={organisation.id} />
      <main className={styles.main}>
        <Text as="h1" size="2xl">
          Organisation settings
        </Text>
        <OrganisationSettingsView
          organisation={organisation}
          role={role}
          userId={userId}
          onChanged={() => {
            // Same reasoning as ModelSettingsPage.tsx's own onChanged: the
            // simplest correct refresh after a settings mutation is a full
            // reload rather than a second, parallel piece of state this
            // page would have to keep in sync with `organisation` itself.
            window.location.reload();
          }}
        />
      </main>
    </div>
  );
}

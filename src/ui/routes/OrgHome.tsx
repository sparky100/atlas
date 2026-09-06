import { useParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Chip } from '../components/Chip/Chip';
import { ModelList } from '../components/ModelList/ModelList';
import { OrgSwitcher } from '../components/OrgSwitcher/OrgSwitcher';
import { Text } from '../components/Text/Text';
import { canCreateModel, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { useOrganisations } from '../orgs/useOrganisations';
import { useModels } from '../models/useModels';

/** Org home: the model list for one organisation, plus the org switcher and role-gated "New model" (Sprint U1 step 2). */
export function OrgHome() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const { userId } = useAuth();
  const { organisations } = useOrganisations();
  const { organisation, loading: orgLoading, error: orgError } = useOrganisationBySlug(orgSlug ?? '');
  const { role } = useMembership(organisation?.id ?? null, userId);
  const { models, loading: modelsLoading, createModel } = useModels(organisation?.id ?? null);

  if (orgLoading) {
    return (
      <div>
        <AppHeader />
        <main style={{ padding: 'var(--space-8)' }}>
          <Text tone="muted">Loading…</Text>
        </main>
      </div>
    );
  }

  if (orgError !== null || !organisation) {
    return (
      <div>
        <AppHeader />
        <main style={{ padding: 'var(--space-8)' }}>
          <Text as="p">{orgError ?? `No organisation found for "${orgSlug ?? ''}", or you're not a member of it.`}</Text>
        </main>
      </div>
    );
  }

  return (
    <div>
      <AppHeader>
        <OrgSwitcher organisations={organisations} currentOrgSlug={organisation.slug} />
      </AppHeader>
      <main style={{ padding: 'var(--space-8)', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
          <Text as="h1" size="2xl">
            {organisation.name}
          </Text>
          {role !== null && <Chip tone="neutral">{role}</Chip>}
        </div>
        <Text as="p" tone="muted">
          Models
        </Text>
        <ModelList
          orgSlug={organisation.slug}
          models={models}
          loading={modelsLoading}
          canCreate={canCreateModel(role)}
          onCreate={async (name, slug) => {
            if (!userId) return;
            await createModel(name, slug, userId);
          }}
        />
      </main>
    </div>
  );
}

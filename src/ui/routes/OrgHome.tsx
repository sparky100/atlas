import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { ModelList } from '../components/ModelList/ModelList';
import { OrgSwitcher } from '../components/OrgSwitcher/OrgSwitcher';
import { Text } from '../components/Text/Text';
import { canCreateModel, canManageOrgSettings, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { useOrganisations } from '../orgs/useOrganisations';
import { useModels } from '../models/useModels';
import styles from './OrgHome.module.css';

/** Org home: the model list for one organisation, plus the org switcher and role-gated "New model" (Sprint U1 step 2). */
export function OrgHome() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const { userId } = useAuth();
  const { organisations } = useOrganisations();
  const { organisation, loading: orgLoading, error: orgError } = useOrganisationBySlug(orgSlug ?? '');
  const { role } = useMembership(organisation?.id ?? null, userId);
  const { models, loading: modelsLoading, createModel } = useModels(organisation?.id ?? null);
  // Sprint 7j item 1/3: "hidden from lists" plus item 3's own collapsed
  // "Archived" section — one fetch (`listModelsForOrg`, deliberately
  // unfiltered so every route can still resolve an archived model
  // directly — that function's own comment), split here for display.
  const activeModels = models.filter((m) => m.archived_at === null);
  const archivedModels = models.filter((m) => m.archived_at !== null);

  if (orgLoading) {
    return (
      <div>
        <AppHeader />
        <main className={styles.main}>
          <Text tone="muted">Loading…</Text>
        </main>
      </div>
    );
  }

  if (orgError !== null || !organisation) {
    return (
      <div>
        <AppHeader />
        <main className={styles.main}>
          <Text as="p">{orgError ?? `No organisation found for "${orgSlug ?? ''}", or you're not a member of it.`}</Text>
        </main>
      </div>
    );
  }

  return (
    <div>
      <AppHeader>
        <OrgSwitcher organisations={organisations} currentOrgSlug={organisation.slug} />
        {canManageOrgSettings(role) && (
          // Sprint 7j item 2: "a small settings affordance beside
          // OrgSwitcher.tsx's existing <select>" — the select stays for
          // switching organisations; this is a separate, small link to
          // `/o/:org/settings`, not a replacement for it.
          <Link to={`/o/${organisation.slug}/settings`} className={styles.orgSettingsLink}>
            <Text as="span" size="sm">
              Org settings
            </Text>
          </Link>
        )}
      </AppHeader>
      <main className={styles.main}>
        <div className={styles.title}>
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
          models={activeModels}
          loading={modelsLoading}
          canCreate={canCreateModel(role)}
          onCreate={async (name, slug) => {
            if (!userId) return;
            await createModel(name, slug, userId);
          }}
        />
        {archivedModels.length > 0 && (
          <CollapsibleSection title="Archived" meta={`(${String(archivedModels.length)})`} defaultOpen={false}>
            <ul className={styles.archivedList}>
              {archivedModels.map((model) => (
                <li key={model.id}>
                  <Link to={`/o/${organisation.slug}/m/${model.slug}`} className={styles.archivedRow}>
                    <Text as="span">{model.name}</Text>
                    <Chip tone="neutral">Archived</Chip>
                  </Link>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        )}
      </main>
    </div>
  );
}

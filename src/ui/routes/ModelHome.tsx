import { Link, useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useMainBranch } from '../branches/useMainBranch';
import { ArchitectHome } from '../home/ArchitectHome';
import { DirectorHome } from '../home/DirectorHome';
import { HomeModeSwitch } from '../home/HomeModeSwitch';
import { HomeSearch } from '../home/HomeSearch';
import { useArchitectHome } from '../home/useArchitectHome';
import { useDirectorHome } from '../home/useDirectorHome';
import { useHomeMode } from '../home/useHomeMode';
import { useModels } from '../models/useModels';
import { canEditOnMain, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ModelHome.module.css';

/**
 * Model home — Sprint U3b (UI-principles §3): the two front doors,
 * replacing the placeholder link list this page used to be. `home_mode`
 * (§3.3) picks which door renders and is switchable in place; the search
 * box (§3, "opens or creates an element") is common to both.
 */
export function ModelHome() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { userId } = useAuth();
  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const { homeMode, setHomeMode } = useHomeMode(userId, canEditOnMain(role));

  // Both doors have no branch selector (UI-principles §3.1/§3.2) — the
  // search box's create action always writes to main, gated the same way
  // every other main-only affordance in this product is (ADR-015).
  const { branch: mainBranch } = useMainBranch(model?.id ?? null);
  const canEdit = canEditOnMain(role);
  const searchCommitId = mainBranch?.head_commit_id ?? null;

  const directorState = useDirectorHome(model?.id ?? '', organisation?.id ?? '');
  const architectState = useArchitectHome(model?.id ?? '', userId);

  const loading = orgLoading || modelsLoading;

  if (loading || !model) {
    return (
      <div>
        <AppHeader />
        <main className={styles.main}>
          <Text tone="muted">{loading ? 'Loading…' : `No model found for "${modelSlug ?? ''}" in this organisation.`}</Text>
        </main>
      </div>
    );
  }

  return (
    <div>
      <AppHeader />
      <main className={styles.main}>
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            {model.name}
          </Text>
          <HomeModeSwitch homeMode={homeMode} onChange={setHomeMode} />
        </div>

        <Panel>
          {canEdit && mainBranch && searchCommitId ? (
            <HomeSearch
              modelId={model.id}
              orgId={organisation?.id ?? ''}
              userId={userId}
              searchCommitId={searchCommitId}
              branch={mainBranch}
              expectedHeadCommitId={searchCommitId}
              orgSlug={organisation?.slug ?? ''}
              modelSlug={model.slug}
            />
          ) : (
            <EmptyState>Only an owner or architect can add elements from here.</EmptyState>
          )}
        </Panel>

        <div className={styles.doorLinks}>
          <Link to={`/o/${organisation?.slug ?? ''}/m/${model.slug}/elements`}>
            <Text as="span" size="sm">
              Browse all elements →
            </Text>
          </Link>
        </div>

        {homeMode === 'director' && directorState.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {homeMode === 'director' && directorState.status === 'error' && <Text as="p">{directorState.message}</Text>}
        {homeMode === 'director' && directorState.status === 'ready' && (
          <DirectorHome data={directorState.data} orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} />
        )}

        {homeMode === 'architect' && architectState.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {homeMode === 'architect' && architectState.status === 'error' && <Text as="p">{architectState.message}</Text>}
        {homeMode === 'architect' && architectState.status === 'ready' && (
          <ArchitectHome data={architectState.data} orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} />
        )}
      </main>
    </div>
  );
}

import { useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { MemberRole } from '../../db/types';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useEditingBranch } from '../branches/useEditingBranch';
import { useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { ArchitectHome } from '../home/ArchitectHome';
import { DirectorHome } from '../home/DirectorHome';
import { HomeModeSwitch } from '../home/HomeModeSwitch';
import { HomeSearch } from '../home/HomeSearch';
import { useArchitectHome } from '../home/useArchitectHome';
import { useArchitectHomeInsights } from '../home/useArchitectHomeInsights';
import { useDirectorHome } from '../home/useDirectorHome';
import { useHomeMode } from '../home/useHomeMode';
import { useModels } from '../models/useModels';
import { canArchiveModel, canCreateChangeBranch, canEditOnMain, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { useRouteTiming } from '../perf/useRouteTiming';
import styles from './ModelHome.module.css';

/**
 * Sprint U4-2a item 2's own finding, live in the network panel: both doors'
 * entire data sets were fetching on every load, unconditionally — this
 * page called `useDirectorHome` *and* `useArchitectHome` every render
 * regardless of `homeMode`, so switching doors never saved any work and a
 * single page load duplicated the systems/actors/capabilities queries
 * both hooks happen to share. Splitting each door into its own tiny
 * component means React only ever mounts (and therefore only ever calls
 * the hook of) whichever one `homeMode` actually selects — "child hooks
 * never run" unless their data is actually needed, the same principle
 * this item's own resolved-model gate applies to an unresolved id.
 */
function DirectorDoor({
  modelId,
  orgId,
  userId,
  role,
  orgSlug,
  modelSlug,
  mainCommitIdHint,
}: {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  role: MemberRole | null;
  orgSlug: string;
  modelSlug: string;
  /** S1 item 15 (A2 remainder): `ModelHome`'s own already-resolved main head commit id — `useDirectorHome`'s own parameter comment. */
  mainCommitIdHint: UUID | null;
}) {
  const directorState = useDirectorHome(modelId, orgId, mainCommitIdHint);
  // E8 ("performance") phase 1: same route key as ArchitectDoor below — only one door ever mounts at a time (this file's own module comment), so they never race for the same marks.
  useRouteTiming('model-home', directorState.status === 'ready');
  if (directorState.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (directorState.status === 'error') return <Text as="p">{directorState.message}</Text>;
  return <DirectorHome data={directorState.data} reload={directorState.reload} modelId={modelId} orgId={orgId} userId={userId} role={role} orgSlug={orgSlug} modelSlug={modelSlug} mainCommitIdHint={mainCommitIdHint} />;
}

function ArchitectDoor({
  modelId,
  userId,
  role,
  orgSlug,
  modelSlug,
}: {
  modelId: UUID;
  userId: UUID | null;
  /** Prompt pack F3 PR6: "Start a decision" on a health finding row is gated the same as any other decision-starting entry point (`canStartDecision`) — this door had no role prop at all before this. */
  role: MemberRole | null;
  orgSlug: string;
  modelSlug: string;
}) {
  const architectState = useArchitectHome(modelId, userId);
  // E8 item (4): Health findings/Recent activity load after first paint,
  // in their own hook/state machine — `architectState` above (Review
  // queue, My changes) is the only thing this door's own first paint
  // waits on now; `useRouteTiming`'s own `ready` below reflects that.
  const insightsState = useArchitectHomeInsights(modelId, userId);
  // E8 ("performance") phase 1: see DirectorDoor's own comment on sharing this route key.
  useRouteTiming('model-home', architectState.status === 'ready');
  if (architectState.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (architectState.status === 'error') return <Text as="p">{architectState.message}</Text>;
  return <ArchitectHome data={architectState.data} insights={insightsState} role={role} orgSlug={orgSlug} modelSlug={modelSlug} />;
}

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
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const settingsMenuId = useId();

  // Handoff — Flow: Add a system, decision 5: the search box's create
  // action now follows the current selected ref (main, unless a change
  // is selected) rather than always writing to main — a contributor
  // viewing main gets `HomeSearch`'s own propose-a-change picker instead
  // of a direct write, same role split every other write path in this
  // product already makes (ADR-015/ADR-009). Bug fix: this used to
  // re-parse `?ref=` from this page's own URL, which a link to Home
  // (`ModelNav.tsx`'s own former `carriesRef: false`) never carried —
  // `useSelectedRef` reads the session-persisted selection instead, so
  // landing on Home doesn't silently reset the write target to main.
  const { ref } = useSelectedRef();
  const { branch: mainBranch } = useMainBranch(model?.id ?? null);
  const { branch: editingBranch } = useEditingBranch(model?.id ?? null, ref);
  const canShowSearch = canCreateChangeBranch(role);
  const searchCommitId = mainBranch?.head_commit_id ?? null;

  const loading = orgLoading || modelsLoading;

  if (loading || !model) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Text tone="muted">{loading ? 'Loading…' : `No model found for "${modelSlug ?? ''}" in this organisation.`}</Text>
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
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            {model.name}
          </Text>
          <div className={styles.headerActions}>
            <HomeModeSwitch homeMode={homeMode} onChange={setHomeMode} />
            {canArchiveModel(role) && (
              <div className={styles.menuWrapper}>
                <button
                  type="button"
                  className={styles.menuToggle}
                  aria-expanded={settingsMenuOpen}
                  aria-controls={settingsMenuId}
                  aria-label="Model actions"
                  onClick={() => {
                    setSettingsMenuOpen((o) => !o);
                  }}
                >
                  <span aria-hidden="true">⋯</span>
                </button>
                <div id={settingsMenuId} className={[styles.menu, settingsMenuOpen ? styles.open : ''].filter(Boolean).join(' ')}>
                  <Link to={`/o/${orgSlug ?? ''}/m/${model.slug}/settings`} className={styles.menuItem}>
                    <Text as="span" size="sm">
                      Model settings
                    </Text>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        <Panel>
          {canShowSearch && searchCommitId ? (
            <HomeSearch
              modelId={model.id}
              orgId={organisation?.id ?? ''}
              userId={userId}
              role={role}
              searchCommitId={searchCommitId}
              activeRef={ref}
              editingBranch={editingBranch}
              orgSlug={organisation?.slug ?? ''}
              modelSlug={model.slug}
              // Handoff — Flow: Add a system, decision 2: autofocus only on
              // the architect door — the director door's own content (the
              // weakness grid) is what a director opens this page to see.
              // eslint-disable-next-line jsx-a11y/no-autofocus -- HomeSearch's own input carries the real disable comment; this is a plain boolean prop being forwarded to it, opt-in per door.
              autoFocus={homeMode === 'architect'}
            />
          ) : (
            <EmptyState>Only an owner, architect, or contributor can add elements from here.</EmptyState>
          )}
        </Panel>

        <div className={styles.doorLinks}>
          <Link to={`/o/${organisation?.slug ?? ''}/m/${model.slug}/elements`}>
            <Text as="span" size="sm">
              Browse all elements →
            </Text>
          </Link>
        </div>

        {homeMode === 'director' && (
          <DirectorDoor
            modelId={model.id}
            orgId={organisation?.id ?? ''}
            userId={userId}
            role={role}
            orgSlug={organisation?.slug ?? ''}
            modelSlug={model.slug}
            mainCommitIdHint={mainBranch?.head_commit_id ?? null}
          />
        )}
        {homeMode === 'architect' && <ArchitectDoor modelId={model.id} userId={userId} role={role} orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} />}
        </main>
      </div>
    </div>
  );
}

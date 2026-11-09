import { Loading } from '../components/Loading/Loading';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useOwnProfile } from '../auth/useOwnProfile';
import { StartPagePanel } from '../profile/StartPagePanel';
import { NotificationPreferencesPanel } from '../profile/NotificationPreferencesPanel';
import { ProfileView } from '../profile/ProfileView';
import styles from './ProfilePage.module.css';

/**
 * Sprint F7 item 2: `/profile` — top-level, not org-scoped (a profile
 * "follows the person across every org they belong to", ADR-009's own
 * words for `atlas.profiles`, same reasoning `user_preferences` is
 * user-scoped rather than org-scoped) — the first page where a signed-in
 * user can see or change their own display name/handle/avatar, previously
 * reachable only through the one-shot `DisplayNamePrompt` gate on first
 * sign-in. Linked from `UserMenu.tsx`'s account menu on every page.
 */
export function ProfilePage() {
  const { userId } = useAuth();
  const { profile, loading, refresh } = useOwnProfile(userId);

  return (
    <div>
      <AppHeader />
      <main className={styles.main}>
        <Text as="h1" size="2xl">
          Profile
        </Text>
        {loading && <Loading />}
        {!loading && !profile && (
          <EmptyState>Your profile is created the moment you join or create your first organisation.</EmptyState>
        )}
        {!loading && profile && userId && (
          <>
            <ProfileView profile={profile} userId={userId} onSaved={refresh} />
            <StartPagePanel userId={userId} />
            <NotificationPreferencesPanel userId={userId} />
          </>
        )}
      </main>
    </div>
  );
}

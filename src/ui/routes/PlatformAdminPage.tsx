import { Loading } from '../components/Loading/Loading';
import { PlatformAdminView } from '../admin/PlatformAdminView';
import { usePlatformAdmin } from '../admin/usePlatformAdmin';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import styles from './ProfilePage.module.css';

/**
 * `/platform-admin` — top-level, not org-scoped, Atlas's first cross-org
 * role (`supabase/migrations/20260917030000_platform_admin.sql`'s own
 * module comment has the full design). Same shape as `ProfilePage.tsx`
 * (the only other top-level settings-style route), reusing its module CSS
 * directly rather than a near-identical copy.
 *
 * Unlike `OrganisationSettingsView.tsx` (where every member sees *some* of
 * the page, just with management sections hidden), a non-admin here sees
 * nothing about this page's existence or shape at all — no router-level
 * gate (matches this codebase's universal convention: `RequireAuth` only
 * checks authentication, every authorization check happens inside the
 * page), just a plain "no access" state once `usePlatformAdmin` resolves.
 */
export function PlatformAdminPage() {
  const { userId } = useAuth();
  const { isPlatformAdmin, loading } = usePlatformAdmin(userId);

  return (
    <div>
      <AppHeader />
      <main className={styles.main}>
        <Text as="h1" size="2xl">
          Platform admin
        </Text>
        {loading && <Loading />}
        {!loading && !isPlatformAdmin && <EmptyState>You don&apos;t have access to this page.</EmptyState>}
        {!loading && isPlatformAdmin && <PlatformAdminView />}
      </main>
    </div>
  );
}

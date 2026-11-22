import { Loading } from '../components/Loading/Loading';
import { PlatformAdminOverview } from '../admin/PlatformAdminOverview';
import { PlatformAdminView } from '../admin/PlatformAdminView';
import { ReferenceMapAdmin } from '../admin/ReferenceMapAdmin';
import { usePlatformAdmin } from '../admin/usePlatformAdmin';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { SettingsSections } from '../components/SettingsSection/SettingsSection';
import { useSettingsSectionsState } from '../components/SettingsSection/useSettingsSectionsState';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import styles from './PlatformAdminPage.module.css';

/**
 * `/platform-admin` — top-level, not org-scoped, Atlas's first cross-org
 * role (`supabase/migrations/20260917030000_platform_admin.sql`'s own
 * module comment has the full design). Same shape as `ProfilePage.tsx`,
 * with its own wider layout because the lists are tables.
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
  const sectionsState = useSettingsSectionsState('platform-admin', 'capability-sets');

  return (
    <div>
      <AppHeader />
      <main className={styles.main}>
        <Text as="h1" size="2xl">
          Platform admin
        </Text>
        {loading && <Loading />}
        {!loading && !isPlatformAdmin && <EmptyState>You don&apos;t have access to this page.</EmptyState>}
        {!loading && isPlatformAdmin && (
          <SettingsSections state={sectionsState} ids={['capability-sets', 'llm-proxy', 'organisations', 'people']}>
            <ReferenceMapAdmin />
            <PlatformAdminView />
            <PlatformAdminOverview />
          </SettingsSections>
        )}
      </main>
    </div>
  );
}

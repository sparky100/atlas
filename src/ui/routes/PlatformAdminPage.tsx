import { Navigate, Route, Routes } from 'react-router';
import { Loading } from '../components/Loading/Loading';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { usePlatformAdmin } from '../admin/usePlatformAdmin';
import { useAuth } from '../auth/useAuth';
import { CapabilitySetDraftPage } from './platformAdmin/CapabilitySetDraftPage';
import { CapabilitySetVersionPage } from './platformAdmin/CapabilitySetVersionPage';
import { CapabilitySetsPage } from './platformAdmin/CapabilitySetsPage';
import { CataloguePage } from './platformAdmin/CataloguePage';
import { CatalogueProductPage } from './platformAdmin/CatalogueProductPage';
import { CatalogueToolsPage } from './platformAdmin/CatalogueToolsPage';
import { CatalogueReviewPage } from './platformAdmin/CatalogueReviewPage';
import { CatalogueSectorPage } from './platformAdmin/CatalogueSectorPage';
import { CatalogueSectorsPage } from './platformAdmin/CatalogueSectorsPage';
import { CatalogueVersionPage } from './platformAdmin/CatalogueVersionPage';
import { LlmProxyPage } from './platformAdmin/LlmProxyPage';
import { OverviewPage } from './platformAdmin/OverviewPage';
import { PlatformAdminNav } from './platformAdmin/PlatformAdminNav';
import { SampleModelPage } from './platformAdmin/SampleModelPage';
import { SampleModelsPage } from './platformAdmin/SampleModelsPage';
import { UnsavedChangesProvider } from './platformAdmin/unsavedChanges';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import styles from './PlatformAdminPage.module.css';

/**
 * `/platform-admin` — top-level, not org-scoped, Atlas's first cross-org
 * role (`supabase/migrations/20260917030000_platform_admin.sql`'s own
 * module comment has the full design).
 *
 * Layout only: it gates the whole section once, then hands each area to its
 * own route below (`capability-sets`, `catalogue`, `sample-models`,
 * `llm-proxy`). Every child is reached through this component, so a direct
 * deep link gets the same platform-admin check as the index — no router-level
 * role gate, matching this codebase's universal convention (`RequireAuth`
 * only checks authentication; every authorization check happens inside the
 * page). A non-admin sees nothing about this section's shape at all, and no
 * child query runs.
 *
 * Routes sit here rather than in `App.tsx` so the whole admin section stays
 * one lazy-loaded chunk: only a platform admin ever downloads it, and
 * splitting it into a dozen separately lazy chunks would add requests without
 * helping anyone else.
 */
export function PlatformAdminPage() {
  const { userId } = useAuth();
  const { isPlatformAdmin, loading } = usePlatformAdmin(userId);

  return (
    <div>
      <AppHeader />
      {loading && <main className={styles.main}><Loading /></main>}
      {!loading && !isPlatformAdmin && <main className={styles.main}><EmptyState>You don&apos;t have access to this page.</EmptyState></main>}
      {!loading && isPlatformAdmin && (
        <UnsavedChangesProvider>
          <div className={navStyles.body}>
            <PlatformAdminNav />
            <main className={styles.main}>
              <Routes>
                <Route index element={<OverviewPage />} />
                <Route path="capability-sets" element={<CapabilitySetsPage />} />
                <Route path="capability-sets/versions/:mapId" element={<CapabilitySetVersionPage />} />
                <Route path="capability-sets/drafts/:draftId" element={<CapabilitySetDraftPage />} />
                <Route path="catalogue" element={<CataloguePage />} />
                <Route path="catalogue/products/new" element={<CatalogueProductPage />} />
                <Route path="catalogue/products/:productId" element={<CatalogueProductPage />} />
                <Route path="catalogue/review" element={<CatalogueReviewPage />} />
                <Route path="catalogue/tools" element={<CatalogueToolsPage />} />
                <Route path="catalogue/sectors" element={<CatalogueSectorsPage />} />
                <Route path="catalogue/sectors/:sector" element={<CatalogueSectorPage />} />
                <Route path="catalogue/sectors/:sector/versions/:catalogueId" element={<CatalogueVersionPage />} />
                <Route path="sample-models" element={<SampleModelsPage />} />
                <Route path="sample-models/:slug" element={<SampleModelPage />} />
                <Route path="llm-proxy" element={<LlmProxyPage />} />
                <Route path="*" element={<Navigate to="/platform-admin" replace />} />
              </Routes>
            </main>
          </div>
        </UnsavedChangesProvider>
      )}
    </div>
  );
}

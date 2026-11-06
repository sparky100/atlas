import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { SelectedRefProvider } from './branches/SelectedRefProvider';
import { BoundaryCrossingsPage } from './routes/BoundaryCrossingsPage';
import { ReportsPage } from './routes/ReportsPage';
import { SavedReportPage } from './routes/SavedReportPage';
import { DashboardPage } from './routes/DashboardPage';
import { CapabilityMapPage } from './routes/CapabilityMapPage';
import { CaptureJobListPage } from './routes/CaptureJobListPage';
import { CaptureReviewPage } from './routes/CaptureReviewPage';
import { ChangePage } from './routes/ChangePage';
import { ChangesPage } from './routes/ChangesPage';
import { ContainerPage } from './routes/ContainerPage';
import { ContextPage } from './routes/ContextPage';
import { DecisionOptionLandscapePage } from './routes/DecisionOptionLandscapePage';
import { DecisionPage } from './routes/DecisionPage';
import { DecisionsPage } from './routes/DecisionsPage';
import { ProjectPage } from './routes/ProjectPage';
import { ProjectsPage } from './routes/ProjectsPage';
import { DuplicatesReportPage } from './routes/DuplicatesReportPage';
import { ElementPage } from './routes/ElementPage';
import { ElementsPage } from './routes/ElementsPage';
import { ExternalInterfacesPage } from './routes/ExternalInterfacesPage';
import { Home } from './routes/Home';
import { LandscapePage } from './routes/LandscapePage';
import { ModelHome } from './routes/ModelHome';
import { ModelSettingsPage } from './routes/ModelSettingsPage';
import { OrganisationSettingsPage } from './routes/OrganisationSettingsPage';
import { OrgHome } from './routes/OrgHome';
import { PlatformAdminPage } from './routes/PlatformAdminPage';
import { PortfolioPage } from './routes/PortfolioPage';
import { IntegrationsPage } from './routes/IntegrationsPage';
import { GapsPage } from './routes/GapsPage';
import { ProfilePage } from './routes/ProfilePage';
import { RequireAuth } from './routes/RequireAuth';
import { ResetPasswordPage } from './routes/ResetPasswordPage';
import { ReviewQueuePage } from './routes/ReviewQueuePage';
import { ReviewRequestPage } from './routes/ReviewRequestPage';
import { RoadmapPage } from './routes/RoadmapPage';
import { SignIn } from './routes/SignIn';
import { ValueStreamsPage } from './routes/ValueStreamsPage';
import { VersionDiffPage } from './routes/VersionDiffPage';
import { VersionsPage } from './routes/VersionsPage';

/**
 * Sprint C1 step 7 adds the review queue (UI-principles §2.4's `/review`
 * and `/review/{mergeRequestId}` routes, SPEC §7.4) — the last two routes
 * below.
 *
 * `SelectedRefProvider` wraps `Routes` (inside `BrowserRouter`, so it can
 * read `useLocation`/`useSearchParams`, but mounted once above every
 * route rather than per page) — see its own module comment for the bug
 * this fixes: a selected change branch used to be lost the moment any
 * link dropped `?ref=`, since every page re-derived it from nothing but
 * its own URL with no memory of a prior choice.
 */
export function App() {
  return (
    <BrowserRouter>
      <SelectedRefProvider>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Home />} />
            {/* Sprint F7 item 2: top-level, not org-scoped — a profile follows the person across every org (ADR-009), same reasoning user_preferences is user-scoped rather than org-scoped. */}
            <Route path="/profile" element={<ProfilePage />} />
            {/* Sprint F7 item 3: reachable only via a real recovery-link session — see ResetPasswordPage.tsx's own comment for why this sits inside RequireAuth rather than needing its own guard. */}
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {/* Atlas's first cross-org role (supabase/migrations/20260917030000_platform_admin.sql) — top-level, not org-scoped, same reasoning /profile above. No router-level role gate: the page itself checks usePlatformAdmin, matching every other authorization check in this codebase (RequireAuth is authentication-only). */}
            <Route path="/platform-admin" element={<PlatformAdminPage />} />
            <Route path="/o/:orgSlug" element={<OrgHome />} />
            <Route path="/o/:orgSlug/settings" element={<OrganisationSettingsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug" element={<ModelHome />} />
            <Route path="/o/:orgSlug/m/:modelSlug/settings" element={<ModelSettingsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/e/:elementId" element={<ElementPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/elements" element={<ElementsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/landscape" element={<LandscapePage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/capability-map" element={<CapabilityMapPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/roadmap" element={<RoadmapPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/value-streams" element={<ValueStreamsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/portfolio" element={<PortfolioPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/integrations" element={<IntegrationsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/gaps" element={<GapsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/context/:elementId" element={<ContextPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/container/:systemId" element={<ContainerPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/versions" element={<VersionsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/capture" element={<CaptureJobListPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/changes" element={<ChangesPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/changes/:branchId" element={<ChangePage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/projects" element={<ProjectsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/projects/:projectId" element={<ProjectPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/decisions" element={<DecisionsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/decisions/:decisionId" element={<DecisionPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/decisions/:decisionId/options/:branchId/landscape" element={<DecisionOptionLandscapePage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/diff" element={<VersionDiffPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/review" element={<ReviewQueuePage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/review/:mergeRequestId" element={<ReviewRequestPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/review/capture/:jobId" element={<CaptureReviewPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/reports" element={<ReportsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/reports/saved/:id" element={<SavedReportPage kind="report" />} />
            <Route path="/o/:orgSlug/m/:modelSlug/reports/copies/:id" element={<SavedReportPage kind="copy" />} />
            <Route path="/o/:orgSlug/m/:modelSlug/reports/dashboards/:id" element={<DashboardPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/boundary-crossings" element={<BoundaryCrossingsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/external-interfaces" element={<ExternalInterfacesPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/duplicates" element={<DuplicatesReportPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SelectedRefProvider>
    </BrowserRouter>
  );
}

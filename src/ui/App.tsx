import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { SelectedRefProvider } from './branches/SelectedRefProvider';
import { Button } from './components/Button/Button';
import { Loading } from './components/Loading/Loading';
import { Text } from './components/Text/Text';
import { loadModelPage } from './routes/modelPageLoaders';
import { StartRedirect } from './routes/StartRedirect';
import { ModelRouteGate } from './routes/ModelRouteGate';
import { RequireAuth } from './routes/RequireAuth';
import { SignIn } from './routes/SignIn';

function PageLoadFailed() {
  return (
    <main style={{ padding: 'var(--space-8)' }}>
      <Text as="h1" size="lg">This page couldn’t load</Text>
      <Text as="p" tone="muted">Reload the page to try again.</Text>
      <Button onClick={() => { window.location.reload(); }}>Reload page</Button>
      <Text as="p"><Link to="/">Go to Home</Link></Text>
    </main>
  );
}

function lazyRoute<Module, Props>(load: () => Promise<Module>, select: (module: Module) => (props: Props) => ReactNode) {
  return lazy<(props: Props) => ReactNode>(async () => {
    try {
      return { default: select(await load()) };
    } catch (error) {
      console.error('Could not load the page module.', error);
      return { default: PageLoadFailed };
    }
  });
}

const BoundaryCrossingsPage = lazyRoute(() => import('./routes/BoundaryCrossingsPage'), (module) => module.BoundaryCrossingsPage);
const ReportsPage = lazyRoute(() => import('./routes/ReportsPage'), (module) => module.ReportsPage);
const SavedReportPage = lazyRoute(() => import('./routes/SavedReportPage'), (module) => module.SavedReportPage);
const AskAtlasPage = lazyRoute(() => import('./routes/AskAtlasPage'), (module) => module.AskAtlasPage);
const DashboardPage = lazyRoute(() => import('./routes/DashboardPage'), (module) => module.DashboardPage);
const CapabilityMapPage = lazyRoute(() => import('./routes/CapabilityMapPage'), (module) => module.CapabilityMapPage);
const CaptureJobListPage = lazyRoute(() => import('./routes/CaptureJobListPage'), (module) => module.CaptureJobListPage);
const CaptureReviewPage = lazyRoute(() => import('./routes/CaptureReviewPage'), (module) => module.CaptureReviewPage);
const ChangePage = lazyRoute(() => import('./routes/ChangePage'), (module) => module.ChangePage);
const ChangesPage = lazyRoute(() => import('./routes/ChangesPage'), (module) => module.ChangesPage);
const ContainerPage = lazyRoute(() => import('./routes/ContainerPage'), (module) => module.ContainerPage);
const ContextPage = lazyRoute(() => import('./routes/ContextPage'), (module) => module.ContextPage);
const DecisionOptionLandscapePage = lazyRoute(() => import('./routes/DecisionOptionLandscapePage'), (module) => module.DecisionOptionLandscapePage);
const DecisionPage = lazyRoute(() => import('./routes/DecisionPage'), (module) => module.DecisionPage);
const DecisionsPage = lazyRoute(() => import('./routes/DecisionsPage'), (module) => module.DecisionsPage);
const ProjectPage = lazyRoute(() => import('./routes/ProjectPage'), (module) => module.ProjectPage);
const PrinciplesPage = lazyRoute(() => import('./routes/PrinciplesPage'), (module) => module.PrinciplesPage);
const ProjectsPage = lazyRoute(() => import('./routes/ProjectsPage'), (module) => module.ProjectsPage);
const WorkPage = lazyRoute(() => import('./routes/WorkPage'), (module) => module.WorkPage);
const DuplicatesReportPage = lazyRoute(() => import('./routes/DuplicatesReportPage'), (module) => module.DuplicatesReportPage);
const ElementPage = lazyRoute(() => import('./routes/ElementPage'), (module) => module.ElementPage);
const ElementsPage = lazyRoute(() => loadModelPage.elements(), (module) => module.ElementsPage);
const ExternalInterfacesPage = lazyRoute(() => import('./routes/ExternalInterfacesPage'), (module) => module.ExternalInterfacesPage);
const Home = lazyRoute(() => import('./routes/Home'), (module) => module.Home);
const LandscapePage = lazyRoute(() => import('./routes/LandscapePage'), (module) => module.LandscapePage);
const ModelHome = lazyRoute(() => import('./routes/ModelHome'), (module) => module.ModelHome);
const ModelSettingsPage = lazyRoute(() => import('./routes/ModelSettingsPage'), (module) => module.ModelSettingsPage);
const OrganisationSettingsPage = lazyRoute(() => import('./routes/OrganisationSettingsPage'), (module) => module.OrganisationSettingsPage);
const OrgHome = lazyRoute(() => import('./routes/OrgHome'), (module) => module.OrgHome);
const PlatformAdminPage = lazyRoute(() => import('./routes/PlatformAdminPage'), (module) => module.PlatformAdminPage);
const PortfolioPage = lazyRoute(() => loadModelPage.portfolio(), (module) => module.PortfolioPage);
const IntegrationsPage = lazyRoute(() => import('./routes/IntegrationsPage'), (module) => module.IntegrationsPage);
const GapsPage = lazyRoute(() => import('./routes/GapsPage'), (module) => module.GapsPage);
const ProfilePage = lazyRoute(() => import('./routes/ProfilePage'), (module) => module.ProfilePage);
const ResetPasswordPage = lazyRoute(() => import('./routes/ResetPasswordPage'), (module) => module.ResetPasswordPage);
const ReviewQueuePage = lazyRoute(() => import('./routes/ReviewQueuePage'), (module) => module.ReviewQueuePage);
const ReviewRequestPage = lazyRoute(() => import('./routes/ReviewRequestPage'), (module) => module.ReviewRequestPage);
const RoadmapPage = lazyRoute(() => import('./routes/RoadmapPage'), (module) => module.RoadmapPage);
const ValueStreamsPage = lazyRoute(() => import('./routes/ValueStreamsPage'), (module) => module.ValueStreamsPage);
const VersionDiffPage = lazyRoute(() => import('./routes/VersionDiffPage'), (module) => module.VersionDiffPage);
const VersionsPage = lazyRoute(() => import('./routes/VersionsPage'), (module) => module.VersionsPage);

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
        <Suspense fallback={<main style={{ padding: 'var(--space-8)' }}><Loading /></main>}>
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
              <Route element={<ModelRouteGate />}>
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
                <Route path="/o/:orgSlug/m/:modelSlug/start" element={<StartRedirect />} />
                <Route path="/o/:orgSlug/m/:modelSlug/work" element={<WorkPage />} />
                <Route path="/o/:orgSlug/m/:modelSlug/changes" element={<ChangesPage />} />
                <Route path="/o/:orgSlug/m/:modelSlug/changes/:branchId" element={<ChangePage />} />
                <Route path="/o/:orgSlug/m/:modelSlug/projects" element={<ProjectsPage />} />
                <Route path="/o/:orgSlug/m/:modelSlug/projects/:projectId" element={<ProjectPage />} />
                <Route path="/o/:orgSlug/m/:modelSlug/principles" element={<PrinciplesPage />} />
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
                <Route path="/o/:orgSlug/m/:modelSlug/ask" element={<AskAtlasPage />} />
                <Route path="/o/:orgSlug/m/:modelSlug/boundary-crossings" element={<BoundaryCrossingsPage />} />
                <Route path="/o/:orgSlug/m/:modelSlug/external-interfaces" element={<ExternalInterfacesPage />} />
                <Route path="/o/:orgSlug/m/:modelSlug/duplicates" element={<DuplicatesReportPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </SelectedRefProvider>
    </BrowserRouter>
  );
}

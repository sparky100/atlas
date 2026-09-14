import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { SelectedRefProvider } from './branches/SelectedRefProvider';
import { BoundaryCrossingsPage } from './routes/BoundaryCrossingsPage';
import { CapabilityMapPage } from './routes/CapabilityMapPage';
import { ChangePage } from './routes/ChangePage';
import { ChangesPage } from './routes/ChangesPage';
import { ContainerPage } from './routes/ContainerPage';
import { ContextPage } from './routes/ContextPage';
import { DecisionPage } from './routes/DecisionPage';
import { DecisionsPage } from './routes/DecisionsPage';
import { ElementPage } from './routes/ElementPage';
import { ElementsPage } from './routes/ElementsPage';
import { ExternalInterfacesPage } from './routes/ExternalInterfacesPage';
import { Home } from './routes/Home';
import { LandscapePage } from './routes/LandscapePage';
import { ModelHome } from './routes/ModelHome';
import { ModelSettingsPage } from './routes/ModelSettingsPage';
import { OrganisationSettingsPage } from './routes/OrganisationSettingsPage';
import { OrgHome } from './routes/OrgHome';
import { ProfilePage } from './routes/ProfilePage';
import { RequireAuth } from './routes/RequireAuth';
import { ReviewQueuePage } from './routes/ReviewQueuePage';
import { ReviewRequestPage } from './routes/ReviewRequestPage';
import { SignIn } from './routes/SignIn';
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
            <Route path="/o/:orgSlug" element={<OrgHome />} />
            <Route path="/o/:orgSlug/settings" element={<OrganisationSettingsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug" element={<ModelHome />} />
            <Route path="/o/:orgSlug/m/:modelSlug/settings" element={<ModelSettingsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/e/:elementId" element={<ElementPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/elements" element={<ElementsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/landscape" element={<LandscapePage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/capability-map" element={<CapabilityMapPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/context/:systemId" element={<ContextPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/container/:systemId" element={<ContainerPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/versions" element={<VersionsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/changes" element={<ChangesPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/changes/:branchId" element={<ChangePage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/decisions" element={<DecisionsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/decisions/:decisionId" element={<DecisionPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/diff" element={<VersionDiffPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/review" element={<ReviewQueuePage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/review/:mergeRequestId" element={<ReviewRequestPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/boundary-crossings" element={<BoundaryCrossingsPage />} />
            <Route path="/o/:orgSlug/m/:modelSlug/external-interfaces" element={<ExternalInterfacesPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SelectedRefProvider>
    </BrowserRouter>
  );
}

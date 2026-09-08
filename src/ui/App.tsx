import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { CapabilityMapPage } from './routes/CapabilityMapPage';
import { ChangePage } from './routes/ChangePage';
import { ChangesPage } from './routes/ChangesPage';
import { ComponentPage } from './routes/ComponentPage';
import { ContainerPage } from './routes/ContainerPage';
import { ContextPage } from './routes/ContextPage';
import { ElementPage } from './routes/ElementPage';
import { ElementsPage } from './routes/ElementsPage';
import { Home } from './routes/Home';
import { LandscapePage } from './routes/LandscapePage';
import { ModelHome } from './routes/ModelHome';
import { OrgHome } from './routes/OrgHome';
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
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Home />} />
          <Route path="/o/:orgSlug" element={<OrgHome />} />
          <Route path="/o/:orgSlug/m/:modelSlug" element={<ModelHome />} />
          <Route path="/o/:orgSlug/m/:modelSlug/e/:elementId" element={<ElementPage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/elements" element={<ElementsPage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/landscape" element={<LandscapePage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/capability-map" element={<CapabilityMapPage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/context/:systemId" element={<ContextPage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/container/:systemId" element={<ContainerPage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/component/:containerId" element={<ComponentPage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/versions" element={<VersionsPage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/changes" element={<ChangesPage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/changes/:branchId" element={<ChangePage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/diff" element={<VersionDiffPage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/review" element={<ReviewQueuePage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/review/:mergeRequestId" element={<ReviewRequestPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

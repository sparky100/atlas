import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { CapabilityMapPage } from './routes/CapabilityMapPage';
import { ComponentPage } from './routes/ComponentPage';
import { ContainerPage } from './routes/ContainerPage';
import { ContextPage } from './routes/ContextPage';
import { ElementPage } from './routes/ElementPage';
import { Home } from './routes/Home';
import { LandscapePage } from './routes/LandscapePage';
import { ModelHome } from './routes/ModelHome';
import { OrgHome } from './routes/OrgHome';
import { RequireAuth } from './routes/RequireAuth';
import { SignIn } from './routes/SignIn';

/**
 * Sprint U2 step 3 adds the zoom chain's remaining three view kinds —
 * Context, Container, Component (UI-principles §6.1/§2.1) — plus the
 * breadcrumb and the deep links tying them together with the capability
 * map and a capability-filtered landscape. Versions/diffing is the one
 * remaining later step in this sprint; its routes/affordances don't exist
 * yet, rather than existing as placeholders that look finished.
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
          <Route path="/o/:orgSlug/m/:modelSlug/landscape" element={<LandscapePage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/capability-map" element={<CapabilityMapPage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/context/:systemId" element={<ContextPage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/container/:systemId" element={<ContainerPage />} />
          <Route path="/o/:orgSlug/m/:modelSlug/component/:containerId" element={<ComponentPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

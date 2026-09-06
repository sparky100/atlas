import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { CapabilityMapPage } from './routes/CapabilityMapPage';
import { ElementPage } from './routes/ElementPage';
import { Home } from './routes/Home';
import { LandscapePage } from './routes/LandscapePage';
import { ModelHome } from './routes/ModelHome';
import { OrgHome } from './routes/OrgHome';
import { RequireAuth } from './routes/RequireAuth';
import { SignIn } from './routes/SignIn';

/**
 * Sprint U2 step 1 adds the capability map (nested capability tiles; the
 * `capability_map` view kind). Editing on the map, starter-map tailoring,
 * the cross-view zoom chain, and versions/diffing are later steps in this
 * same sprint — routes/affordances for them don't exist yet, rather than
 * existing as placeholders that look finished.
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

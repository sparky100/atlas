import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ElementPage } from './routes/ElementPage';
import { Home } from './routes/Home';
import { LandscapePage } from './routes/LandscapePage';
import { ModelHome } from './routes/ModelHome';
import { OrgHome } from './routes/OrgHome';
import { RequireAuth } from './routes/RequireAuth';
import { SignIn } from './routes/SignIn';

/**
 * Sprint U1 step 4a adds the landscape view (systems in swim-lanes; the
 * `landscape` view kind only — context/container/component and capability
 * map are later work, per UI-principles §6.1's amendment). No capture, no
 * branches, no editing yet (step 5) — routes for them don't exist, rather
 * than existing as placeholders that look finished.
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

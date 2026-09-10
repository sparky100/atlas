import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { Text } from '../components/Text/Text';

/**
 * Gates every route under it on a real session — redirects to /sign-in,
 * remembering where the user was headed.
 *
 * The Prompt 7h "first sign-in prompts for a display name" gate lives in
 * `Home.tsx`, not here — see that component's own comment for why: a
 * brand-new user has no `atlas.profiles` row at all until their first
 * organisation membership (Sprint M1a's `atlas.ensure_profile`), and
 * `Home` (the post-sign-in landing page, `SignIn.tsx`'s own redirect
 * target) is where that membership is created and where a real user's
 * "first sign-in" identity moment actually happens — not every route a
 * test or a deep link can reach directly.
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div style={{ padding: 'var(--space-8)' }}>
        <Text tone="muted">Loading…</Text>
      </div>
    );
  }

  if (status === 'signedOut') {
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

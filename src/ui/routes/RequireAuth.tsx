import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { Text } from '../components/Text/Text';

/** Gates every route under it on a real session — redirects to /sign-in, remembering where the user was headed. */
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

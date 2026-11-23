import { useOwnProfile } from '../auth/useOwnProfile';
import { useAuth } from '../auth/useAuth';
import { headerDisplayName } from '../components/UserMenu/headerIdentity';

/**
 * The acting platform admin's readable name, recorded automatically as the
 * reviewer on new catalogue claims and capability-set sources. The value is
 * stored for audit only; no reader view or pack renders it.
 */
export function useActingAdminName(): string {
  const { userId, email } = useAuth();
  const { profile } = useOwnProfile(userId);
  return headerDisplayName(profile, email);
}

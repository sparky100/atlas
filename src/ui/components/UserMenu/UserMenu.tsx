import { useId, useState } from 'react';
import { Settings } from 'lucide-react';
import { Link } from 'react-router';
import { usePlatformAdmin } from '../../admin/usePlatformAdmin';
import { useAuth } from '../../auth/useAuth';
import { useOwnProfile } from '../../auth/useOwnProfile';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import { ThemeDensityToggle } from '../ThemeDensityToggle/ThemeDensityToggle';
import { headerDisplayName, headerInitials } from './headerIdentity';
import styles from './UserMenu.module.css';

type OpenMenu = 'settings' | 'account' | null;

/**
 * The right-hand end of the shared simmodlr header pattern (the same in
 * Loop, Flow, Lens, Compass and Atlas — `AppHeader.tsx` places the bell and
 * Help before this): `[avatar + name] [⚙ Settings] [••• Account menu]`.
 *
 * - **Avatar + name** — not interactive. `atlas.profiles`' own display
 *   name/handle/avatar when the person has a profile (`useOwnProfile`),
 *   the email otherwise. The name text is dropped below 640px; the
 *   avatar's `title` still carries it.
 * - **⚙ Settings** — theme and density (UI-principles.md §3 / §8.8), its
 *   own disclosure, never inside the account menu.
 * - **••• Account menu** — Profile, Platform admin (platform admins only,
 *   omitted rather than shown disabled) and Sign out. No Feedback/About
 *   rows: Atlas has neither feature, and CLAUDE.md rule 7 rules out a
 *   placeholder (decided 2026-10-15).
 *
 * Both disclosures keep Sprint U4-2a item 6's shape — the same toggle and
 * panel at every width, pinned to the screen on a phone
 * (`UserMenu.module.css`) — and only one is open at a time.
 */
export function UserMenu() {
  const { userId, email, signOut } = useAuth();
  const { isPlatformAdmin } = usePlatformAdmin(userId);
  const { profile } = useOwnProfile(userId);
  const [open, setOpen] = useState<OpenMenu>(null);
  const settingsId = useId();
  const accountId = useId();

  const name = headerDisplayName(profile, email);
  const toggle = (menu: Exclude<OpenMenu, null>) => {
    setOpen((current) => (current === menu ? null : menu));
  };

  return (
    <div className={styles.cluster}>
      <div className={styles.identity} title={name}>
        {profile?.avatar_url ? (
          <img className={styles.avatar} src={profile.avatar_url} alt="" />
        ) : (
          <span className={styles.avatar} aria-hidden="true">
            {headerInitials(profile, email)}
          </span>
        )}
        <span className={styles.name}>{name}</span>
      </div>

      <div className={styles.wrapper}>
        <button
          type="button"
          className={styles.toggle}
          aria-label="Settings"
          title="Settings"
          aria-expanded={open === 'settings'}
          aria-controls={settingsId}
          onClick={() => {
            toggle('settings');
          }}
        >
          <Settings size={18} aria-hidden="true" />
        </button>
        <div id={settingsId} className={[styles.menu, open === 'settings' ? styles.open : ''].filter(Boolean).join(' ')}>
          <ThemeDensityToggle />
        </div>
      </div>

      <div className={styles.wrapper}>
        <button
          type="button"
          className={styles.toggle}
          aria-label="Account menu"
          title="More"
          aria-expanded={open === 'account'}
          aria-controls={accountId}
          onClick={() => {
            toggle('account');
          }}
        >
          <span aria-hidden="true" className={styles.dots}>
            •••
          </span>
        </button>
        <div id={accountId} className={[styles.menu, open === 'account' ? styles.open : ''].filter(Boolean).join(' ')}>
          {email !== null && (
            <Text tone="muted" size="sm" className={styles.email}>
              {email}
            </Text>
          )}
          <Link
            to="/profile"
            className={styles.profileLink}
            onClick={() => {
              setOpen(null);
            }}
          >
            <Text as="span" size="sm">
              Profile
            </Text>
          </Link>
          {/* Atlas's first cross-org role — omitted entirely for a non-admin, the same "not shown disabled" convention every other conditional affordance in this codebase uses (e.g. ElementHeader.tsx's onRetire/onRemoveFromModel). */}
          {isPlatformAdmin && (
            <Link
              to="/platform-admin"
              className={styles.profileLink}
              onClick={() => {
                setOpen(null);
              }}
            >
              <Text as="span" size="sm">
                Platform admin
              </Text>
            </Link>
          )}
          {/* Sprint F7 item 2: this device only — the profile page's own "Sign out everywhere" is the explicit, heavier action (`{scope:'global'}`); this one previously had no scope at all, which supabase-js v2 defaults to 'global' — narrowing it to 'local' is the actual behaviour change this decision makes, not just a label. */}
          <Button
            variant="ghost"
            onClick={() => {
              void signOut('local');
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

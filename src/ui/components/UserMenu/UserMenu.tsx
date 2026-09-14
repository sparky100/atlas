import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import { ThemeDensityToggle } from '../ThemeDensityToggle/ThemeDensityToggle';
import styles from './UserMenu.module.css';

/** The avatar toggle's own monogram — just the email's first character, uppercased; this menu has no `atlas.profiles` row to draw a real `Avatar` from (`../Avatar/Avatar.tsx`'s own monogram needs a display name/handle this header, being global rather than org-scoped, doesn't have on hand) — a single letter is enough to make the toggle read as "you," not a status/identity claim. */
function monogramFor(email: string | null): string {
  const first = email?.trim().charAt(0);
  return first ? first.toUpperCase() : '?';
}

/**
 * The "user menu" UI-principles §3/§8.8 puts theme/density switching in.
 *
 * Sprint U4-2a item 6: a single avatar-styled toggle opens the same
 * disclosure on every viewport now — desktop used to keep
 * email/theme/density/sign-out always open, inline in the header bar
 * (Sprint U3b's own original comment here, since replaced); that's gone,
 * so a desktop header reads the same at any width, not two different
 * controls depending on viewport. `<768px` keeps its own positioning
 * (mobile's own panel styling in `UserMenu.module.css`) but the
 * open/closed *behaviour* — and the round, initial-lettered toggle itself
 * — is no longer conditional on viewport at all.
 */
export function UserMenu() {
  const { email, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={menuId} onClick={() => { setOpen((o) => !o); }}>
        <span aria-hidden="true">{monogramFor(email)}</span>
        <span className={styles.srOnly}>Account menu</span>
      </button>
      <div id={menuId} className={[styles.menu, open ? styles.open : ''].filter(Boolean).join(' ')}>
        {email !== null && (
          <Text tone="muted" size="sm">
            {email}
          </Text>
        )}
        <ThemeDensityToggle />
        <Link to="/profile" className={styles.profileLink} onClick={() => { setOpen(false); }}>
          <Text as="span" size="sm">
            Profile
          </Text>
        </Link>
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
  );
}

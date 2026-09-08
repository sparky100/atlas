import { useId, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import { ThemeDensityToggle } from '../ThemeDensityToggle/ThemeDensityToggle';
import styles from './UserMenu.module.css';

/**
 * The "user menu" UI-principles §3/§8.8 puts theme/density switching in.
 * Sprint U3b: on a narrow viewport (the same breakpoint the design system
 * treats as mobile elsewhere), email/theme/density/sign-out collapse
 * behind a disclosure button instead of sitting in the header bar
 * unconditionally — a bar wide enough for four items plus the breadcrumb
 * on desktop has no room for all of it on a phone. Desktop keeps the
 * always-open bar (`.toggle` is CSS-hidden above the breakpoint, `.menu`
 * always shown); only the CSS query changes which of the two is real, not
 * this component's own logic — no separate mobile/desktop code paths. A
 * plain expanded panel/disclosure for now (no popover primitive exists
 * yet) — revisit once the design system grows one.
 */
export function UserMenu() {
  const { email, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={menuId} onClick={() => { setOpen((o) => !o); }}>
        <span aria-hidden="true">☰</span>
        <span className={styles.srOnly}>Menu</span>
      </button>
      <div id={menuId} className={[styles.menu, open ? styles.open : ''].filter(Boolean).join(' ')}>
        {email !== null && (
          <Text tone="muted" size="sm">
            {email}
          </Text>
        )}
        <ThemeDensityToggle />
        <Button
          variant="ghost"
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

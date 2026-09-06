import { useAuth } from '../../auth/useAuth';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import { ThemeDensityToggle } from '../ThemeDensityToggle/ThemeDensityToggle';
import styles from './UserMenu.module.css';

/**
 * The "user menu" UI-principles §3/§8.8 puts theme/density switching in.
 * A plain expanded panel for now (no popover/menu primitive exists yet) —
 * revisit once the design system grows one.
 */
export function UserMenu() {
  const { email, signOut } = useAuth();

  return (
    <div className={styles.menu}>
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
  );
}

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Text } from '../Text/Text';
import { UserMenu } from '../UserMenu/UserMenu';
import styles from './AppHeader.module.css';

export interface AppHeaderProps {
  /** The breadcrumb-ish left side (UI-principles §2.2) — a plain org/model name for now; the full segmented breadcrumb with a ref chip is later sprint work, once branches/tags exist in the UI. */
  children?: ReactNode;
}

export function AppHeader({ children }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <Link to="/" className={styles.brand}>
          <Text size="lg" as="span">
            Atlas
          </Text>
        </Link>
        {children}
      </div>
      <UserMenu />
    </header>
  );
}

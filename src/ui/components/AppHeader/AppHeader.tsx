import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Text } from '../Text/Text';
import { UserMenu } from '../UserMenu/UserMenu';
import styles from './AppHeader.module.css';

export interface AppHeaderProps {
  /**
   * Extra content next to the "Atlas" brand link — e.g. `OrgHome`'s
   * `OrgSwitcher`. Not the segmented breadcrumb: that's `../Breadcrumb/
   * Breadcrumb.tsx` (UI-principles §2.2, Sprint U2 step 3), rendered as its
   * own component inside each page's `<main>`, not as `AppHeader`'s
   * children.
   */
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

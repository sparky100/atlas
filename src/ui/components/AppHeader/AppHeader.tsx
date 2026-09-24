import { useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Link } from 'react-router';
import type { HelpContext } from '../../help/helpAssistantPrompt';
import { HelpPanel } from '../../help/HelpPanel';
import { NotificationTray } from '../NotificationTray/NotificationTray';
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
  /**
   * The current organisation's id, for a route that has one — the AI Help
   * chat calls the shared `llm-proxy` per-org (membership check, rate
   * limit, audit log, ADR-014), so it has nothing to call without one.
   * Omitted (default `null`) on a route with no org context (Home, sign-in,
   * profile, platform admin) — Help simply doesn't render there, the same
   * "not shown disabled" convention `UserMenu.tsx`'s own "Platform admin"
   * link uses, rather than a button that opens onto nothing.
   */
  orgId?: string | null;
  /** Passed straight through to `HelpPanel`'s own first-turn context — the current page's display name and (for a model-scoped page) coarse counts, never model content. */
  helpContext?: HelpContext;
}

export function AppHeader({ children, orgId = null, helpContext }: AppHeaderProps) {
  const [helpOpen, setHelpOpen] = useState(false);

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
      <div className={styles.right}>
        {orgId !== null && (
          <button type="button" className={styles.helpToggle} aria-label="Help" onClick={() => { setHelpOpen(true); }}>
            <CircleHelp size={18} aria-hidden="true" />
          </button>
        )}
        <NotificationTray />
        <UserMenu />
      </div>
      {orgId !== null && <HelpPanel open={helpOpen} onClose={() => { setHelpOpen(false); }} orgId={orgId} context={helpContext} />}
    </header>
  );
}

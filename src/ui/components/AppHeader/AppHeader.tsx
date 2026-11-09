import { useState, type ReactNode } from 'react';
import { CircleHelp, Search } from 'lucide-react';
import { Link, useParams } from 'react-router';
import type { HelpContext } from '../../help/helpAssistantPrompt';
import { HelpPanel } from '../../help/HelpPanel';
import { OPEN_SEARCH_EVENT } from '../../search/openSearchEvent';
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
  // A model page: search anywhere is one tap here on a phone (the rail's Search button is two taps away, inside More).
  const { modelSlug } = useParams<{ modelSlug: string }>();

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
        {/* The shared simmodlr header pattern (Loop, Flow, Lens, Compass,
            Atlas): [bell] [? Help] [avatar + name] [⚙ Settings] [•••] —
            the last three are UserMenu's own cluster. */}
        {modelSlug !== undefined && (
          <button
            type="button"
            className={[styles.helpToggle, styles.searchToggle].join(" ")}
            aria-label="Search"
            title="Search"
            onClick={() => {
              window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
            }}
          >
            <Search size={18} aria-hidden="true" />
          </button>
        )}
        <NotificationTray />
        {orgId !== null && (
          <button type="button" className={styles.helpToggle} aria-label="Help" title="Help" onClick={() => { setHelpOpen(true); }}>
            <CircleHelp size={18} aria-hidden="true" />
          </button>
        )}
        <UserMenu />
      </div>
      {orgId !== null && <HelpPanel open={helpOpen} onClose={() => { setHelpOpen(false); }} orgId={orgId} context={helpContext} />}
    </header>
  );
}

import { ClipboardCheck, Ellipsis, Grid, History, Home, Monitor, Package, Search, Sparkles, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Text } from '../../components/Text/Text';
import { listClaimsWaitingForReview } from '../../../db/catalogueAdmin';
import { supabase } from '../../supabaseClient';
import navStyles from '../../components/ModelNav/ModelNav.module.css';
import { useUnsavedChangesGuard } from './unsavedChanges';
import styles from './PlatformAdminNav.module.css';

type SectionId = 'overview' | 'capability-sets' | 'products' | 'review' | 'tools' | 'sectors' | 'sample-models' | 'llm-proxy';

interface Section {
  id: SectionId;
  to: string;
  label: string;
  /** A shorter label for the phone bar, where the full one does not fit a fifth of the width. */
  shortLabel?: string;
  icon: LucideIcon;
  /** A small tag after the label. */
  tag?: string;
  match: (pathname: string) => boolean;
}

const SECTIONS: Record<SectionId, Section> = {
  overview: { id: 'overview', to: '/platform-admin', label: 'Overview', icon: Home, match: (pathname) => pathname === '/platform-admin' || pathname === '/platform-admin/' },
  'capability-sets': { id: 'capability-sets', to: '/platform-admin/capability-sets', label: 'Capability sets', icon: Grid, match: (pathname) => pathname === '/platform-admin/capability-sets' || pathname.startsWith('/platform-admin/capability-sets/') },
  products: { id: 'products', to: '/platform-admin/catalogue', label: 'Products', icon: Package, match: (pathname) => pathname === '/platform-admin/catalogue' || pathname.startsWith('/platform-admin/catalogue/products') },
  review: { id: 'review', to: '/platform-admin/catalogue/review', label: 'Waiting for review', shortLabel: 'Review', icon: ClipboardCheck, match: (pathname) => pathname.startsWith('/platform-admin/catalogue/review') },
  tools: { id: 'tools', to: '/platform-admin/catalogue/tools', label: 'Find and check', shortLabel: 'Find', icon: Search, match: (pathname) => pathname.startsWith('/platform-admin/catalogue/tools') },
  sectors: { id: 'sectors', to: '/platform-admin/catalogue/sectors', label: 'Sector catalogues', icon: History, tag: 'History', match: (pathname) => pathname.startsWith('/platform-admin/catalogue/sectors') },
  'sample-models': { id: 'sample-models', to: '/platform-admin/sample-models', label: 'Sample models', icon: Monitor, match: (pathname) => pathname.startsWith('/platform-admin/sample-models') },
  'llm-proxy': { id: 'llm-proxy', to: '/platform-admin/llm-proxy', label: 'LLM proxy', icon: Sparkles, match: (pathname) => pathname.startsWith('/platform-admin/llm-proxy') },
};

/** The same grouped, captioned rail as the model navigation. Order here is display order. */
const GROUPS: { caption: string | null; ids: SectionId[] }[] = [
  { caption: null, ids: ['overview'] },
  { caption: 'Reference data', ids: ['capability-sets'] },
  { caption: 'Product library', ids: ['products', 'review', 'tools', 'sectors'] },
  { caption: 'Platform', ids: ['sample-models', 'llm-proxy'] },
];

/** On a phone these show in the bottom bar; every other section is one tap further, in the More sheet. */
const BAR_IDS: readonly SectionId[] = ['overview', 'products', 'review', 'tools'];

/**
 * The platform-admin section's own navigation. It reuses the model navigation's
 * rail, captions, icons, tinted active row, badge and phone bottom bar with its
 * More sheet (`ModelNav.module.css`), so this section looks like the rest of
 * the app. Real links, so every area has a URL that survives refresh and a
 * back button. Products and Sector catalogues share a path prefix, so each
 * link owns an explicit match rather than relying on prefix matching alone
 * (which would light both). The badge on Waiting for review is the number of
 * claims waiting, the same figure that screen lists; if it cannot be read, no
 * badge is shown rather than a wrong one.
 */
export function PlatformAdminNav() {
  const { pathname } = useLocation();
  const guardLeave = useUnsavedChangesGuard();
  const [waiting, setWaiting] = useState<number | null>(null);
  useEffect(() => {
    let current = true;
    listClaimsWaitingForReview(supabase)
      .then((result) => { if (current) setWaiting(result.total); })
      .catch(() => { if (current) setWaiting(null); });
    return () => { current = false; };
  }, [pathname]);

  // The More sheet holds the path it was opened on, so moving to any other page reads as closed.
  const [moreOpenAt, setMoreOpenAt] = useState<string | null>(null);
  const moreOpen = moreOpenAt === pathname;
  const sheetId = useId();
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const active = Object.values(SECTIONS).find((section) => section.match(pathname))?.id ?? null;
  const moreCurrent = active !== null && !BAR_IDS.includes(active) ? SECTIONS[active].label : null;

  useEffect(() => {
    if (!moreOpen) return;
    sheetRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoreOpenAt(null);
        moreButtonRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (navRef.current && event.target instanceof Node && !navRef.current.contains(event.target)) setMoreOpenAt(null);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [moreOpen]);

  const renderLink = (id: SectionId, inSheet: boolean) => {
    const section = SECTIONS[id];
    const isActive = id === active;
    const Icon = section.icon;
    return (
      <Link
        to={section.to}
        className={[inSheet ? navStyles.sheetLink : navStyles.link, isActive ? navStyles.active : '', !inSheet && section.shortLabel ? navStyles.hasShortLabel : ''].filter(Boolean).join(' ')}
        aria-current={isActive ? 'page' : undefined}
        title={section.label}
        onClick={guardLeave}
      >
        <Icon size={18} className={navStyles.icon} aria-hidden="true" />
        <Text as="span" size="sm" className={inSheet ? undefined : navStyles.linkLabel}>
          {section.label}
        </Text>
        {!inSheet && section.shortLabel && <span className={navStyles.barLabel} aria-hidden="true">{section.shortLabel}</span>}
        {section.tag !== undefined && <span className={styles.tag}>{section.tag}</span>}
        {id === 'review' && waiting !== null && waiting > 0 && (
          <>
            <span className={navStyles.badge} aria-hidden="true">{waiting > 99 ? '99+' : waiting}</span>
            <span className={navStyles.srOnly}>({waiting} {waiting === 1 ? 'claim' : 'claims'} waiting)</span>
          </>
        )}
      </Link>
    );
  };

  return (
    <nav ref={navRef} className={navStyles.nav} aria-label="Platform admin">
      <div className={navStyles.groupsWrapper}>
        {GROUPS.map((group, groupIndex) => (
          <div key={group.caption ?? 'top'} className={navStyles.group}>
            {groupIndex > 0 && <div className={navStyles.divider} aria-hidden="true" />}
            {group.caption !== null && (
              <Text as="p" size="xs" tone="faint" className={navStyles.groupCaption}>
                {group.caption}
              </Text>
            )}
            <ul className={navStyles.list}>
              {group.ids.map((id) => (
                <li key={id} className={BAR_IDS.includes(id) ? navStyles.barItem : navStyles.moreItem}>
                  {renderLink(id, false)}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <button
          ref={moreButtonRef}
          type="button"
          className={[navStyles.moreButton, moreCurrent !== null || moreOpen ? navStyles.active : ''].filter(Boolean).join(' ')}
          aria-expanded={moreOpen}
          aria-controls={sheetId}
          onClick={() => { setMoreOpenAt(moreOpen ? null : pathname); }}
        >
          <Ellipsis size={18} className={navStyles.icon} aria-hidden="true" />
          <span className={navStyles.barLabel}>More</span>
          {moreCurrent !== null && <span className={navStyles.srOnly}> (current: {moreCurrent})</span>}
        </button>
      </div>
      {moreOpen && (
        <div id={sheetId} ref={sheetRef} className={navStyles.sheet} role="region" aria-label="More sections">
          {GROUPS.map((group) => {
            const ids = group.ids.filter((id) => !BAR_IDS.includes(id));
            if (ids.length === 0) return null;
            return (
              <div key={group.caption ?? 'top'} className={navStyles.sheetGroup}>
                {group.caption !== null && (
                  <Text as="p" size="xs" tone="faint" className={navStyles.sheetCaption}>
                    {group.caption}
                  </Text>
                )}
                <ul className={navStyles.sheetList}>
                  {ids.map((id) => <li key={id}>{renderLink(id, true)}</li>)}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}

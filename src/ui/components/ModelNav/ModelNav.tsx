import { ClipboardList, Ellipsis, FolderKanban, GitBranch, History, Home, List, Search, Map, Milestone, Scale, Upload, Wallet, Workflow, Grid as GridIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Chip } from '../Chip/Chip';
import { Text } from '../Text/Text';
import { useBranchLabel } from '../../branches/useBranchLabel';
import { useModels } from '../../models/useModels';
import { useOrganisationBySlug } from '../../orgs/useOrganisationBySlug';
import { useOpenChangeCount } from '../../changes/useOpenChangeCount';
import { SearchDialog } from '../../search/SearchDialog';
import { useSelectedRef } from '../../branches/useSelectedRef';
import { isViewingMode } from '../../branches/viewingMode';
import { refLabelOf, refQueryParam } from '../../../db/ref';
import { modelNavSectionFor, type ModelNavSection } from '../../nav/modelNavSection';
import styles from './ModelNav.module.css';

export interface ModelNavProps {
  orgSlug: string;
  modelSlug: string;
}

type RealSection = Exclude<ModelNavSection, null>;

/** F9 step 2: four named groups (UI-principles §2.0's own table, amended by F9 step 1) — a caption + 1px divider between each on the rail, dividers alone (no caption — no room) on the mobile bottom bar until F9 step 4 replaces it. Order here is display order, both grouped and flattened. Reports joined with its hub page (F9 step 3); Projects joined Work with its page (F10 step 2, ADR-024 §6.1). */
const NAV_GROUPS: { caption: string; sections: RealSection[] }[] = [
  { caption: 'Model', sections: ['home', 'capability-map', 'landscape', 'value-streams', 'elements'] },
  { caption: 'Analyse', sections: ['portfolio', 'roadmap', 'reports'] },
  { caption: 'Work', sections: ['projects', 'changes', 'decisions', 'capture'] },
  { caption: 'Record', sections: ['versions'] },
];

const SECTION_LABELS: Record<RealSection, string> = {
  home: 'Home',
  'capability-map': 'Capability map',
  landscape: 'Landscape',
  roadmap: 'Roadmap',
  reports: 'Reports',
  'value-streams': 'Value streams',
  elements: 'Elements',
  portfolio: 'Portfolio',
  changes: 'Changes',
  capture: 'Capture',
  projects: 'Projects',
  decisions: 'Decisions',
  versions: 'Versions',
};

/**
 * F9 step 4 (UI-principles §2.0): the four sections the phone bottom bar
 * shows directly; every other section is one tap further, in the More
 * sheet. Desktop and the narrow-desktop rail are unaffected — they always
 * show every section.
 */
const BAR_SECTIONS: readonly RealSection[] = ['home', 'capability-map', 'landscape', 'changes'];

/** F9 step 4: the bar's visible label where the full one is too long for a fifth of a phone's width. The full label stays the link's accessible name. */
const SHORT_LABELS: Partial<Record<RealSection, string>> = {
  'capability-map': 'Capabilities',
};

/** V2b: the curated lucide-react set, UI-principles §2.0's own table — chrome only, never interchanged with `ElementTypeGlyph`. */
const SECTION_ICONS: Record<RealSection, LucideIcon> = {
  home: Home,
  'capability-map': GridIcon,
  landscape: Map,
  roadmap: Milestone,
  reports: ClipboardList,
  'value-streams': Workflow,
  elements: List,
  portfolio: Wallet,
  changes: GitBranch,
  capture: Upload,
  projects: FolderKanban,
  decisions: Scale,
  versions: History,
};

/**
 * The persistent model-level navigation (Sprint U3b, recorded as the
 * navigation model in UI-principles §2): every model route renders this —
 * a left rail on desktop, a bottom bar on mobile (`.module.css`'s own
 * breakpoint switch, same 768px the rest of this sprint's mobile work
 * uses) — its sections grouped into named clusters (Model/Analyse/Work/
 * Record since F9 step 2, `NAV_GROUPS` above; three clusters from V2b),
 * the active one highlighted with a filled background rather than an
 * edge bar, the current ref shown as a chip alongside. V2b also added a
 * lucide icon per section (`SECTION_ICONS`) — visible alongside the
 * label at ≥1024px, icon-only with the label as a native tooltip below
 * that (`.linkLabel`'s own sr-only treatment, module CSS) — see
 * UI-principles §2.0 for the full design and why lucide, specifically,
 * is the one icon library this repo now uses for chrome (never for
 * per-element glyphs — `ElementTypeGlyph` is untouched). Replaces the ad
 * hoc per-page "→" links
 * (`DirectorHome`'s "Open the capability map"/"All versions",
 * `ArchitectHome`'s "Open the queue") that stood in for this before it
 * existed; those pages' own *content-specific* links (a particular
 * change's title, a particular tag's name, a particular commit) stay —
 * this rail is for jumping between sections, not a duplicate of what's
 * already on the page.
 *
 * Bug fix: every link here now carries the selected ref (`useSelectedRef`),
 * including Home/Changes/Review — a former `carriesRef` flag deliberately
 * left those three main-scoped ("changes"/"review" have no per-ref
 * content, and Home's own content is a search box, not a view of a
 * specific ref) but that meant clicking any of them was how a selected
 * change silently got lost: `SelectedRefProvider.tsx`'s own reconciliation
 * would eventually restore it (rewriting the URL once the page landed
 * without one), but only after a page had already rendered assuming
 * `main` for one frame — a real, if brief, race the create-after-navigate
 * bug this fixes could still lose to. Carrying it here outright, on every
 * link, closes that race instead of relying on the correction after the
 * fact.
 */
export function ModelNav({ orgSlug, modelSlug }: ModelNavProps) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { ref } = useSelectedRef();
  const { label: branchLabel } = useBranchLabel(ref);
  // S1 item 2: while viewing (`?viewing=1`), carry that forward only on the
  // two sections "View this change" actually promises read-only access
  // to — Landscape and Capability map. Home/Changes/Review deliberately
  // drop it: a viewing ref is never something a user is "in" the way the
  // editing ref is (`SelectedRefProvider.tsx`'s own write-effect comment),
  // so clicking away to one of those three is a perfectly good, low-risk
  // way to leave viewing mode — nothing is lost by dropping a read-only
  // flag, unlike the editing-ref bug this rail's own carriesRef fix
  // (module comment above) exists to prevent.
  // F9 step 2: the Changes item's badge — how many items the review queue
  // (now a tab of Changes, not a nav item) is holding. The org and model
  // lookups are the same shared-cache entries every model page already
  // reads, so they cost no extra request.
  const { organisation } = useOrganisationBySlug(orgSlug);
  const { models } = useModels(organisation?.id ?? null);
  const modelId = models.find((m) => m.slug === modelSlug)?.id ?? null;
  const openChangeCount = useOpenChangeCount(modelId);
  const viewing = isViewingMode(searchParams);
  const refParam = refQueryParam(ref, false);
  const refParamViewing = refQueryParam(ref, viewing);

  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const modelRelativePath = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname;
  const activeSection = modelNavSectionFor(modelRelativePath);

  const hrefFor = (section: RealSection): string => {
    const path = sectionPath(section);
    const carriesViewing = section === 'landscape' || section === 'capability-map' || section === 'roadmap' || section === 'value-streams' || section === 'portfolio';
    const query = carriesViewing ? refParamViewing : refParam;
    return `${base}${path ? `/${path}` : ''}${ref.kind !== 'main' ? `?${query}` : ''}`;
  };

  // F9 step 4: the phone bar's More sheet. Only ever opened from the More
  // button, which is hidden above 768px, so the sheet never shows on the
  // rail. Every page renders its own nav, so moving to a new page always
  // starts with the sheet closed.
  // Each holds the path it was opened on rather than a plain flag, so
  // moving to any other page — even one of the same kind, which keeps this
  // nav mounted — reads as closed without an effect to reset it.
  const [moreOpenAt, setMoreOpenAt] = useState<string | null>(null);
  const moreOpen = moreOpenAt === location.pathname;
  const setMoreOpen = (open: boolean) => {
    setMoreOpenAt(open ? location.pathname : null);
  };
  const sheetId = useId();
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  // F9 step 5: the search-anywhere dialog, opened by the Search button (the
  // rail's first item, the More sheet's first row) or Ctrl/⌘-K anywhere in
  // the model.
  const [searchOpenAt, setSearchOpenAt] = useState<string | null>(null);
  const searchOpen = searchOpenAt === location.pathname;
  const setSearchOpen = (open: boolean) => {
    setSearchOpenAt(open ? location.pathname : null);
  };
  const shortcutHint = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';
  const pathnameRef = useRef(location.pathname);
  useEffect(() => {
    pathnameRef.current = location.pathname;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      // A field that handles the shortcut itself (and says so) keeps it.
      if (event.defaultPrevented) return;
      if (event.target instanceof HTMLElement && event.target.isContentEditable) return;
      event.preventDefault();
      setMoreOpenAt(null);
      setSearchOpenAt(pathnameRef.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
  const sheetRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  // The More button names the current section when it's one of the sheet's.
  const moreCurrentLabel = activeSection !== null && !BAR_SECTIONS.includes(activeSection) ? SECTION_LABELS[activeSection] : null;

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

  const renderLink = (section: RealSection, inSheet: boolean) => {
    const isActive = section === activeSection;
    const label = SECTION_LABELS[section];
    const shortLabel = SHORT_LABELS[section];
    const Icon = SECTION_ICONS[section];
    return (
      // `title` is the icon-only tier's own tooltip (UI-principles §2.0) — harmless left on at every width. The full label stays in the DOM at every width (`.linkLabel`'s own sr-only treatment between 769 and 1023px, module CSS) so the accessible name never depends on viewport; a short bar label, where there is one, is `aria-hidden` for the same reason.
      <Link to={hrefFor(section)} className={[inSheet ? styles.sheetLink : styles.link, isActive ? styles.active : '', !inSheet && shortLabel ? styles.hasShortLabel : ''].filter(Boolean).join(' ')} aria-current={isActive ? 'page' : undefined} title={label}>
        <Icon size={18} className={styles.icon} aria-hidden="true" />
        <Text as="span" size="sm" className={inSheet ? undefined : styles.linkLabel}>
          {label}
        </Text>
        {/* Only a section whose label is too long for the phone bar carries a second, visible-on-the-bar-only label; every other bar item shows its own label there (module CSS). */}
        {!inSheet && shortLabel && (
          <span className={styles.barLabel} aria-hidden="true">
            {shortLabel}
          </span>
        )}
        {section === 'changes' && openChangeCount !== null && openChangeCount > 0 && <OpenChangesBadge count={openChangeCount} />}
      </Link>
    );
  };

  return (
    <nav ref={navRef} className={styles.nav} aria-label="Model navigation">
      {/* One wrapper around every group, not the groups as `.nav`'s own
          direct children — `.nav`'s mobile `column-reverse` (module CSS)
          flips its own direct children to put the ref chip above the
          bar visually; with the groups as direct children instead, that
          same reversal would also flip the groups' order (Record first),
          which isn't wanted. */}
      <div className={styles.groupsWrapper}>
        <button
          type="button"
          className={styles.searchButton}
          title={`Search (${shortcutHint})`}
          onClick={() => {
            setSearchOpen(true);
          }}
        >
          <Search size={18} className={styles.icon} aria-hidden="true" />
          <Text as="span" size="sm" className={styles.linkLabel}>
            Search
          </Text>
          <kbd className={styles.shortcut} aria-hidden="true">
            {shortcutHint}
          </kbd>
        </button>
        {NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.caption} className={styles.group}>
            {groupIndex > 0 && <div className={styles.divider} aria-hidden="true" />}
            <Text as="p" size="xs" tone="faint" className={styles.groupCaption}>
              {group.caption}
            </Text>
            <ul className={styles.list}>
              {group.sections.map((section) => (
                // F9 step 4: below 768px only the bar sections show; the rest are hidden here (`display: none`, so out of the accessibility tree too) and reached through More instead.
                <li key={section} className={BAR_SECTIONS.includes(section) ? styles.barItem : styles.moreItem}>
                  {renderLink(section, false)}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <button
          ref={moreButtonRef}
          type="button"
          className={[styles.moreButton, moreCurrentLabel !== null || moreOpen ? styles.active : ''].filter(Boolean).join(' ')}
          aria-expanded={moreOpen}
          aria-controls={sheetId}
          onClick={() => {
            setMoreOpen(!moreOpen);
          }}
        >
          <Ellipsis size={18} className={styles.icon} aria-hidden="true" />
          <span className={styles.barLabel}>More</span>
          {moreCurrentLabel !== null && <span className={styles.srOnly}> (current: {moreCurrentLabel})</span>}
        </button>
      </div>
      {moreOpen && (
        <div id={sheetId} ref={sheetRef} className={styles.sheet} role="region" aria-label="More sections">
          <button
            type="button"
            className={styles.sheetLink}
            onClick={() => {
              setMoreOpen(false);
              setSearchOpen(true);
            }}
          >
            <Search size={18} className={styles.icon} aria-hidden="true" />
            <Text as="span" size="sm">
              Search
            </Text>
          </button>
          {NAV_GROUPS.map((group) => {
            const sections = group.sections.filter((section) => !BAR_SECTIONS.includes(section));
            if (sections.length === 0) return null;
            return (
              <div key={group.caption} className={styles.sheetGroup}>
                <Text as="p" size="xs" tone="faint" className={styles.sheetCaption}>
                  {group.caption}
                </Text>
                <ul className={styles.sheetList}>
                  {sections.map((section) => (
                    <li key={section}>{renderLink(section, true)}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      <div className={styles.refChip}>
        <Chip tone="neutral">{refLabelOf(ref, branchLabel)}</Chip>
      </div>
      {searchOpen && modelId !== null && (
        <SearchDialog
          orgSlug={orgSlug}
          modelSlug={modelSlug}
          modelId={modelId}
          activeRef={ref}
          onClose={() => {
            setSearchOpen(false);
          }}
        />
      )}
    </nav>
  );
}

function sectionPath(section: RealSection): string {
  switch (section) {
    case 'home':
      return '';
    case 'capability-map':
      return 'capability-map';
    case 'landscape':
      return 'landscape';
    case 'roadmap':
      return 'roadmap';
    case 'value-streams':
      return 'value-streams';
    case 'elements':
      return 'elements';
    case 'portfolio':
      return 'portfolio';
    case 'reports':
      return 'reports';
    case 'changes':
      return 'changes';
    case 'capture':
      return 'capture';
    case 'projects':
      return 'projects';
    case 'decisions':
      return 'decisions';
    case 'versions':
      return 'versions';
  }
}

/**
 * The Changes item's badge: how many changes are still open (not cancelled,
 * not merged) — what the page it opens lists as live work. It used to show
 * the review queue's count (merge requests plus capture drafts), which
 * didn't match anything on the page the item leads to; the queue keeps its
 * own count on its tab. The number is visible text (never colour alone,
 * §8.4), after the label on the full-width rail and over the icon's corner
 * when the rail is icon-only. The digits are hidden from assistive tech in
 * favour of a spelled-out phrase ("Changes (2 open)"). Zero renders nothing
 * (the caller's check).
 */
function OpenChangesBadge({ count }: { count: number }) {
  return (
    <>
      <span className={styles.badge} aria-hidden="true">
        {count > 99 ? '99+' : count}
      </span>
      <span className={styles.srOnly}>({count} open)</span>
    </>
  );
}

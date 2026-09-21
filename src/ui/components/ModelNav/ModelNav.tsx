import { GitBranch, History, Home, Inbox, Map, Milestone, Scale, Upload, Workflow, Grid as GridIcon, type LucideIcon } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Chip } from '../Chip/Chip';
import { Text } from '../Text/Text';
import { useBranchLabel } from '../../branches/useBranchLabel';
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

/** V2b: three named groups (UI-principles §2.0's own table) — a caption + 1px divider between each on the rail, dividers alone (no caption — no room) on the mobile bottom bar. Order here is display order, both grouped and flattened. */
const NAV_GROUPS: { caption: string; sections: RealSection[] }[] = [
  { caption: 'Model', sections: ['home', 'capability-map', 'landscape', 'roadmap', 'value-streams'] },
  { caption: 'Work', sections: ['changes', 'capture', 'decisions', 'review'] },
  { caption: 'Record', sections: ['versions'] },
];

const SECTION_LABELS: Record<RealSection, string> = {
  home: 'Home',
  'capability-map': 'Capability map',
  landscape: 'Landscape',
  roadmap: 'Roadmap',
  'value-streams': 'Value streams',
  changes: 'Changes',
  capture: 'Capture',
  decisions: 'Decisions',
  versions: 'Versions',
  review: 'Review queue',
};

/** V2b: the curated lucide-react set, UI-principles §2.0's own table — chrome only, never interchanged with `ElementTypeGlyph`. */
const SECTION_ICONS: Record<RealSection, LucideIcon> = {
  home: Home,
  'capability-map': GridIcon,
  landscape: Map,
  roadmap: Milestone,
  'value-streams': Workflow,
  changes: GitBranch,
  capture: Upload,
  decisions: Scale,
  versions: History,
  review: Inbox,
};

/**
 * The persistent model-level navigation (Sprint U3b, recorded as the
 * navigation model in UI-principles §2): every model route renders this —
 * a left rail on desktop, a bottom bar on mobile (`.module.css`'s own
 * breakpoint switch, same 768px the rest of this sprint's mobile work
 * uses) — seven sections (prompt pack F3 PR4 added Decisions) grouped
 * into three named clusters (Model/Work/Record, `NAV_GROUPS` above — V2b),
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
  const viewing = isViewingMode(searchParams);
  const refParam = refQueryParam(ref, false);
  const refParamViewing = refQueryParam(ref, viewing);

  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const modelRelativePath = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname;
  const activeSection = modelNavSectionFor(modelRelativePath);

  return (
    <nav className={styles.nav} aria-label="Model navigation">
      {/* One wrapper around every group, not the groups as `.nav`'s own
          direct children — `.nav`'s mobile `column-reverse` (module CSS)
          flips its own direct children to put the ref chip above the
          icon row visually; with three separate `.group` divs as direct
          children instead of this one wrapper, that same reversal would
          also flip Model/Work/Record into Record/Work/Model, which isn't
          wanted. This wrapper keeps `.nav`'s own child count at two
          (itself, `.refChip`) exactly as before V2b's own grouping. */}
      <div className={styles.groupsWrapper}>
        {NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.caption} className={styles.group}>
            {/* V2b: a divider between groups, not before the first — mobile's own CSS hides the caption below (UI-principles §2.0: "no room") but keeps the divider, which is what still separates the groups there. */}
            {groupIndex > 0 && <div className={styles.divider} aria-hidden="true" />}
            <Text as="p" size="xs" tone="faint" className={styles.groupCaption}>
              {group.caption}
            </Text>
            <ul className={styles.list}>
              {group.sections.map((section) => {
                const path = sectionPath(section);
                const carriesViewing = section === 'landscape' || section === 'capability-map' || section === 'roadmap' || section === 'value-streams';
                const query = carriesViewing ? refParamViewing : refParam;
                const href = `${base}${path ? `/${path}` : ''}${ref.kind !== 'main' ? `?${query}` : ''}`;
                const isActive = section === activeSection;
                const label = SECTION_LABELS[section];
                const Icon = SECTION_ICONS[section];
                return (
                  <li key={section}>
                    {/* `title` is the icon-only tier's own tooltip (UI-principles §2.0) — harmless left on at every width, since a redundant native tooltip alongside a visible label is common and never wrong. The label itself stays in the DOM at every width (`.linkLabel`'s own sr-only treatment below 1024px, module CSS) so the accessible name — and this rail's own `getByRole('link', { name })` test coverage — never depends on viewport. */}
                    <Link to={href} className={[styles.link, isActive ? styles.active : ''].filter(Boolean).join(' ')} aria-current={isActive ? 'page' : undefined} title={label}>
                      <Icon size={18} className={styles.icon} aria-hidden="true" />
                      <Text as="span" size="sm" className={styles.linkLabel}>
                        {label}
                      </Text>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className={styles.refChip}>
        <Chip tone="neutral">{refLabelOf(ref, branchLabel)}</Chip>
      </div>
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
    case 'changes':
      return 'changes';
    case 'capture':
      return 'capture';
    case 'decisions':
      return 'decisions';
    case 'versions':
      return 'versions';
    case 'review':
      return 'review';
  }
}

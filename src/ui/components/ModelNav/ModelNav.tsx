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

const SECTIONS: RealSection[] = ['home', 'capability-map', 'landscape', 'changes', 'versions', 'review'];

const SECTION_LABELS: Record<RealSection, string> = {
  home: 'Home',
  'capability-map': 'Capability map',
  landscape: 'Landscape',
  changes: 'Changes',
  versions: 'Versions',
  review: 'Review queue',
};

/**
 * The persistent model-level navigation (Sprint U3b, recorded as the
 * navigation model in UI-principles §2): every model route renders this —
 * a left rail on desktop, a bottom bar on mobile (`.module.css`'s own
 * breakpoint switch, same 768px the rest of this sprint's mobile work
 * uses) — six sections, the active one highlighted, the current ref shown
 * as a chip alongside. Replaces the ad hoc per-page "→" links
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
      <ul className={styles.list}>
        {SECTIONS.map((section) => {
          const path = sectionPath(section);
          const carriesViewing = section === 'landscape' || section === 'capability-map';
          const query = carriesViewing ? refParamViewing : refParam;
          const href = `${base}${path ? `/${path}` : ''}${ref.kind !== 'main' ? `?${query}` : ''}`;
          const isActive = section === activeSection;
          return (
            <li key={section}>
              <Link to={href} className={[styles.link, isActive ? styles.active : ''].filter(Boolean).join(' ')} aria-current={isActive ? 'page' : undefined}>
                <Text as="span" size="sm">
                  {SECTION_LABELS[section]}
                </Text>
              </Link>
            </li>
          );
        })}
      </ul>
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
    case 'changes':
      return 'changes';
    case 'versions':
      return 'versions';
    case 'review':
      return 'review';
  }
}

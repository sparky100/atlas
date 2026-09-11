import { Link, useLocation } from 'react-router';
import { Chip } from '../Chip/Chip';
import { Text } from '../Text/Text';
import { useBranchLabel } from '../../branches/useBranchLabel';
import { useSelectedRef } from '../../branches/useSelectedRef';
import { refLabelOf, refParamOf } from '../../../db/ref';
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
  const { ref } = useSelectedRef();
  const { label: branchLabel } = useBranchLabel(ref);
  const refParam = refParamOf(ref);

  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const modelRelativePath = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname;
  const activeSection = modelNavSectionFor(modelRelativePath);

  return (
    <nav className={styles.nav} aria-label="Model navigation">
      <ul className={styles.list}>
        {SECTIONS.map((section) => {
          const path = sectionPath(section);
          const href = `${base}${path ? `/${path}` : ''}${refParam !== 'main' ? `?ref=${refParam}` : ''}`;
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

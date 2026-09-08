import { Link, useLocation, useSearchParams } from 'react-router';
import { Chip } from '../Chip/Chip';
import { Text } from '../Text/Text';
import { useBranchLabel } from '../../branches/useBranchLabel';
import { parseRefParam, refLabelOf, refParamOf } from '../../../db/ref';
import { modelNavSectionFor, type ModelNavSection } from '../../nav/modelNavSection';
import styles from './ModelNav.module.css';

export interface ModelNavProps {
  orgSlug: string;
  modelSlug: string;
}

type RealSection = Exclude<ModelNavSection, null>;

interface NavItem {
  section: RealSection;
  label: string;
  /** Whether this section's page reads `?ref=` — the current ref carries through when it does; `changes`/`review` are never anything but main-scoped (SPEC §7's merge/review flow), so they never get one. */
  carriesRef: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { section: 'home', label: 'Home', carriesRef: false },
  { section: 'capability-map', label: 'Capability map', carriesRef: true },
  { section: 'landscape', label: 'Landscape', carriesRef: true },
  { section: 'changes', label: 'Changes', carriesRef: false },
  { section: 'versions', label: 'Versions', carriesRef: true },
  { section: 'review', label: 'Review queue', carriesRef: false },
];

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
 */
export function ModelNav({ orgSlug, modelSlug }: ModelNavProps) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const ref = parseRefParam(searchParams.get('ref'));
  const { label: branchLabel } = useBranchLabel(ref);
  const refParam = refParamOf(ref);

  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const modelRelativePath = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname;
  const activeSection = modelNavSectionFor(modelRelativePath);

  return (
    <nav className={styles.nav} aria-label="Model navigation">
      <ul className={styles.list}>
        {NAV_ITEMS.map((item) => {
          const href = item.section === 'home' ? base : `${base}/${sectionPath(item.section)}${item.carriesRef && refParam !== 'main' ? `?ref=${refParam}` : ''}`;
          const isActive = item.section === activeSection;
          return (
            <li key={item.section}>
              <Link to={href} className={[styles.link, isActive ? styles.active : ''].filter(Boolean).join(' ')} aria-current={isActive ? 'page' : undefined}>
                <Text as="span" size="sm">
                  {item.label}
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

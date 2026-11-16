import { Link } from 'react-router';
import type { BranchRow } from '../../../db/types';
import { Chip } from '../Chip/Chip';
import { Text } from '../Text/Text';
import styles from './ChangesTouchingSection.module.css';

export interface ChangesTouchingSectionProps {
  inFlightBranches: BranchRow[];
  /** Project id → title, for the projects these changes belong to. */
  projectTitles: ReadonlyMap<string, string>;
  orgSlug: string;
  modelSlug: string;
}

/**
 * §4.6.1: in-flight changes touching this element. Sprint U1 has no
 * editing on change branches yet (ADR-015: only main is committed to from
 * the UI) — this section's query is real (src/db/elements.ts's
 * listInFlightBranchesTouchingSubject), so it will start showing rows the
 * moment that changes, with no rework here.
 */
export function ChangesTouchingSection({ inFlightBranches, projectTitles, orgSlug, modelSlug }: ChangesTouchingSectionProps) {
  if (inFlightBranches.length === 0) {
    return null;
  }

  return (
    <ul className={styles.list}>
      {inFlightBranches.map((branch) => (
        <li key={branch.id} className={styles.row}>
          <div className={styles.text}>
            <Link to={`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`}>
              <Text as="span">{branch.title ?? branch.name}</Text>
            </Link>
            {branch.project_id !== null && (
              <Text as="span" tone="muted" size="sm">
                Project:{' '}
                <Link to={`/o/${orgSlug}/m/${modelSlug}/projects/${branch.project_id}`}>{projectTitles.get(branch.project_id) ?? 'Open project'}</Link>
              </Text>
            )}
          </div>
          <Chip tone="info">{branch.status}</Chip>
        </li>
      ))}
    </ul>
  );
}

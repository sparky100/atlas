import { Link } from 'react-router';
import type { PlannedFuture } from '../../db/plannedFuture';
import type { BranchRow } from '../../db/types';
import { Text } from '../components/Text/Text';
import styles from './AsAtControl.module.css';

export interface FutureSummaryProps {
  future: PlannedFuture;
  asAt: string;
  orgSlug: string;
  modelSlug: string;
  /** Defaults to the landscape. */
  subject?: string;
}

function changeLabel(branch: BranchRow): string {
  return branch.title ?? branch.name;
}

/**
 * What a future landscape is made of, in plain words, with each item
 * linking to where it is edited. Sections appear only when there is
 * something in them: no "nothing to report" lines (UX rule), except the one
 * line that says the picture is read-only.
 */
export function FutureSummary({ future, asAt, orgSlug, modelSlug, subject = 'landscape' }: FutureSummaryProps) {
  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const changeHref = (branch: BranchRow) => `${base}/changes/${branch.id}`;
  return (
    <div className={styles.summary} data-testid="future-summary">
      <Text as="p" size="sm">
        The {subject} as it is planned to be on {asAt}. Read-only. Planned changes with a date by then are applied, and systems appear or go according to their own start and end dates.
      </Text>
      {future.applied.length > 0 ? (
        <div>
          <Text as="p" size="sm" tone="muted">
            Planned changes included
          </Text>
          <ul>
            {future.applied.map((b) => (
              <li key={b.id}>
                <Link to={changeHref(b)}>{changeLabel(b)}</Link> <Text as="span" size="sm" tone="muted">({b.target_date})</Text>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Text as="p" size="sm" tone="muted">
          No planned change has a date by then, so this is today’s {subject} plus system start and end dates.
        </Text>
      )}
      {future.capabilitiesWithoutSystem.length > 0 && (
        <div>
          <Text as="p" size="sm">
            Capabilities with no system by {asAt}
          </Text>
          <ul>
            {future.capabilitiesWithoutSystem.map((c) => (
              <li key={c.elementId}>
                <Link to={`${base}/e/${c.elementId}`}>{c.name}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {future.overlaps.length > 0 && (
        <div>
          <Text as="p" size="sm">
            Planned changes that touch the same thing
          </Text>
          <ul>
            {future.overlaps.map((o) => (
              <li key={o.elementId}>
                <Link to={`${base}/e/${o.elementId}`}>{o.name}</Link>: {o.changes.map((b, i) => (
                  <span key={b.id}>
                    {i > 0 ? ' and ' : ''}
                    <Link to={changeHref(b)}>{changeLabel(b)}</Link>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {future.undated.length > 0 && (
        <Text as="p" size="sm">
          {future.undated.length === 1 ? '1 planned change has' : `${String(future.undated.length)} planned changes have`} no date, so {future.undated.length === 1 ? 'it is' : 'they are'} left out.{' '}
          <Link to={`${base}/changes`}>Set a date on the Changes page</Link>
        </Text>
      )}
    </div>
  );
}

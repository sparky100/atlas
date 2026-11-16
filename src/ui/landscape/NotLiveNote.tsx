import { Link } from 'react-router';
import { Text } from '../components/Text/Text';
import styles from './AsAtControl.module.css';

export interface NotLiveNoteProps {
  planned: number;
  retired: number;
  /** Where "see them" goes: the 2 year view for planned items, the Elements list for retired ones. */
  plannedHref: string;
  retiredHref: string;
  /** What is being left out, singular and plural: "system" / "systems". */
  noun: readonly [one: string, many: string];
}

function count(n: number, state: string, noun: readonly [string, string]): string {
  return `${String(n)} ${state} ${n === 1 ? noun[0] : noun[1]}`;
}

/** The one line that says a current-state view left planned or retired items out, and where to see them. Renders nothing when nothing was left out. */
export function NotLiveNote({ planned, retired, plannedHref, retiredHref, noun }: NotLiveNoteProps) {
  if (planned === 0 && retired === 0) return null;
  return (
    <div className={styles.summary} data-testid="not-live-note">
      <Text as="p" size="sm" tone="muted">
      {planned > 0 && (
        <>
          {count(planned, 'planned', noun)} not shown yet. <Link to={plannedHref}>See the 2 year view</Link>
        </>
      )}
      {planned > 0 && retired > 0 && ' · '}
      {retired > 0 && (
        <>
          {count(retired, 'retired', noun)} not shown. <Link to={retiredHref}>See them in Elements</Link>
        </>
      )}
      </Text>
    </div>
  );
}
